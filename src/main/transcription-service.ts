import { MAX_KEYWORD_TERMS, budgetPromptTerms, supportsKeywordList } from '../shared/vocabulary'

const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 120_000
const DEFAULT_ENDPOINT = 'https://api.openai.com/v1'
/** The pause before the one retry, when the service has not asked for one of its own. */
const RETRY_DELAY_MS = 700
/**
 * Bounds on a pause the service asks for in `Retry-After`. Never quite
 * immediate, so a server that says "0" is not asked again in the same instant;
 * never long, because the user is watching the overlay while it passes.
 */
const MIN_RETRY_DELAY_MS = 250
const MAX_RETRY_DELAY_MS = 5000

export interface TranscribeInput {
  audio: Uint8Array
  mimeType: string
  apiKey: string
  model: string
  language: string
  /** Base URL of an OpenAI-compatible API. Empty = api.openai.com. */
  endpoint: string
  /** The user's own words, biased into the recogniser. Empty = none. */
  terms?: string[]
  /** Cancels this caller's request without removing the service timeout. */
  signal?: AbortSignal
  /**
   * Called once, when a busy or unreachable service is about to be asked a
   * second time, so the caller can say why this is taking longer.
   */
  onRetry?: () => void
}

/** One request's outcome. */
type Attempt =
  | { ok: true; text: string }
  | {
      ok: false
      /** The HTTP status, or 0 when the service could not be reached at all. */
      status: number
      error: Error
      /** The service's `Retry-After` header as sent, or null without one. */
      retryAfter: string | null
    }

/**
 * Transcription-quality hints per language. Every curated model accepts a
 * prompt; it should match the audio language.
 */
const PROMPTS: Record<string, string> = {
  en: 'English dictation. Use natural punctuation and capitalisation. Preserve the speaker’s wording.',
  fr: 'Dictée en français. Utilisez une ponctuation et des majuscules naturelles. Respectez les mots du locuteur.',
  de: 'Deutsches Diktat. Verwende natürliche Zeichensetzung und Großschreibung. Behalte die Wortwahl des Sprechers bei.',
  es: 'Dictado en español. Usa puntuación y mayúsculas naturales. Conserva las palabras del hablante.',
  it: 'Dettato in italiano. Usa punteggiatura e maiuscole naturali. Mantieni le parole di chi parla.',
  pt: 'Ditado em português. Use pontuação e maiúsculas naturais. Preserve as palavras de quem fala.',
  nl: 'Nederlands dictee. Gebruik natuurlijke interpunctie en hoofdletters. Behoud de woorden van de spreker.',
  pl: 'Dyktando po polsku. Stosuj naturalną interpunkcję i wielkie litery. Zachowaj słowa mówcy.',
  ru: 'Диктовка на русском языке. Используйте естественную пунктуацию и заглавные буквы. Сохраняйте слова говорящего.',
  ja: '日本語の書き起こしです。自然な句読点を使用し、話者の言葉をそのまま残してください。',
  zh: '中文听写。请使用自然的标点符号，并保留说话者的原话。',
  ko: '한국어 받아쓰기입니다. 자연스러운 문장 부호를 사용하고 화자의 표현을 그대로 유지하세요.'
}

const GENERIC_PROMPT =
  'Dictation. Use natural punctuation and capitalisation. Preserve the speaker’s wording.'

/**
 * The per-language quality hint, with the user's terms appended when this
 * request has no dedicated keyword field to put them in.
 *
 * The terms go last on purpose: `whisper-1` reads only the final 224 tokens of
 * a prompt and weights later tokens more heavily, so the end of the string is
 * the most valuable position in it. They are appended as a bare list rather
 * than as an English sentence, for two reasons: a sentence welded onto a
 * French or Japanese prompt code-switches the decoder's prior, and Whisper is
 * known to echo prompt prose into the transcript when the audio is short or
 * silent — which would put "Terms that may appear:" into whatever the user was
 * typing in. A bare list is also the shape every vocabulary-biasing example
 * for these models uses.
 *
 * The caller has already budgeted the list so the language sentence itself
 * cannot be pushed out of the window.
 */
