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
