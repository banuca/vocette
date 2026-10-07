import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TranscriptionService,
  type ConnectionTestInput,
  type TranscribeInput
} from '../src/main/transcription-service'
import { MAX_KEYWORD_TERMS } from '../src/shared/vocabulary'

const service = new TranscriptionService()
const key = 'sk-test'

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function respond(text: string, status = 200): Response {
  return new Response(JSON.stringify({ text }), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/** The FormData of the request the mock received, for shape assertions. */
function bodyOf(fetchMock: ReturnType<typeof vi.fn<FetchFn>>): FormData {
  const init = fetchMock.mock.calls[0]?.[1]
  expect(init?.body).toBeInstanceOf(FormData)
  return init?.body as FormData
}

function stubFetch(response: Response | Promise<Response>): ReturnType<typeof vi.fn<FetchFn>> {
  const fetchMock = vi.fn<FetchFn>(async () => response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TranscriptionService', () => {
  it('posts to the OpenAI endpoint with gpt-transcribe parameters', async () => {
    const fetchMock = stubFetch(respond('Transcribed.'))

    const text = await service.transcribe({
      audio: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
      apiKey: key,
      model: 'gpt-transcribe',
      language: 'fr',
      endpoint: ''
    })

    expect(text).toBe('Transcribed.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(init.headers).toEqual({ Authorization: 'Bearer sk-test' })

    const body = bodyOf(fetchMock)
    expect(body.get('model')).toBe('gpt-transcribe')
    expect(body.get('prompt')).toBeTruthy()
    expect(body.get('language')).toBeNull()
    expect(body.getAll('languages[]')).toEqual(['fr'])
    const file = body.get('file') as unknown as File
    expect(file.type).toBe('audio/wav')
    expect(file.name).toBe('dictation.wav')
  })

  it('uses the singular language field for the whisper family', async () => {
    const fetchMock = stubFetch(respond('ok'))

    await service.transcribe({
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      apiKey: key,
      model: 'whisper-1',
      language: 'de',
      endpoint: ''
    })

    const body = bodyOf(fetchMock)
    expect(body.get('model')).toBe('whisper-1')
    expect(body.get('language')).toBe('de')
    expect(body.getAll('languages[]')).toEqual([])
    expect(body.get('prompt')).toBeTruthy()
  })

  it('omits language fields entirely in auto mode', async () => {
    const fetchMock = stubFetch(respond('ok'))

    await service.transcribe({
      audio: new Uint8Array([1]),
      mimeType: 'audio/webm',
      apiKey: key,
      model: 'gpt-transcribe',
      language: 'auto',
      endpoint: ''
    })

    const body = bodyOf(fetchMock)
    expect(body.get('language')).toBeNull()
    expect(body.getAll('languages[]')).toEqual([])
    expect(body.get('file')).toBeInstanceOf(Blob)
  })

  it('joins a custom endpoint onto /audio/transcriptions', async () => {
    const fetchMock = stubFetch(respond('ok'))

    await service.transcribe({
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      apiKey: key,
      model: 'gpt-transcribe',
      language: 'auto',
      endpoint: 'http://localhost:8080/v1/'
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:8080/v1/audio/transcriptions')
  })

  it('propagates caller cancellation while retaining the service timeout', async () => {
    const timeout = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    const caller = new AbortController()
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn<FetchFn>(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const transcription = service.transcribe({
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      apiKey: key,
      model: 'gpt-transcribe',
      language: 'auto',
      endpoint: '',
      signal: caller.signal
    })

    const requestSignal = fetchMock.mock.calls[0]?.[1]?.signal
    expect(timeoutSpy).toHaveBeenCalledWith(120_000)
    expect(requestSignal?.aborted).toBe(false)
    caller.abort()
    expect(requestSignal?.aborted).toBe(true)

    // The mock deliberately ignores abort, matching a provider or test double
    // that resolves late. Controller ownership guards handle that case.
    resolveFetch(respond('late response'))
    await expect(transcription).resolves.toBe('late response')
  })

  it('keeps the 120 second timeout failure mapping', async () => {
    const timeout = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    const fetchMock = vi.fn<FetchFn>(async (_input, init) => {
      const signal = init?.signal
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const transcription = service.transcribe({
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      apiKey: key,
      model: 'gpt-transcribe',
      language: 'auto',
      endpoint: ''
    })
    timeout.abort(new DOMException('timed out', 'TimeoutError'))

    await expect(transcription).rejects.toThrow('Transcription timed out')
    expect(timeoutSpy).toHaveBeenCalledWith(120_000)
  })

  it('turns a 401 into an actionable message', async () => {
    stubFetch(
      new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 })
    )
    await expect(
      service.transcribe({
        audio: new Uint8Array([1]),
        mimeType: 'audio/wav',
        apiKey: 'bad',
        model: 'whisper-1',
        language: 'auto',
        endpoint: ''
      })
    ).rejects.toThrow('The API key was rejected')
  })

  it('surfaces the API error message for unexpected statuses', async () => {
    stubFetch(
      new Response(JSON.stringify({ error: { message: 'Unsupported file' } }), { status: 400 })
    )
    await expect(
      service.transcribe({
        audio: new Uint8Array([1]),
        mimeType: 'audio/wav',
        apiKey: key,
        model: 'whisper-1',
        language: 'auto',
        endpoint: ''
      })
    ).rejects.toThrow('Unsupported file')
  })

  it('reports network failures without leaking stack details', async () => {
    vi.useFakeTimers()
    const fetchMock = stubFetch(Promise.reject(new TypeError('fetch failed')))
    const outcome = expect(
      service.transcribe({
        audio: new Uint8Array([1]),
        mimeType: 'audio/wav',
        apiKey: key,
        model: 'whisper-1',
        language: 'auto',
        endpoint: ''
      })
    ).rejects.toThrow('Could not reach the transcription service')
    // A dropped connection is tried once more before it is reported.
    await vi.advanceTimersByTimeAsync(700)
    await outcome
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects empty audio before any network call', async () => {
    const fetchMock = stubFetch(respond('ok'))
    await expect(
      service.transcribe({
        audio: new Uint8Array(0),
        mimeType: 'audio/wav',
        apiKey: key,
        model: 'whisper-1',
        language: 'auto',
        endpoint: ''
      })
    ).rejects.toThrow('empty recording')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects audio over the 25 MB limit', async () => {
    await expect(
      service.transcribe({
        audio: new Uint8Array(25 * 1024 * 1024 + 1),
        mimeType: 'audio/wav',
        apiKey: key,
        model: 'whisper-1',
        language: 'auto',
        endpoint: ''
      })
    ).rejects.toThrow('25 MB')
  })
})

describe('TranscriptionService vocabulary biasing', () => {
  const terms = ['Kirinde', 'ITU-T', 'Dataverse']

  it('sends the terms as a keyword list and keeps the prompt clean for gpt-transcribe', async () => {
    const fetchMock = stubFetch(respond('ok'))

    await service.transcribe({
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      apiKey: key,
      model: 'gpt-transcribe',
      language: 'en',
      endpoint: '',
      terms
    })

    const body = bodyOf(fetchMock)
    expect(body.getAll('keywords[]')).toEqual(terms)
    const prompt = body.get('prompt') as string
    expect(prompt).toContain('English dictation.')
    expect(prompt).not.toContain('Kirinde')
  })

  it('carries no more than the first 100 terms in the keyword list, however long a Pro list is', async () => {
    const fetchMock = stubFetch(respond('ok'))
    const many = Array.from({ length: MAX_KEYWORD_TERMS + 150 }, (_, index) => `term${index}`)

    await service.transcribe({
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      apiKey: key,
      model: 'gpt-transcribe',
      language: 'en',
      endpoint: '',
      terms: many
    })

    const sent = bodyOf(fetchMock).getAll('keywords[]')
    expect(MAX_KEYWORD_TERMS).toBe(100)
    expect(sent).toHaveLength(MAX_KEYWORD_TERMS)
    // The user's order decides which ones go.
    expect(sent[0]).toBe('term0')
    expect(sent.at(-1)).toBe(`term${MAX_KEYWORD_TERMS - 1}`)
  })

  it('folds the terms into the prompt for a model with no keyword field', async () => {
    const fetchMock = stubFetch(respond('ok'))

    await service.transcribe({
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      apiKey: key,
      model: 'whisper-1',
      language: 'en',
      endpoint: '',
      terms
    })

    const body = bodyOf(fetchMock)
    expect(body.getAll('keywords[]')).toEqual([])
    const prompt = body.get('prompt') as string
    expect(prompt.startsWith('English dictation.')).toBe(true)
    // A bare list, not an English sentence: Whisper echoes prompt prose into
    // the transcript when the audio is short, and an English sentence welded
    // onto a French prompt code-switches the decoder.
    expect(prompt.endsWith('Kirinde, ITU-T, Dataverse.')).toBe(true)
    expect(prompt).not.toContain('Terms that may appear')
  })

  it('keeps gpt-4o-transcribe on the prompt path', async () => {
    const fetchMock = stubFetch(respond('ok'))

    await service.transcribe({
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      apiKey: key,
      model: 'gpt-4o-transcribe',
      language: 'auto',
      endpoint: '',
      terms
    })

    const body = bodyOf(fetchMock)
    expect(body.getAll('keywords[]')).toEqual([])
    expect(body.get('prompt')).toContain('Kirinde, ITU-T, Dataverse.')
  })

  it('never sends keywords to a custom endpoint, even for gpt-transcribe', async () => {
    // A Groq or local server may reject an unknown multipart field outright.
    const fetchMock = stubFetch(respond('ok'))

    await service.transcribe({
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      apiKey: key,
      model: 'gpt-transcribe',
      language: 'fr',
      endpoint: 'https://api.groq.com/openai/v1',
      terms
    })

    const body = bodyOf(fetchMock)
    expect(body.getAll('keywords[]')).toEqual([])
    const prompt = body.get('prompt') as string
    expect(prompt.startsWith('Dictée en français.')).toBe(true)
    expect(prompt).toContain('Kirinde, ITU-T, Dataverse.')
  })

  it('budgets the prompt so a long list cannot evict the language hint', async () => {
    const fetchMock = stubFetch(respond('ok'))
    const many = Array.from({ length: 100 }, (_, i) => `term-number-${i}`)

    await service.transcribe({
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      apiKey: key,
      model: 'whisper-1',
      language: 'de',
      endpoint: '',
      terms: many
    })

    const prompt = bodyOf(fetchMock).get('prompt') as string
    expect(prompt.startsWith('Deutsches Diktat.')).toBe(true)
    // whisper-1 keeps only the last 224 tokens; ~480 characters of terms plus
    // the language sentence stays comfortably inside that window.
    expect(prompt.length).toBeLessThan(700)
    expect(prompt).not.toContain('term-number-99')
  })

  it('sends exactly the request it sent before when there are no terms', async () => {
    const fetchMock = stubFetch(respond('ok'))
    await service.transcribe({
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      apiKey: key,
      model: 'gpt-transcribe',
      language: 'en',
      endpoint: '',
      terms: []
    })

    const body = bodyOf(fetchMock)
    expect(body.getAll('keywords[]')).toEqual([])
    expect(body.get('prompt')).toBe(
      'English dictation. Use natural punctuation and capitalisation. Preserve the speaker’s wording.'
    )
  })
})

describe('TranscriptionService keyword fallback', () => {
  const terms = ['Kirinde', 'ITU-T']

  /** Replies 400 to a request carrying keywords, and 200 to one without. */
  function stubRejectingKeywords(): ReturnType<typeof vi.fn<FetchFn>> {
    const fetchMock = vi.fn<FetchFn>(async (_url, init) => {
      const body = init?.body as FormData
      return body.getAll('keywords[]').length > 0
        ? new Response(JSON.stringify({ error: { message: 'Unknown parameter: keywords.' } }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          })
        : respond('Transcribed.')
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('retries without keywords when the server rejects them, and succeeds', async () => {
    // The default model carries a field that is documented but unverified
    // against every deployment. A wrong guess must cost one request some
    // accuracy, not break every dictation the user attempts.
    const fetchMock = stubRejectingKeywords()

    const text = await service.transcribe({
      audio: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
      apiKey: key,
      model: 'gpt-transcribe',
      language: 'en',
      endpoint: '',
      terms
    })

    expect(text).toBe('Transcribed.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const retry = (fetchMock.mock.calls[1]?.[1] as RequestInit).body as FormData
    expect(retry.getAll('keywords[]')).toEqual([])
    // The terms are not lost — they move to the prompt.
    expect(retry.get('prompt')).toContain('Kirinde, ITU-T.')
  })

  it('does not retry a 400 that had no keywords to blame', async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ error: { message: 'Bad audio.' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    )

    await expect(
      service.transcribe({
        audio: new Uint8Array([1]),
        mimeType: 'audio/wav',
        apiKey: key,
        model: 'whisper-1',
        language: 'en',
        endpoint: '',
        terms
      })
    ).rejects.toThrow('Bad audio.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a 401, which a different request shape cannot fix', async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ error: { message: 'no' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      })
    )

    await expect(
      service.transcribe({
        audio: new Uint8Array([1]),
        mimeType: 'audio/wav',
        apiKey: key,
        model: 'gpt-transcribe',
        language: 'en',
        endpoint: '',
        terms
      })
    ).rejects.toThrow('API key was rejected')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports the fallback failure when the retry also fails', async () => {
    // A fresh Response per call: a body can only be read once, and both
    // attempts read one.
    const fetchMock = vi.fn<FetchFn>(
      async () =>
        new Response(JSON.stringify({ error: { message: 'nope' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      service.transcribe({
        audio: new Uint8Array([1]),
        mimeType: 'audio/wav',
        apiKey: key,
        model: 'gpt-transcribe',
        language: 'en',
        endpoint: '',
        terms
      })
    ).rejects.toThrow('nope')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never touches the caller audio buffer, across both attempts', async () => {
    stubRejectingKeywords()
    const audio = new Uint8Array([9, 9, 9, 9])

    await service.transcribe({
      audio,
      mimeType: 'audio/wav',
      apiKey: key,
      model: 'gpt-transcribe',
      language: 'en',
      endpoint: '',
      terms
    })

    // Each attempt copies and scrubs its own copy; the retry must still have
    // real audio to send, so the original cannot have been zeroed.
    expect([...audio]).toEqual([9, 9, 9, 9])
  })
})

describe('TranscriptionService transient retry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  /** An error answer, shaped the way an OpenAI-compatible endpoint sends one. */
  function failure(status: number, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify({ error: { message: `HTTP ${status} from the server` } }), {
      status,
      headers: { 'content-type': 'application/json', ...headers }
    })
  }

  /** A dropped connection, as fetch reports one. */
  const unreachable = (): Promise<Response> => Promise.reject(new TypeError('fetch failed'))

  /**
   * Answers each request with the next reply in turn. Replies are built per
   * call, because a response body can only be read once.
   */
  function stubReplies(
    ...replies: Array<() => Response | Promise<Response>>
  ): ReturnType<typeof vi.fn<FetchFn>> {
    let next = 0
    const fetchMock = vi.fn<FetchFn>(async () => {
      const reply = replies[next]
      next += 1
      if (!reply) throw new Error('More requests were made than the test expected.')
      return await reply()
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  const input = (overrides: Partial<TranscribeInput> = {}): TranscribeInput => ({
    audio: new Uint8Array([1, 2, 3]),
    mimeType: 'audio/wav',
    apiKey: key,
    model: 'whisper-1',
    language: 'en',
    endpoint: '',
    ...overrides
  })

  /** A request that carries the keyword list, so a 400 takes the keyword fallback. */
  const withKeywords = (overrides: Partial<TranscribeInput> = {}): TranscribeInput =>
    input({ model: 'gpt-transcribe', terms: ['Kirinde'], ...overrides })

  const keywordsOf = (fetchMock: ReturnType<typeof vi.fn<FetchFn>>, call: number): string[] =>
    ((fetchMock.mock.calls[call]?.[1] as RequestInit).body as FormData).getAll(
      'keywords[]'
    ) as string[]

  it('retries a 503 once and returns the text, announcing the retry once', async () => {
    const fetchMock = stubReplies(
      () => failure(503),
      () => respond('Second time lucky.')
    )
    const onRetry = vi.fn()

    const transcription = service.transcribe(input({ onRetry }))
    await vi.advanceTimersByTimeAsync(699)
    // Announced as soon as the retry is decided, so the pause is explained.
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await expect(transcription).resolves.toBe('Second time lucky.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[1] ?? 0
    )
  })

  it('waits as long as Retry-After asks: two seconds for a 429 that says 2', async () => {
    const fetchMock = stubReplies(
      () => failure(429, { 'retry-after': '2' }),
      () => respond('ok')
    )

    const transcription = service.transcribe(input())
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expect(transcription).resolves.toBe('ok')
  })

  it('waits no longer than five seconds, whatever Retry-After asks', async () => {
    const fetchMock = stubReplies(
      () => failure(429, { 'retry-after': '30' }),
      () => respond('ok')
    )

    const transcription = service.transcribe(input())
    await vi.advanceTimersByTimeAsync(4999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expect(transcription).resolves.toBe('ok')
  })

  it('waits at least a quarter of a second, even when Retry-After says 0', async () => {
    const fetchMock = stubReplies(
      () => failure(503, { 'retry-after': '0' }),
      () => respond('ok')
    )

    const transcription = service.transcribe(input())
    await vi.advanceTimersByTimeAsync(249)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expect(transcription).resolves.toBe('ok')
  })

  it('reads a Retry-After given as an HTTP date', async () => {
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
    const threeSecondsOn = new Date(Date.now() + 3000).toUTCString()
    const fetchMock = stubReplies(
      () => failure(503, { 'retry-after': threeSecondsOn }),
      () => respond('ok')
    )

    const transcription = service.transcribe(input())
    await vi.advanceTimersByTimeAsync(2999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expect(transcription).resolves.toBe('ok')
  })

  it.each([
    [400, 'HTTP 400 from the server'],
    [401, 'The API key was rejected'],
    [403, 'HTTP 403 from the server'],
    [404, 'HTTP 404 from the server'],
    [413, 'That recording was too large']
  ])('does not retry a %i, which would fail the same way again', async (status, message) => {
    const fetchMock = stubReplies(
      () => failure(status),
      () => respond('never sent')
    )
    const onRetry = vi.fn()

    const outcome = expect(service.transcribe(input({ onRetry }))).rejects.toThrow(message)
    await vi.advanceTimersByTimeAsync(10_000)
    await outcome
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('retries a dropped connection', async () => {
    const fetchMock = stubReplies(unreachable, () => respond('Reconnected.'))

    const transcription = service.transcribe(input())
    await vi.advanceTimersByTimeAsync(700)
    await expect(transcription).resolves.toBe('Reconnected.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a request that timed out', async () => {
    const fetchMock = stubReplies(
      () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
      () => respond('never sent')
    )
    const onRetry = vi.fn()

    const outcome = expect(service.transcribe(input({ onRetry }))).rejects.toThrow(
      'Transcription timed out'
    )
    await vi.advanceTimersByTimeAsync(10_000)
    await outcome
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('sends nothing more for a dictation cancelled while its request was out', async () => {
    // Cancelling makes fetch reject, which must not pass for a dropped connection.
    const caller = new AbortController()
    const fetchMock = vi.fn<FetchFn>(async (_url, init) => {
      const signal = init?.signal
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onRetry = vi.fn()

    const outcome = expect(
      service.transcribe(input({ signal: caller.signal, onRetry }))
    ).rejects.toThrow()
    caller.abort()
    await outcome
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('stops at once, with the abort, when cancelled during the pause', async () => {
    const fetchMock = stubReplies(
      () => failure(503),
      () => respond('never sent')
    )
    const caller = new AbortController()

    const settled = service.transcribe(input({ signal: caller.signal })).then(
      () => 'resolved',
      (error: unknown) => error
    )
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    caller.abort()
    // No timer is advanced: the pause must give way without being waited out.
    expect(await settled).toBe(caller.signal.reason)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports the second failure after exactly two requests', async () => {
    const fetchMock = stubReplies(
      () => failure(503),
      () => failure(502),
      () => respond('never sent')
    )
    const onRetry = vi.fn()

    const outcome = expect(service.transcribe(input({ onRetry }))).rejects.toThrow(
      'The transcription service is temporarily unavailable.'
    )
    await vi.advanceTimersByTimeAsync(10_000)
    await outcome
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('says so when a rate limit outlasts the retry', async () => {
    const fetchMock = stubReplies(
      () => failure(429),
      () => failure(429)
    )

    const outcome = expect(service.transcribe(input())).rejects.toThrow(
      'The API rate limit or spending limit was reached — the request was retried once.'
    )
    await vi.advanceTimersByTimeAsync(10_000)
    await outcome
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sends the same audio the second time, and leaves the caller buffer alone', async () => {
    const fetchMock = stubReplies(
      () => failure(503),
      () => respond('ok')
    )
    const audio = new Uint8Array([9, 9, 9, 9])

    const transcription = service.transcribe(input({ audio }))
    await vi.advanceTimersByTimeAsync(700)
    await transcription

    const resent = ((fetchMock.mock.calls[1]?.[1] as RequestInit).body as FormData).get(
      'file'
    ) as unknown as File
    expect([...new Uint8Array(await resent.arrayBuffer())]).toEqual([9, 9, 9, 9])
    expect([...audio]).toEqual([9, 9, 9, 9])
  })

  describe('alongside the keyword fallback', () => {
    it('still falls back on a 400 without spending the retry or saying it is busy', async () => {
      const fetchMock = stubReplies(
        () => failure(400),
        () => respond('Transcribed.')
      )
      const onRetry = vi.fn()

      const transcription = service.transcribe(withKeywords({ onRetry }))
      // No pause: the fallback goes out straight away, as it always did.
      await vi.advanceTimersByTimeAsync(0)
      await expect(transcription).resolves.toBe('Transcribed.')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(keywordsOf(fetchMock, 0)).toEqual(['Kirinde'])
      expect(keywordsOf(fetchMock, 1)).toEqual([])
      expect(onRetry).not.toHaveBeenCalled()
    })

    it('retries a 503 on the fallback once, and never a second time', async () => {
      const fetchMock = stubReplies(
        () => failure(400),
        () => failure(503),
        () => failure(503),
        () => respond('never sent')
      )
      const onRetry = vi.fn()

      const outcome = expect(service.transcribe(withKeywords({ onRetry }))).rejects.toThrow(
        'The transcription service is temporarily unavailable.'
      )
      await vi.advanceTimersByTimeAsync(10_000)
      await outcome
      // With keywords, without, and the one retry of the one without.
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(keywordsOf(fetchMock, 2)).toEqual([])
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('does not retry the fallback once the retry has been spent', async () => {
      const fetchMock = stubReplies(
        () => failure(503),
        () => failure(400),
        () => failure(503),
        () => respond('never sent')
      )
      const onRetry = vi.fn()

      const outcome = expect(service.transcribe(withKeywords({ onRetry }))).rejects.toThrow(
        'The transcription service is temporarily unavailable.'
      )
      await vi.advanceTimersByTimeAsync(10_000)
      await outcome
      // The retry was the second request; the 400 still earned its fallback.
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(keywordsOf(fetchMock, 1)).toEqual(['Kirinde'])
      expect(keywordsOf(fetchMock, 2)).toEqual([])
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('recovers when the retry of the fallback succeeds', async () => {
      const fetchMock = stubReplies(
        () => failure(400),
        () => failure(503),
        () => respond('Third time.')
      )

      const transcription = service.transcribe(withKeywords())
      await vi.advanceTimersByTimeAsync(700)
      await expect(transcription).resolves.toBe('Third time.')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
  })
})

const LOCAL_SERVER = 'http://localhost:8080/v1'

/** The headers of the one request the mock received, however they were given. */
function headersOf(fetchMock: ReturnType<typeof vi.fn<FetchFn>>): Headers {
  return new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
}

/** A refusal, shaped the way an OpenAI-compatible server sends one. */
function refusal(status: number): Response {
  return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/**
 * whisper.cpp, Speaches or a corporate deployment may need no key at all, so
 * a custom endpoint is asked without one — while OpenAI, which always needs
 * one, is never sent a request that cannot succeed.
 */
describe('TranscriptionService without a key', () => {
  const dictation = (overrides: Partial<TranscribeInput> = {}): TranscribeInput => ({
    audio: new Uint8Array([1, 2, 3]),
    mimeType: 'audio/wav',
    apiKey: '',
    model: 'whisper-1',
    language: 'en',
    endpoint: LOCAL_SERVER,
    ...overrides
  })

  it('sends to a custom endpoint with no Authorization header at all', async () => {
    const fetchMock = stubFetch(respond('Keyless.'))

    await expect(service.transcribe(dictation())).resolves.toBe('Keyless.')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:8080/v1/audio/transcriptions')
    // Not an empty `Bearer ` either, which a server could refuse as malformed.
    expect(headersOf(fetchMock).has('authorization')).toBe(false)
    expect(bodyOf(fetchMock).get('model')).toBe('whisper-1')
  })

  it('still sends a key to a custom endpoint when there is one', async () => {
    const fetchMock = stubFetch(respond('ok'))
    await service.transcribe(
      dictation({ apiKey: 'gsk-test', endpoint: 'https://api.groq.com/openai/v1' })
    )
    expect(headersOf(fetchMock).get('authorization')).toBe('Bearer gsk-test')
  })

  it('refuses OpenAI without a key before anything is sent', async () => {
    const fetchMock = stubFetch(respond('never sent'))
    for (const endpoint of ['', '   ']) {
      await expect(service.transcribe(dictation({ endpoint }))).rejects.toHaveProperty(
        'message',
        'Add an API key in Settings before recording.'
      )
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still says when a keyless server heard no speech', async () => {
    stubFetch(respond('   '))
    await expect(service.transcribe(dictation())).rejects.toThrow(
      'The transcription service returned no speech.'
    )
  })
})

describe('TranscriptionService refusals, by endpoint', () => {
  const attempt = (apiKey: string, endpoint: string): Promise<string> =>
    service.transcribe({
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      apiKey,
      model: 'whisper-1',
      language: 'en',
      endpoint
    })

  it('names the server that refused a keyless request, and says a key may be what it wants', async () => {
    const fetchMock = stubFetch(refusal(401))
    await expect(attempt('', LOCAL_SERVER)).rejects.toHaveProperty(
      'message',
      'The server at localhost:8080 refused the request (HTTP 401). If it needs a key, add one in Settings.'
    )
    // A refusal would only be refused again.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('says the same of a 403, with the status it was given', async () => {
    stubFetch(refusal(403))
    await expect(attempt('', 'http://127.0.0.1:9000/v1')).rejects.toHaveProperty(
      'message',
      'The server at 127.0.0.1:9000 refused the request (HTTP 403). If it needs a key, add one in Settings.'
    )
  })

  it('points at the key when one went to a custom endpoint and was refused', async () => {
    stubFetch(refusal(401))
    await expect(attempt('gsk-wrong', 'https://api.groq.com/openai/v1')).rejects.toHaveProperty(
      'message',
      'The server at api.groq.com refused the request (HTTP 401). Check the API key in Settings.'
    )
  })

  it('keeps OpenAI’s own wording for a rejected key', async () => {
    stubFetch(refusal(401))
    await expect(attempt('sk-wrong', '')).rejects.toHaveProperty(
      'message',
      'The API key was rejected. Open Settings and add a valid key.'
    )
  })
})

/**
 * Test connection: one second of silence, sent once, with a short wait. It
 * must answer honestly and fast — no quiet retry — and count an empty
 * transcript of silence as the success it is.
 */
describe('TranscriptionService.testConnection', () => {
  const probe = (overrides: Partial<ConnectionTestInput> = {}): ConnectionTestInput => ({
    audio: new Uint8Array([1, 2, 3]),
    mimeType: 'audio/wav',
    apiKey: '',
    model: 'whisper-1',
    language: 'en',
    endpoint: LOCAL_SERVER,
    ...overrides
  })

  it('sends one request, with the timeout it is given and no key when there is none', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = stubFetch(respond('Hello.'))

    await expect(service.testConnection(probe(), 10_000)).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(timeoutSpy).toHaveBeenCalledWith(10_000)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:8080/v1/audio/transcriptions')
    expect(headersOf(fetchMock).has('authorization')).toBe(false)
  })

  it('shapes the request as a dictation would, but never with a keyword list', async () => {
    const fetchMock = stubFetch(respond(''))
    await service.testConnection(
      probe({ apiKey: 'sk-test', endpoint: '', model: 'gpt-transcribe' }),
      10_000
    )

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(headersOf(fetchMock).get('authorization')).toBe('Bearer sk-test')
    const body = bodyOf(fetchMock)
    const file = body.get('file') as unknown as File
    expect(file.name).toBe('dictation.wav')
    expect(file.type).toBe('audio/wav')
    expect(body.get('model')).toBe('gpt-transcribe')
    expect(body.getAll('languages[]')).toEqual(['en'])
    expect(body.get('prompt')).toBe(
      'English dictation. Use natural punctuation and capitalisation. Preserve the speaker’s wording.'
    )
    expect(body.getAll('keywords[]')).toEqual([])
  })

  it('counts an empty transcript as connected, since what it sent was silence', async () => {
    stubFetch(respond(''))
    await expect(service.testConnection(probe(), 10_000)).resolves.toBeUndefined()
  })

  it('does not count an answer with no text at all, such as a web page at the wrong address', async () => {
    stubFetch(
      new Response('<!doctype html><title>Welcome</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    )
    await expect(service.testConnection(probe(), 10_000)).rejects.toHaveProperty(
      'message',
      'The server at localhost:8080 answered, but not with a transcription. Check the API endpoint.'
    )
  })

  it('does not retry a busy server: the user is watching the button', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<FetchFn>(
      async () =>
        new Response(JSON.stringify({ error: { message: 'busy' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' }
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const outcome = expect(service.testConnection(probe(), 10_000)).rejects.toThrow(
      'The transcription service is temporarily unavailable.'
    )
    await vi.advanceTimersByTimeAsync(10_000)
    await outcome
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a server that is not there either', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<FetchFn>(() => Promise.reject(new TypeError('fetch failed')))
    vi.stubGlobal('fetch', fetchMock)

    const outcome = expect(service.testConnection(probe(), 10_000)).rejects.toThrow(
      'Could not reach the transcription server at localhost:8080. Is it running?'
    )
    await vi.advanceTimersByTimeAsync(10_000)
    await outcome
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a server that does not answer in time', async () => {
    const timeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    const fetchMock = vi.fn<FetchFn>(async (_input, init) => {
      const signal = init?.signal
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const outcome = service.testConnection(probe(), 10_000)
    timeout.abort(new DOMException('timed out', 'TimeoutError'))
    await expect(outcome).rejects.toThrow('Transcription timed out')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('names the server that refused it', async () => {
    stubFetch(refusal(401))
    await expect(service.testConnection(probe(), 10_000)).rejects.toHaveProperty(
      'message',
      'The server at localhost:8080 refused the request (HTTP 401). If it needs a key, add one in Settings.'
    )
  })

  it('sends nothing to OpenAI without a key', async () => {
    const fetchMock = stubFetch(respond('never sent'))
    await expect(service.testConnection(probe({ endpoint: '' }), 10_000)).rejects.toHaveProperty(
      'message',
      'Add an API key in Settings before recording.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * A server on this computer that cannot be reached is almost always one that
 * is not running, so it is named instead of blaming the internet connection.
 * Everywhere else, the network is the likelier culprit, and the wording stays.
 */
describe('TranscriptionService, when the server cannot be reached', () => {
  const LOCAL: Array<[string, string]> = [
    ['http://localhost:8080/v1', 'localhost:8080'],
    ['http://127.0.0.1:9000/v1', '127.0.0.1:9000'],
    ['http://[::1]:8080/v1', '[::1]:8080'],
    ['https://localhost:8443/v1', 'localhost:8443'],
    // No port was given, so none is shown: the address as the user wrote it.
    ['http://localhost/v1', 'localhost']
  ]
  const ELSEWHERE = [
    '',
    'https://api.groq.com/openai/v1',
    // Only this computer's own names count, not a name that merely contains one.
    'https://localhost.example.com/v1',
    'https://127.0.0.1.example.com/v1'
  ]
  const INTERNET = 'Could not reach the transcription service. Check your internet connection.'

  /** A server that refuses every connection, as one that is not running does. */
  const refuseConnections = (): ReturnType<typeof vi.fn<FetchFn>> => {
    const fetchMock = vi.fn<FetchFn>(() => Promise.reject(new TypeError('fetch failed')))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  const request = (endpoint: string): TranscribeInput => ({
    audio: new Uint8Array([1, 2, 3]),
    mimeType: 'audio/wav',
    apiKey: endpoint ? '' : key,
    model: 'whisper-1',
    language: 'en',
    endpoint
  })

  it.each(LOCAL)(
    'names %s in a dictation, after its one quiet retry',
    async (endpoint, host) => {
      vi.useFakeTimers()
      const fetchMock = refuseConnections()
      const outcome = expect(service.transcribe(request(endpoint))).rejects.toHaveProperty(
        'message',
        `Could not reach the transcription server at ${host}. Is it running?`
      )
      await vi.advanceTimersByTimeAsync(700)
      await outcome
      // The retry is unchanged: a server just starting up may answer the second.
      expect(fetchMock).toHaveBeenCalledTimes(2)
    }
  )

  it.each(LOCAL)('names %s in Test connection, at once', async (endpoint, host) => {
    const fetchMock = refuseConnections()
    await expect(
      service.testConnection(request(endpoint), 10_000)
    ).rejects.toHaveProperty(
      'message',
      `Could not reach the transcription server at ${host}. Is it running?`
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(ELSEWHERE)(
    'keeps the internet-connection wording for a dictation to %j',
    async (endpoint) => {
      vi.useFakeTimers()
      refuseConnections()
      const outcome = expect(service.transcribe(request(endpoint))).rejects.toHaveProperty(
        'message',
        INTERNET
      )
      await vi.advanceTimersByTimeAsync(700)
      await outcome
    }
  )

  it.each(ELSEWHERE)(
    'keeps the internet-connection wording for Test connection to %j',
    async (endpoint) => {
      refuseConnections()
      await expect(service.testConnection(request(endpoint), 10_000)).rejects.toHaveProperty(
        'message',
        INTERNET
      )
    }
  )

  it('keeps the timeout sentence for a local server that is reached but too slow', async () => {
    // Slow is not the same as not running, so this wording is left as it was.
    const timeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchFn>(async (_input, init) => {
        const signal = init?.signal
        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      })
    )
    const outcome = service.testConnection(request(LOCAL_SERVER), 10_000)
    timeout.abort(new DOMException('timed out', 'TimeoutError'))
    await expect(outcome).rejects.toThrow('Transcription timed out')
  })
})