function buildPrompt(language: string, terms: readonly string[]): string {
  const base = PROMPTS[language] ?? GENERIC_PROMPT
  if (terms.length === 0) return base
  return `${base} ${terms.join(', ')}.`
}

function filenameForMimeType(mimeType: string): string {
  if (mimeType.includes('wav')) return 'dictation.wav'
  if (mimeType.includes('ogg')) return 'dictation.ogg'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'dictation.m4a'
  return 'dictation.webm'
}

/** `retried`: this is the answer to the second attempt, and a rate limit says so. */
function humanApiError(status: number, apiMessage: string, retried: boolean): string {
  if (status === 401) return 'The API key was rejected. Open Settings and add a valid key.'
  if (status === 413) return 'That recording was too large to transcribe.'
  if (status === 429) {
    return retried
      ? 'The API rate limit or spending limit was reached — the request was retried once.'
      : 'The API rate limit or account spending limit was reached.'
  }
  if (status >= 500) return 'The transcription service is temporarily unavailable.'
  return apiMessage || `Transcription failed with HTTP ${status}.`
}

/**
 * Whether a failure is worth one more try: the service said it was busy or
 * broken (429, 5xx), or the request never reached it (status 0). A rejected
 * key, a missing model or an oversized file would fail the same way again. A
 * timeout never gets here — it is thrown, because two minutes of waiting has
 * already cost the user enough.
 */
function isTransient(status: number): boolean {
  return status === 0 || status === 429 || (status >= 500 && status <= 599)
}

/**
 * The pause before the retry: what the service asked for in `Retry-After` —
 * seconds, or an HTTP date — held between a quarter of a second and five
 * seconds; otherwise a short fixed pause.
 */
function retryDelayMs(retryAfter: string | null): number {
  const value = retryAfter?.trim() ?? ''
  if (!value) return RETRY_DELAY_MS
  let delay: number
  if (/^\d+(?:\.\d+)?$/u.test(value)) {
    delay = Number(value) * 1000
  } else {
    const at = Date.parse(value)
    if (Number.isNaN(at)) return RETRY_DELAY_MS
    delay = at - Date.now()
  }
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(MIN_RETRY_DELAY_MS, delay))
}

