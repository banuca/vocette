import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranscriptionService } from '../src/main/transcription-service'

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
    stubFetch(Promise.reject(new TypeError('fetch failed')))
    await expect(
      service.transcribe({
        audio: new Uint8Array([1]),
        mimeType: 'audio/wav',
        apiKey: key,
        model: 'whisper-1',
        language: 'auto',
        endpoint: ''
      })
    ).rejects.toThrow('Could not reach the transcription service')
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

