import type { TranscriptionTestResult } from '../shared/types'
import type { ConnectionTestInput } from './transcription-service'
import { silentWav } from './wav'

/**
 * How long Test connection waits for an answer. A dictation waits two
 * minutes, but here the user is watching the button, and a server that takes
 * longer than this to answer a second of silence is worth hearing about.
 */
export const CONNECTION_TEST_TIMEOUT_MS = 10_000

/** A real request, but too short to cost anything worth counting. */
const TEST_AUDIO_SECONDS = 1

export interface ConnectionTestSettings {
  /**
   * The saved cloud settings, never what is typed but unsaved: the saved key
   * must go nowhere but the saved endpoint, so the page waits for Save.
   */
  endpoint: string
  model: string
  language: string
  /** Reads the saved key. It throws when the system cannot decrypt it. */
  apiKey: () => string
  /** The one request. It rejects with the sentence to show. */
  send: (input: ConnectionTestInput, timeoutMs: number) => Promise<void>
  /** A clock that only moves forward, in milliseconds. */
  now: () => number
}

/**
 * What the Test connection button reports: one second of silence sent to the
 * saved endpoint as a WAV, exactly as a dictation's would be, and how long the
 * answer took. Every failure — a key that cannot be read, a server that is not
 * there, one that refuses — comes back as its sentence, never as a throw.
 */
export async function runConnectionTest(
  settings: ConnectionTestSettings
): Promise<TranscriptionTestResult> {
  try {
    const input: ConnectionTestInput = {
      audio: silentWav(TEST_AUDIO_SECONDS),
      mimeType: 'audio/wav',
      apiKey: settings.apiKey(),
      model: settings.model,
      language: settings.language,
      endpoint: settings.endpoint
    }
    const started = settings.now()
    await settings.send(input, CONNECTION_TEST_TIMEOUT_MS)
    return { ok: true, ms: Math.max(0, Math.round(settings.now() - started)), error: null }
  } catch (error) {
    return {
      ok: false,
      ms: null,
      error: error instanceof Error ? error.message : 'The connection could not be tested.'
    }
  }
}
