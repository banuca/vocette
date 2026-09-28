import { describe, expect, it, vi } from 'vitest'
import {
  CONNECTION_TEST_TIMEOUT_MS,
  runConnectionTest,
  type ConnectionTestSettings
} from '../src/main/connection-test'
import type { ConnectionTestInput } from '../src/main/transcription-service'
import { decodeWav } from '../src/main/wav'

/**
 * What the Test connection button reports, worked out apart from Electron:
 * the one request it makes from saved settings, how long the answer took, and
 * every failure coming back as its sentence rather than as a throw.
 */

type Send = (input: ConnectionTestInput, timeoutMs: number) => Promise<void>

function saved(overrides: Partial<ConnectionTestSettings> = {}): ConnectionTestSettings {
  return {
    endpoint: 'http://localhost:8080/v1',
    model: 'whisper-1',
    language: 'fr',
    apiKey: () => '',
    send: async () => undefined,
    now: () => 0,
    ...overrides
  }
}

describe('runConnectionTest', () => {
  it('sends one second of 16 kHz silence as a WAV, with the saved settings and a 10 s timeout', async () => {
    const send = vi.fn<Send>(async () => undefined)

    await runConnectionTest(saved({ send }))

    expect(send).toHaveBeenCalledTimes(1)
    const [input, timeoutMs] = send.mock.calls[0] ?? []
    expect(timeoutMs).toBe(10_000)
    expect(CONNECTION_TEST_TIMEOUT_MS).toBe(10_000)
    expect(input).toMatchObject({
      mimeType: 'audio/wav',
      apiKey: '',
      model: 'whisper-1',
      language: 'fr',
      endpoint: 'http://localhost:8080/v1'
    })
    const wav = decodeWav(input?.audio ?? new Uint8Array(0))
    expect(wav?.sampleRate).toBe(16_000)
    expect(wav?.samples.length).toBe(16_000)
    expect(wav?.samples.every((sample) => sample === 0)).toBe(true)
  })

  it('passes the saved key along when there is one', async () => {
    const send = vi.fn<Send>(async () => undefined)
    await runConnectionTest(saved({ apiKey: () => 'gsk-saved', send }))
    expect(send.mock.calls[0]?.[0].apiKey).toBe('gsk-saved')
  })

  it('reports how long the answer took, to the nearest millisecond', async () => {
    const readings = [1000, 1180.4]
    const result = await runConnectionTest(saved({ now: () => readings.shift() ?? 0 }))
    expect(result).toEqual({ ok: true, ms: 180, error: null })
  })

  it('turns a failure into its sentence, with no time to report', async () => {
    const refusal =
      'The server at localhost:8080 refused the request (HTTP 401). If it needs a key, add one in Settings.'
    const result = await runConnectionTest(
      saved({ send: () => Promise.reject(new Error(refusal)) })
    )
    expect(result).toEqual({ ok: false, ms: null, error: refusal })
  })

  it('says so when the saved key cannot be read, and sends nothing', async () => {
    const send = vi.fn<Send>(async () => undefined)
    const result = await runConnectionTest(
      saved({
        apiKey: () => {
          throw new Error('The saved API key could not be decrypted. Clear it and add it again.')
        },
        send
      })
    )
    expect(result).toEqual({
      ok: false,
      ms: null,
      error: 'The saved API key could not be decrypted. Clear it and add it again.'
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('still has a sentence for a failure that is not an Error', async () => {
    const result = await runConnectionTest(saved({ send: () => Promise.reject('nope') }))
    expect(result).toEqual({ ok: false, ms: null, error: 'The connection could not be tested.' })
  })
})
