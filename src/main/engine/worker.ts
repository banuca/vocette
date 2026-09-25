import { join } from 'node:path'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { splitForDecoding } from './chunking'
import { PARAKEET_FILES } from './models'
import { parseToWorker, type FromWorker } from './protocol'

/**
 * The speech engine, running in its own Electron utility process.
 *
 * It lives apart from the main process for three reasons the spike measured:
 * the recogniser takes about 1 GB that is never handed back until the process
 * exits (so going idle means killing it); a damaged model or a bad native call
 * can end the process with no JavaScript error at all; and a decode takes the
 * better part of a second of CPU. None of that may touch the process that owns
 * the windows, the shortcut and the clipboard.
 *
 * Everything that can fail becomes an `error` message in a plain sentence —
 * the main process shows it as it is.
 */

export const ENGINE_UNAVAILABLE = 'The speech engine could not start on this PC.'
export const MODEL_UNREADABLE =
  'The speech model could not be loaded. Remove it in Settings and download it again.'
export const DECODE_FAILED = 'The speech engine could not transcribe this recording. Try again.'
export const NOT_LOADED = 'The speech engine is not ready yet. Try again.'
export const WORKER_FAULT = 'The speech engine stopped unexpectedly. Try again.'

/** The longest piece decoded in one go; see `splitForDecoding`. */
const MAX_PIECE_SECONDS = 30
const MAX_THREADS = 8

/*
 * The parts of sherpa-onnx-node this worker uses. The package ships no type
 * declarations, so these are written from its JavaScript source (1.13.8).
 */
export interface RecognizerStream {
  acceptWaveform(wave: { sampleRate: number; samples: Float32Array }): void
}

export interface Recognizer {
  createStream(): RecognizerStream
  decodeAsync(stream: RecognizerStream): Promise<{ text?: unknown }>
}

export interface RecognizerConfig {
  featConfig: { sampleRate: number; featureDim: number }
  modelConfig: {
    transducer: { encoder: string; decoder: string; joiner: string }
    tokens: string
    numThreads: number
    provider: 'cpu'
    debug: 0
    modelType: 'nemo_transducer'
  }
  decodingMethod: 'greedy_search'
}

export interface SpeechAddon {
  OfflineRecognizer: { createAsync(config: RecognizerConfig): Promise<Recognizer> }
}

/**
 * The recogniser configuration, fixed apart from where the model is and how
 * many threads it may use.
 *
 * It is a constant on purpose. An unknown `decodingMethod` makes the native
 * code call `exit(-1)` with no JavaScript error, and greedy search combined
 * with hotwords and a `bpe` modelling unit is an access violation — so no
 * hotword, modelling-unit or vocabulary option is ever set here. Vocabulary
 * is corrected after recognition instead. `featureDim` is replaced by the
 * model's own metadata (128) when it loads.
 */
export function recognizerConfig(modelDir: string, numThreads: number): RecognizerConfig {
  return {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(modelDir, PARAKEET_FILES.encoder),
        decoder: join(modelDir, PARAKEET_FILES.decoder),
        joiner: join(modelDir, PARAKEET_FILES.joiner)
      },
      tokens: join(modelDir, PARAKEET_FILES.tokens),
      numThreads: Math.min(MAX_THREADS, Math.max(1, Math.floor(numThreads) || 1)),
      provider: 'cpu',
      debug: 0,
      modelType: 'nemo_transducer'
    },
    decodingMethod: 'greedy_search'
  }
}

export interface WorkerPort {
  post(message: FromWorker): void
  listen(listener: (message: unknown) => void): void
}

export interface WorkerDeps {
  /** Requires the native addon; throws when it cannot be loaded. */
  loadAddon(): SpeechAddon
  /** Lets V8 free the native streams it still holds. A no-op if unavailable. */
  collectGarbage(): void
  exit(code: number): void
  now(): number
}

/**
 * Wires the engine to a message port. Jobs run strictly one at a time, in the
 * order they arrive: a take cancelled mid-decode still finishes here (a decode
 * cannot be interrupted), and the next one waits rather than doubling the
 * memory with a second decode alongside it.
 */
