/**
 * Messages between the main process and the speech-engine utility process.
 *
 * Both directions are structured clones, so a `Float32Array` arrives as a
 * `Float32Array`. Neither side trusts the other's shapes: a message that does
 * not parse is dropped rather than acted on.
 */

export type ToWorker =
  | { type: 'load'; modelDir: string; numThreads: number }
  | { type: 'transcribe'; id: string; samples: Float32Array; sampleRate: number }
  | { type: 'unload' }

export type FromWorker =
  | { type: 'loaded'; ms: number }
  | { type: 'result'; id: string; text: string; ms: number }
  /** Without an `id` it concerns loading; with one, that transcription. */
  | { type: 'error'; id?: string; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export function parseToWorker(value: unknown): ToWorker | null {
  if (!isRecord(value)) return null
  switch (value.type) {
    case 'load':
      return typeof value.modelDir === 'string' && isFiniteNumber(value.numThreads)
        ? { type: 'load', modelDir: value.modelDir, numThreads: value.numThreads }
        : null
    case 'transcribe':
      return typeof value.id === 'string' &&
        value.samples instanceof Float32Array &&
        isFiniteNumber(value.sampleRate) &&
        value.sampleRate > 0
        ? { type: 'transcribe', id: value.id, samples: value.samples, sampleRate: value.sampleRate }
        : null
    case 'unload':
      return { type: 'unload' }
    default:
      return null
  }
}

export function parseFromWorker(value: unknown): FromWorker | null {
  if (!isRecord(value)) return null
  switch (value.type) {
    case 'loaded':
      return isFiniteNumber(value.ms) ? { type: 'loaded', ms: value.ms } : null
    case 'result':
      return typeof value.id === 'string' && typeof value.text === 'string' && isFiniteNumber(value.ms)
        ? { type: 'result', id: value.id, text: value.text, ms: value.ms }
        : null
    case 'error':
      if (typeof value.message !== 'string') return null
      return typeof value.id === 'string'
        ? { type: 'error', id: value.id, message: value.message }
        : { type: 'error', message: value.message }
    default:
      return null
  }
}
