import { randomUUID } from 'node:crypto'
import { availableParallelism } from 'node:os'
import { parseFromWorker, type FromWorker, type ToWorker } from './protocol'

/** A worker that has done nothing for this long is killed, freeing its memory. */
export const IDLE_UNLOAD_MS = 5 * 60 * 1000
/**
 * Loading reads 640 MB and normally takes 2–3 s. The first load after a
 * download can be far slower — a cold disk cache, and an antivirus scan of a
 * file it has never seen — so this only catches a load that is truly stuck.
 */
export const LOAD_TIMEOUT_MS = 120_000

export const ENGINE_TOO_SLOW = 'The speech engine took too long.'
export const ENGINE_TOO_SLOW_TO_START = 'The speech engine took too long to start. Try again.'
export const ENGINE_STOPPED = 'The speech engine stopped unexpectedly. Try again.'
export const ENGINE_UNAVAILABLE = 'The speech engine could not start on this PC.'
export const ENGINE_SHUT_DOWN = 'The speech engine has been shut down.'

/**
 * The thread count for the recogniser.
 *
 * Measured on a hybrid laptop CPU (2 performance + 8 efficiency cores): 4
 * threads were fastest in 4 of 5 benchmark batches, and 8 were 2–4× slower
 * than 4, because the extra threads land on efficiency cores and the whole
 * decode waits for the slowest. One core is left for the rest of the system.
 * `os.cpus().length` must never be used: it counts every logical core,
 * efficiency or not.
 */
export function defaultThreadCount(parallelism = availableParallelism()): number {
  return Math.min(4, Math.max(1, parallelism - 1))
}

/** What the engine needs from a worker process; Electron's utility process in production. */
export interface WorkerHandle {
  postMessage(message: ToWorker): void
  kill(): void
  onMessage(listener: (message: unknown) => void): void
  onExit(listener: (code: number) => void): void
}

export interface LocalEngineOptions {
  spawn(): WorkerHandle
  /** The folder holding the verified model files. */
  modelDir: string
  numThreads?: number
}

interface Job {
  resolve(text: string): void
  reject(error: Error): void
}

interface Session {
  handle: WorkerHandle
  loaded: Promise<void>
  resolveLoad(): void
  rejectLoad(error: Error): void
  isLoaded: boolean
  loadTimer: NodeJS.Timeout | null
  jobs: Map<string, Job>
}

function abortError(): DOMException {
  return new DOMException('The transcription was cancelled.', 'AbortError')
}

/**
 * The on-device engine as the main process sees it: one utility process,
 * started on first use, killed when idle or when something goes wrong, and
 * started again by whatever call comes next.
 *
 * Nothing here blocks the main process: the load and every decode run in the
 * worker, and each call either settles with its text or rejects with a plain
 * sentence — a stuck or crashed worker is never left holding a dictation.
 */
export class LocalEngine {
  private session: Session | null = null
  private idleTimer: NodeJS.Timeout | null = null
  /** Calls to `transcribe` that have not settled yet. The worker is never idle-killed under one. */
  private activeCalls = 0
  private disposed = false
  private readonly numThreads: number

  constructor(private readonly options: LocalEngineOptions) {
    this.numThreads = options.numThreads ?? defaultThreadCount()
  }

  /**
   * Starts the worker and loads the model if that is not already happening,
   * so the next dictation does not wait for it. Also restarts the idle clock.
   */
  prewarm(): void {
    if (this.disposed) return
    const session = this.ensureSession()
    // A failed prewarm is reported by the call that actually needs the engine.
    session?.loaded.catch(() => undefined)
    if (this.activeCalls === 0) this.armIdleTimer()
  }

  /**
   * Transcribes mono samples and resolves with the trimmed text.
   *
   * Takes ownership of `samples`. Electron can only transfer message ports to
   * a utility process, not buffers, so posting the job copies the audio into
   * the worker; the copy here is zeroed straight after, or without posting at
   * all if the call ends first. The worker zeroes its own copy once decoded.
   */
  async transcribe(samples: Float32Array, sampleRate: number, signal?: AbortSignal): Promise<string> {
    this.activeCalls += 1
    this.clearIdleTimer()
    try {
      if (this.disposed) throw new Error(ENGINE_SHUT_DOWN)
      if (signal?.aborted) throw abortError()
      if (samples.length === 0) return ''

      const session = this.ensureSession()
      if (!session) throw new Error(ENGINE_UNAVAILABLE)
      await this.untilLoaded(session, signal)
      return (await this.runJob(session, samples, sampleRate, signal)).trim()
    } finally {
      samples.fill(0)
      this.activeCalls -= 1
      if (this.activeCalls === 0) this.armIdleTimer()
    }
  }

  /** Kills the worker now, freeing its memory. The next call starts a new one. */
  unload(): void {
    this.clearIdleTimer()
    const session = this.session
    if (!session) return
    this.endSession(session, new Error(ENGINE_STOPPED))
  }

  /** For quitting: stops the worker and refuses any later call. */
  dispose(): void {
    this.disposed = true
    this.clearIdleTimer()
    const session = this.session
    if (session) this.endSession(session, new Error(ENGINE_SHUT_DOWN))
  }