/**
 * Resolves after `ms`, or rejects with the caller's abort the moment it
 * fires — so a dictation cancelled during the pause never sends its second
 * request.
 */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!signal) {
      setTimeout(resolve, ms)
      return
    }
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export class TranscriptionService {
  async transcribe(input: TranscribeInput): Promise<string> {
    if (!input.apiKey) throw new Error('Add an API key in Settings before recording.')
    if (input.audio.byteLength === 0) throw new Error('The microphone returned an empty recording.')
    if (input.audio.byteLength > MAX_AUDIO_BYTES) {
      throw new Error('The recording exceeded the 25 MB transcription limit.')
    }

    const base = (input.endpoint || DEFAULT_ENDPOINT).replace(/\/+$/u, '')
    const endpoint = `${base}/audio/transcriptions`
    const terms = input.terms ?? []

    // Where the request may carry a dedicated keyword list, the terms go there
    // and the prompt stays a clean language hint; everywhere else — whisper-1,
    // Groq, a local server — they ride the prompt, which every compatible
    // endpoint accepts.
    const useKeywords = terms.length > 0 && supportsKeywordList(input.model, input.endpoint)

    // Rate limits, gateway errors and dropped connections are routine on these
    // endpoints and usually clear within a second, so one of them earns a
    // single quiet retry rather than an error. One for the whole dictation:
    // the keyword fallback below is a differently shaped request, not a second
    // go at the same one, so it neither spends the retry nor earns another.
    // However the failures fall, one recording costs at most three requests.
    let retried = false
    const request = async (keywords: boolean): Promise<Attempt> => {
      const attempt = await this.send(endpoint, input, terms, keywords, false)
      // A cancelled dictation is finished with: nothing more is sent for it.
      if (attempt.ok || retried || !isTransient(attempt.status) || input.signal?.aborted) {
        return attempt
      }
      retried = true
      // Announced before the pause rather than after it: the pause is the
      // part the user would otherwise sit through unexplained.
      input.onRetry?.()
      await pause(retryDelayMs(attempt.retryAfter), input.signal)
      return this.send(endpoint, input, terms, keywords, true)
    }

    const attempt = await request(useKeywords)
    if (attempt.ok) return attempt.text

    // A rejected request that carried keywords is retried once without them,
    // the terms folded into the prompt instead. `keywords` is documented but
    // unverified against every deployment of this model, and this is the
    // default model: a wrong guess must cost one request some accuracy, not
    // break every dictation the user attempts.
    if (useKeywords && attempt.status === 400) {
      const fallback = await request(false)
      if (fallback.ok) return fallback.text
      throw fallback.error
    }
    throw attempt.error
  }

  /**
   * One request. A rejection — an error status, or no answer at all — is
   * returned rather than thrown, so the caller can decide whether it is worth
   * another try: in another shape, or simply again. `isRetry` marks the
   * second attempt, which changes how a rate limit is reported.
   */
  private async send(
    endpoint: string,
    input: TranscribeInput,
    terms: readonly string[],
    useKeywords: boolean,
    isRetry: boolean
  ): Promise<Attempt> {
    const audioCopy = input.audio.slice()
    const body = new FormData()
    body.append(
      'file',
      new Blob([audioCopy], { type: input.mimeType }),
      filenameForMimeType(input.mimeType)
    )
    body.append('model', input.model)

    if (useKeywords) {
      // The first terms, in the user's order: a Pro list can hold several
      // hundred, but one request carries no more than it always did. Every
      // term still corrects near-misses after recognition.
      for (const term of terms.slice(0, MAX_KEYWORD_TERMS)) body.append('keywords[]', term)
    }

    // A language-appropriate quality hint. Confirmed supported for every model
    // in the list. `whisper-1` keeps only the last 224 tokens of it, which is
    // why the term list is budgeted rather than appended whole — otherwise a
    // long vocabulary would evict the language sentence it is appended to.
    body.append(
      'prompt',
      buildPrompt(input.language, useKeywords ? [] : budgetPromptTerms(terms))
    )

    if (input.language !== 'auto') {
      // gpt-transcribe takes a list of candidate languages; the older models
      // take a single ISO-639-1 code.
      if (input.model === 'gpt-transcribe') {
        body.append('languages[]', input.language)
      } else {
        body.append('language', input.language)
      }
    }

    try {
      let response: Response
      try {
        const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        const signal = input.signal
          ? AbortSignal.any([input.signal, timeoutSignal])
          : timeoutSignal
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${input.apiKey}` },
          body,
          signal
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          throw new Error(
            'Transcription timed out. Check your internet connection and try again.',
            { cause: error }
          )
        }
        // Returned, not thrown: a dropped connection is worth one more try.
        return {
          ok: false,
          status: 0,
          error: new Error(
            'Could not reach the transcription service. Check your internet connection.',
            { cause: error }
          ),
          retryAfter: null
        }
      }

      const payload = (await response.json().catch(() => ({}))) as {
        text?: unknown
        error?: { message?: unknown }
      }

      if (!response.ok) {
        const apiMessage = typeof payload.error?.message === 'string' ? payload.error.message : ''
        return {
          ok: false,
          status: response.status,
          error: new Error(humanApiError(response.status, apiMessage, isRetry)),
          retryAfter: response.headers.get('retry-after')
        }
      }
      if (typeof payload.text !== 'string' || !payload.text.trim()) {
        throw new Error('The transcription service returned no speech.')
      }
      return { ok: true, text: payload.text.trim() }
    } finally {
      // Only safe once the response body has been read — the request body is
      // backed by this buffer.
      audioCopy.fill(0)
    }
  }
}
