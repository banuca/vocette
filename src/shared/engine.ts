import type { PublicSettings, TranscriptionEngine } from './types'

/**
 * Where the on-device speech model stands.
 *
 * `missing`, `partial` and `installed` are read from disk; `downloading`,
 * `verifying` and `failed` exist only while (or just after) this session ran a
 * download, so a restart shows what is actually on disk.
 */
export type ModelState =
  | 'missing'
  | 'partial'
  | 'downloading'
  | 'verifying'
  | 'installed'
  | 'failed'

export interface ModelStatus {
  id: string
  state: ModelState
  /** Bytes on disk and accounted for; the total once installed. */
  receivedBytes: number
  totalBytes: number
  /** The plain sentence from the last failed download, otherwise null. */
  error: string | null
}

/**
 * Everything the window needs to know about transcription readiness. Carries
 * no key material and no paths: it crosses the bridge into the renderer.
 */
export interface EngineStatus {
  engine: TranscriptionEngine
  model: ModelStatus
  /** True when a dictation started now could be transcribed. */
  ready: boolean
  /** Why not, in words the record control and setup guidance can show as-is. */
  notReadyReason: string | null
}

export const MODEL_NOT_READY_REASON = 'Download the speech model first.'
/** The cloud engine's reason, which only arises with no endpoint set: OpenAI's. */
export const KEY_NOT_READY_REASON = 'Add your API key in Settings before recording.'

/**
 * Why the model cannot be removed right now. The main process refuses with
 * these words, and Settings says the same beside the button it disables.
 */
export const REMOVE_WHILE_DICTATING =
  'Wait for the current dictation to finish before removing the speech model.'

export interface Readiness {
  ready: boolean
  notReadyReason: string | null
}

/**
 * Whether the chosen engine has what it needs. The on-device engine needs its
 * model on disk and verified. The cloud engine needs a key, wherever it is
 * held — or an endpoint of the user's own: whisper.cpp, Speaches or a
 * corporate deployment may need no key at all, and only the server can say
 * whether it does. OpenAI itself, reached when no endpoint is set, always
 * needs one, so there the reason still asks for it.
 *
 * Nothing else is checked here — a microphone or a permission is a separate
 * matter, and a network or server the cloud engine may not reach is only
 * known when it is tried.
 */
export function engineReady(
  settings: Pick<PublicSettings, 'engine' | 'apiKeySource' | 'apiEndpoint'>,
  modelState: ModelState
): Readiness {
  if (settings.engine === 'local') {
    return modelState === 'installed'
      ? { ready: true, notReadyReason: null }
      : { ready: false, notReadyReason: MODEL_NOT_READY_REASON }
  }
  return settings.apiKeySource !== 'none' || settings.apiEndpoint.trim() !== ''
    ? { ready: true, notReadyReason: null }
    : { ready: false, notReadyReason: KEY_NOT_READY_REASON }
}