  private ensureSession(): Session | null {
    if (this.session) return this.session

    let handle: WorkerHandle
    try {
      handle = this.options.spawn()
    } catch {
      return null
    }

    let resolveLoad!: () => void
    let rejectLoad!: (error: Error) => void
    const loaded = new Promise<void>((resolve, reject) => {
      resolveLoad = resolve
      rejectLoad = reject
    })
    // Rejections are always handled by whoever awaits; this only keeps an
    // unobserved one (a prewarm nobody followed up) from being reported.
    loaded.catch(() => undefined)

    const session: Session = {
      handle,
      loaded,
      resolveLoad,
      rejectLoad,
      isLoaded: false,
      loadTimer: null,
      jobs: new Map()
    }
    this.session = session

    handle.onMessage((raw) => {
      const message = parseFromWorker(raw)
      if (message && this.session === session) this.onWorkerMessage(session, message)
    })
    handle.onExit(() => {
      // Only a worker still in use is news; one this class ended is not.
      if (this.session === session) this.endSession(session, new Error(ENGINE_STOPPED))
    })

    session.loadTimer = setTimeout(() => {
      session.loadTimer = null
      if (this.session === session && !session.isLoaded) {
        this.endSession(session, new Error(ENGINE_TOO_SLOW_TO_START))
      }
    }, LOAD_TIMEOUT_MS)

    try {
      handle.postMessage({ type: 'load', modelDir: this.options.modelDir, numThreads: this.numThreads })
    } catch {
      this.endSession(session, new Error(ENGINE_UNAVAILABLE))
    }
    return session
  }

  private onWorkerMessage(session: Session, message: FromWorker): void {
    if (message.type === 'loaded') {
      session.isLoaded = true
      if (session.loadTimer) clearTimeout(session.loadTimer)
      session.loadTimer = null
      session.resolveLoad()
      return
    }
    if (message.type === 'result') {
      const job = session.jobs.get(message.id)
      // A cancelled or timed-out job has already left the map; its late
      // result is dropped here.
      if (job) job.resolve(message.text)
      return
    }
    if (message.id !== undefined) {
      session.jobs.get(message.id)?.reject(new Error(message.message))
      return
    }
    // An error that belongs to no job is about loading, or the worker is
    // about to exit — either way this worker is finished.
    this.endSession(session, new Error(message.message))
  }

  /** Waits for the model, but lets a cancellation through at once. */
  private untilLoaded(session: Session, signal?: AbortSignal): Promise<void> {
    if (session.isLoaded) return Promise.resolve()
    if (!signal) return session.loaded
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => reject(abortError())
      signal.addEventListener('abort', onAbort, { once: true })
      session.loaded.then(
        () => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort)
          reject(error instanceof Error ? error : new Error(ENGINE_STOPPED))
        }
      )
    })
  }

  private runJob(
    session: Session,
    samples: Float32Array,
    sampleRate: number,
    signal?: AbortSignal
  ): Promise<string> {
    if (this.session !== session) return Promise.reject(new Error(ENGINE_STOPPED))
    if (signal?.aborted) return Promise.reject(abortError())

    return new Promise<string>((resolve, reject) => {
      const id = randomUUID()
      const audioSeconds = samples.length / sampleRate
      const timeoutMs = Math.max(20_000, audioSeconds * 1500 + 10_000)

      const settle = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        session.jobs.delete(id)
      }
      const onAbort = (): void => {
        // The decode cannot be interrupted; its result is ignored instead.
        settle()
        reject(abortError())
      }
      const timer = setTimeout(() => {
        settle()
        reject(new Error(ENGINE_TOO_SLOW))
        // Whatever the worker is stuck on, a fresh one starts next time.
        if (this.session === session) this.endSession(session, new Error(ENGINE_TOO_SLOW))
      }, timeoutMs)

      session.jobs.set(id, {
        resolve: (text) => {
          settle()
          resolve(text)
        },
        reject: (error) => {
          settle()
          reject(error)
        }
      })
      signal?.addEventListener('abort', onAbort, { once: true })

      try {
        session.handle.postMessage({ type: 'transcribe', id, samples, sampleRate })
      } catch {
        settle()
        reject(new Error(ENGINE_STOPPED))
      } finally {
        // Posting serialised a copy for the worker; this one is done with.
        samples.fill(0)
      }
    })
  }

  /** Detaches a session, kills its process and fails whatever it still owed. */
  private endSession(session: Session, error: Error): void {
    if (this.session === session) this.session = null
    if (session.loadTimer) clearTimeout(session.loadTimer)
    session.loadTimer = null
    try {
      session.handle.postMessage({ type: 'unload' })
    } catch {
      // The process may already be gone.
    }
    try {
      session.handle.kill()
    } catch {
      // Likewise.
    }
    if (!session.isLoaded) session.rejectLoad(error)
    for (const job of [...session.jobs.values()]) job.reject(error)
    session.jobs.clear()
  }

  private armIdleTimer(): void {
    this.clearIdleTimer()
    if (!this.session || this.disposed) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.activeCalls === 0 && this.session) this.endSession(this.session, new Error(ENGINE_STOPPED))
    }, IDLE_UNLOAD_MS)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}
