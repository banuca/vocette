const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 120_000
const DEFAULT_ENDPOINT = 'https://api.openai.com/v1'

export interface TranscribeInput {
  audio: Uint8Array
  mimeType: string
  apiKey: string
  model: string
  language: string
  /** Base URL of an OpenAI-compatible API. Empty = api.openai.com. */
  endpoint: string
  /** Cancels this caller's request without removing the service timeout. */
  signal?: AbortSignal
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

function buildPrompt(language: string): string {
  return PROMPTS[language] ?? GENERIC_PROMPT
}

function filenameForMimeType(mimeType: string): string {
  if (mimeType.includes('wav')) return 'dictation.wav'
  if (mimeType.includes('ogg')) return 'dictation.ogg'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'dictation.m4a'
  return 'dictation.webm'
}

function humanApiError(status: number, apiMessage: string): string {
  if (status === 401) return 'The API key was rejected. Open Settings and add a valid key.'
  if (status === 413) return 'That recording was too large to transcribe.'
  if (status === 429) return 'The API rate limit or account spending limit was reached.'
  if (status >= 500) return 'The transcription service is temporarily unavailable.'
  return apiMessage || `Transcription failed with HTTP ${status}.`
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

    const audioCopy = input.audio.slice()
    const body = new FormData()
    body.append(
      'file',
      new Blob([audioCopy], { type: input.mimeType }),
      filenameForMimeType(input.mimeType)
    )
    body.append('model', input.model)

    // A language-appropriate quality hint. Confirmed supported for every model
    // in the list (whisper-1 caps prompts at 224 tokens; ours is far shorter).
    body.append('prompt', buildPrompt(input.language))

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
        throw new Error(
          'Could not reach the transcription service. Check your internet connection.',
          { cause: error }
        )
      }

      const payload = (await response.json().catch(() => ({}))) as {
        text?: unknown
        error?: { message?: unknown }
      }

      if (!response.ok) {
        const apiMessage = typeof payload.error?.message === 'string' ? payload.error.message : ''
        throw new Error(humanApiError(response.status, apiMessage))
      }
      if (typeof payload.text !== 'string' || !payload.text.trim()) {
        throw new Error('The transcription service returned no speech.')
      }
      return payload.text.trim()
    } finally {
      // Only safe once the response body has been read — the request body is
      // backed by this buffer.
      audioCopy.fill(0)
    }
  }
}
