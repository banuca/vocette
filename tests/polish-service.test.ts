import { afterEach, describe, expect, it, vi } from 'vitest'
import { polishText, requestPolish, type PolishRequest } from '../src/main/polish-service'

const TEXT = 'so um I think we should move the meeting to Wednesday'

function request(patch: Partial<PolishRequest> = {}): PolishRequest {
  return {
    text: TEXT,
    style: 'clean',
    instructions: '',
    terms: [],
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    apiKey: 'sk-polish',
    budgetMs: 4000,
    ...patch
  }
}

function chat(content: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(status === 200 ? { choices: [{ message: { content } }] } : content),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}

type FetchArgs = [string, RequestInit]

function stubFetch(...answers: Array<Response | Error | ((init: RequestInit) => Promise<Response>)>) {
  const calls: FetchArgs[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push([url, init])
    const answer = answers.shift()
    if (!answer) throw new Error('no answer left')
    if (answer instanceof Error) throw answer
    if (typeof answer === 'function') return answer(init)
    return answer
  })
  vi.stubGlobal('fetch', fetch)
  return calls
}

const body = (init: RequestInit | undefined): Record<string, unknown> =>
  JSON.parse(String(init?.body)) as Record<string, unknown>

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('requestPolish', () => {
  it('sends one chat request with the transcript as the user message', async () => {
    const calls = stubFetch(chat('I think we should move the meeting to Wednesday.'))
    const reply = await requestPolish(request({ terms: ['Kirinde'] }))
    expect(reply).toBe('I think we should move the meeting to Wednesday.')
    expect(calls).toHaveLength(1)
    const [url, init] = calls[0] as FetchArgs
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-polish'
    })
    const sent = body(init)
    expect(sent.model).toBe('gpt-4.1-mini')
    expect(sent.temperature).toBe(0.2)
    const messages = sent.messages as Array<{ role: string; content: string }>
    expect(messages.map((message) => message.role)).toEqual(['system', 'user'])
    expect(messages[1]?.content).toBe(TEXT)
    expect(messages[0]?.content).toContain('Spell these exactly as written: Kirinde.')
  })

  it('sends no Authorization header without a key, and trims a trailing slash', async () => {
    const calls = stubFetch(chat('Fine.'))
    await requestPolish(request({ apiKey: '', endpoint: 'http://localhost:11434/v1/' }))
    const [url, init] = calls[0] as FetchArgs
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('asks once more without a temperature when the model refuses one', async () => {
    const calls = stubFetch(
      chat({ error: { message: "Unsupported value: 'temperature' does not support 0.2" } }, 400),
      chat('Done.')
    )
    await expect(requestPolish(request())).resolves.toBe('Done.')
    expect(calls).toHaveLength(2)
    expect(body(calls[0]?.[1])).toHaveProperty('temperature', 0.2)
    expect(body(calls[1]?.[1])).not.toHaveProperty('temperature')
  })

  it('does not retry any other refusal', async () => {
    const calls = stubFetch(chat({ error: { message: 'Bad request' } }, 400))
    await expect(requestPolish(request())).rejects.toMatchObject({ reason: 'HTTP 400' })
    expect(calls).toHaveLength(1)
  })

  it('says why, in a few words for the overlay and a sentence for Test', async () => {
    const cases: Array<[Response | Error, Partial<PolishRequest>, string, string]> = [
      [chat({}, 401), {}, 'the key was refused', 'api.openai.com refused the key (HTTP 401). Check the polish key.'],
      [chat({}, 401), { apiKey: '' }, 'the key was refused', 'api.openai.com needs a key (HTTP 401). Add one for polish.'],
      [chat({ error: { message: "model 'x' not found" } }, 404), {}, 'model not found', 'api.openai.com does not have that model (HTTP 404). Check the model name.'],
      [chat({}, 429), {}, 'rate limited', 'api.openai.com is limiting requests (HTTP 429). Try again later.'],
      [chat({}, 503), {}, 'the service had an error', 'api.openai.com had an error (HTTP 503).'],
      [new TypeError('fetch failed'), { endpoint: 'http://localhost:11434/v1' }, 'localhost:11434 is not running', 'Could not reach localhost:11434. Is it running?'],
      [new TypeError('fetch failed'), {}, 'could not reach the service', 'Could not reach api.openai.com. Check your internet connection.'],
      [new Response('<html>not an API</html>', { status: 200 }), {}, 'the reply looked wrong', 'api.openai.com answered, but not like a chat API. Check the endpoint.']
    ]
    for (const [answer, patch, reason, message] of cases) {
      stubFetch(answer)
      await expect(requestPolish(request(patch))).rejects.toMatchObject({ reason, message })
      vi.unstubAllGlobals()
    }
  })

  it('needs a model before it sends anything', async () => {
    const calls = stubFetch(chat('never'))
    await expect(requestPolish(request({ model: '  ' }))).rejects.toMatchObject({
      reason: 'no model chosen'
    })
    expect(calls).toHaveLength(0)
  })

  it('stops at the time limit', async () => {
    vi.useFakeTimers()
    stubFetch(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
    )
    const pending = requestPolish(request({ budgetMs: 2000 }))
    const outcome = expect(pending).rejects.toMatchObject({
      reason: 'took too long',
      message: 'No answer within 2 seconds.'
    })
    await vi.advanceTimersByTimeAsync(2000)
    await outcome
  })
})

describe('polishText', () => {
  it('uses the reply when it passes the guard', async () => {
    stubFetch(chat('“I think we should move the meeting to Wednesday.”'))
    await expect(polishText(request())).resolves.toEqual({
      text: 'I think we should move the meeting to Wednesday.',
      polished: true,
      note: null
    })
  })

  it('keeps the text unpolished, with a reason, whenever anything goes wrong', async () => {
    stubFetch(chat("Sure! Here's your text:\nI think we should move the meeting."))
    await expect(polishText(request())).resolves.toEqual({
      text: TEXT,
      polished: false,
      note: 'the reply looked wrong'
    })

    stubFetch(chat({}, 401))
    await expect(polishText(request())).resolves.toEqual({
      text: TEXT,
      polished: false,
      note: 'the key was refused'
    })
  })

  it('reports an unchanged reply as not polished, with nothing to explain', async () => {
    stubFetch(chat(TEXT))
    await expect(polishText(request())).resolves.toEqual({ text: TEXT, polished: false, note: null })
  })

  it('sends nothing more once the dictation is cancelled', async () => {
    const controller = new AbortController()
    const calls = stubFetch(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
    )
    const pending = polishText(request({ signal: controller.signal }))
    controller.abort()
    const outcome = await pending
    expect(outcome.polished).toBe(false)
    expect(outcome.text).toBe(TEXT)
    expect(calls).toHaveLength(1)
  })
})