export function startEngineWorker(port: WorkerPort, deps: WorkerDeps): void {
  let recognizer: Recognizer | null = null
  let queue: Promise<void> = Promise.resolve()
  /**
   * The native decode holds raw pointers to the stream and the recogniser, so
   * the JavaScript objects must stay reachable until it settles; this set is
   * what keeps each stream alive.
   */
  const inFlight = new Set<RecognizerStream>()

  const enqueue = (job: () => Promise<void>): void => {
    // Each job reports its own failures; this only keeps the chain alive.
    queue = queue.then(job).catch(() => undefined)
  }

  const load = async (modelDir: string, numThreads: number): Promise<void> => {
    if (recognizer) {
      port.post({ type: 'loaded', ms: 0 })
      return
    }
    const started = deps.now()
    let addon: SpeechAddon
    try {
      addon = deps.loadAddon()
    } catch {
      port.post({ type: 'error', message: ENGINE_UNAVAILABLE })
      return
    }
    try {
      // Only ever the asynchronous factory. The synchronous constructor
      // aborts the whole process on a truncated or damaged model file, where
      // this one rejects cleanly and leaves the worker able to try again.
      recognizer = await addon.OfflineRecognizer.createAsync(recognizerConfig(modelDir, numThreads))
      port.post({ type: 'loaded', ms: Math.round(deps.now() - started) })
    } catch {
      port.post({ type: 'error', message: MODEL_UNREADABLE })
    } finally {
      deps.collectGarbage()
    }
  }

  const transcribe = async (id: string, samples: Float32Array, sampleRate: number): Promise<void> => {
    const started = deps.now()
    const active = recognizer
    try {
      if (!active) {
        port.post({ type: 'error', id, message: NOT_LOADED })
        return
      }
      const texts: string[] = []
      for (const piece of splitForDecoding(samples, sampleRate, MAX_PIECE_SECONDS)) {
        if (piece.length === 0) continue
        const stream = active.createStream()
        inFlight.add(stream)
        try {
          stream.acceptWaveform({ sampleRate, samples: piece })
          const result = await active.decodeAsync(stream)
          const text = typeof result?.text === 'string' ? result.text.trim() : ''
          if (text) texts.push(text)
        } finally {
          inFlight.delete(stream)
        }
      }
      port.post({ type: 'result', id, text: texts.join(' '), ms: Math.round(deps.now() - started) })
    } catch {
      port.post({ type: 'error', id, message: DECODE_FAILED })
    } finally {
      // This process's copy of the user's audio; the main process zeroed its own.
      samples.fill(0)
      deps.collectGarbage()
    }
  }

  port.listen((raw) => {
    const message = parseToWorker(raw)
    if (!message) {
      // A job that cannot be read still gets an answer, or its caller would
      // wait for the timeout.
      const id = (raw as { id?: unknown } | null)?.id
      if (typeof id === 'string') port.post({ type: 'error', id, message: DECODE_FAILED })
      return
    }
    if (message.type === 'unload') {
      // Memory the recogniser took is only returned when the process ends.
      recognizer = null
      deps.exit(0)
      return
    }
    if (message.type === 'load') {
      enqueue(() => load(message.modelDir, message.numThreads))
      return
    }
    enqueue(() => transcribe(message.id, message.samples, message.sampleRate))
  })
}

/**
 * A working `gc()`. `--expose-gc` in `execArgv` shows up in the arguments but
 * does not define it in a utility process; setting the flag at runtime and
 * reading `gc` from a fresh context does. Without it, native streams are only
 * freed whenever V8 happens to collect, and memory creeps between takes.
 */
function obtainGarbageCollector(): () => void {
  try {
    setFlagsFromString('--expose-gc')
    const gc: unknown = runInNewContext('gc')
    if (typeof gc === 'function') return () => void gc()
  } catch {
    // Collection just happens later.
  }
  return () => undefined
}

// Only inside a utility process; importing this module anywhere else (a test)
// starts nothing.
const parentPort = process.parentPort as Electron.ParentPort | undefined
if (parentPort) {
  const post = (message: FromWorker): void => parentPort.postMessage(message)
  // Anything that escapes the handlers above is a bug. Say so, then leave:
  // a worker in an unknown state is worse than one the main process respawns.
  const fault = (): void => {
    try {
      post({ type: 'error', message: WORKER_FAULT })
    } finally {
      process.exit(1)
    }
  }
  process.on('uncaughtException', fault)
  process.on('unhandledRejection', fault)

  startEngineWorker(
    {
      post,
      listen: (listener) => parentPort.on('message', (event) => listener(event.data))
    },
    {
      // Required on first load, not at start-up: a missing or broken native
      // package then becomes a message the user can read.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loadAddon: () => require('sherpa-onnx-node') as SpeechAddon,
      collectGarbage: obtainGarbageCollector(),
      exit: (code) => process.exit(code),
      now: () => performance.now()
    }
  )
}
