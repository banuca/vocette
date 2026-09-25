import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ENGINE_SHUT_DOWN,
  ENGINE_STOPPED,
  ENGINE_TOO_SLOW,
  ENGINE_TOO_SLOW_TO_START,
  ENGINE_UNAVAILABLE,
  IDLE_UNLOAD_MS,
  LOAD_TIMEOUT_MS,
  LocalEngine,
  defaultThreadCount,
  type WorkerHandle
} from '../src/main/engine/local-engine'
import type { FromWorker, ToWorker } from '../src/main/engine/protocol'

/**
 * The engine's promises to the dictation controller: every call settles —
 * with text, or with a sentence — whatever the worker does, and the worker's
 * gigabyte is given back when it is not needed.
 */

class FakeWorker implements WorkerHandle {
  /** What was posted, with the audio copied as structured cloning would. */
  readonly posted: ToWorker[] = []
  killed = false
  private readonly messageListeners: Array<(message: unknown) => void> = []
  private readonly exitListeners: Array<(code: number) => void> = []

  postMessage(message: ToWorker): void {
    this.posted.push(
      message.type === 'transcribe' ? { ...message, samples: message.samples.slice() } : message
    )
  }

  kill(): void {
    this.killed = true
  }

  onMessage(listener: (message: unknown) => void): void {
    this.messageListeners.push(listener)
  }

  onExit(listener: (code: number) => void): void {
    this.exitListeners.push(listener)
  }

  send(message: FromWorker | Record<string, unknown>): void {
    for (const listener of this.messageListeners) listener(message)
  }

  exit(code = 1): void {
    for (const listener of this.exitListeners) listener(code)
  }

  loads(): number {
    return this.posted.filter((message) => message.type === 'load').length
  }

  jobs(): Array<Extract<ToWorker, { type: 'transcribe' }>> {
    return this.posted.filter(
      (message): message is Extract<ToWorker, { type: 'transcribe' }> => message.type === 'transcribe'
    )
  }

  lastJob(): Extract<ToWorker, { type: 'transcribe' }> {
    const job = this.jobs().at(-1)
    if (!job) throw new Error('No job was posted.')
    return job
  }

  unloads(): number {
    return this.posted.filter((message) => message.type === 'unload').length
  }
}

function harness(options: { spawnFails?: boolean } = {}) {
  const workers: FakeWorker[] = []
  const engine = new LocalEngine({
    spawn: () => {
      if (options.spawnFails) throw new Error('spawn EACCES')
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    modelDir: 'C:\\models\\parakeet-tdt-0.6b-v3-int8',
    numThreads: 3
  })
  const worker = (index = -1): FakeWorker => {
    const found = workers.at(index)
    if (!found) throw new Error('No worker was spawned.')
    return found
  }
  return { engine, workers, worker }
}

/** One second of 16 kHz audio per `seconds`, never silent, so zeroing shows. */
const audio = (seconds: number): Float32Array => new Float32Array(Math.round(seconds * 16000)).fill(0.25)

/** Lets the engine's promise chains move on without moving the clock. */
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0)
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    return error as Error
  }
  throw new Error('Expected the promise to reject.')
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LocalEngine.transcribe', () => {
  it('starts nothing until it is needed', () => {
    const { workers } = harness()
    expect(workers).toHaveLength(0)
  })

  it('spawns and loads on first use, then transcribes and trims the text', async () => {
    const { engine, workers, worker } = harness()
    const samples = audio(2)
    const result = engine.transcribe(samples, 16000)
    await flush()

    expect(workers).toHaveLength(1)
    expect(worker().posted[0]).toEqual({
      type: 'load',
      modelDir: 'C:\\models\\parakeet-tdt-0.6b-v3-int8',
      numThreads: 3
    })
    // Nothing is sent to decode before the model is loaded.
    expect(worker().jobs()).toHaveLength(0)

    worker().send({ type: 'loaded', ms: 2100 })
    await flush()
    const job = worker().lastJob()
    expect(job.sampleRate).toBe(16000)
    expect(job.samples).toEqual(audio(2))

    worker().send({ type: 'result', id: job.id, text: '  Hello from this PC.  ', ms: 600 })
    await expect(result).resolves.toBe('Hello from this PC.')
  })

  it('zeroes its own copy of the audio as soon as the job is posted', async () => {
    const { engine, worker } = harness()
    const samples = audio(1)
    const result = engine.transcribe(samples, 16000)
    await flush()
    worker().send({ type: 'loaded', ms: 1 })
    await flush()

    // The worker was sent the real audio; the main process kept none of it.
    expect(worker().lastJob().samples.every((value) => value === 0.25)).toBe(true)
    expect(samples.every((value) => value === 0)).toBe(true)

    worker().send({ type: 'result', id: worker().lastJob().id, text: 'Hi.', ms: 1 })
    await result
  })

  it('shares one load between calls that arrive while it runs', async () => {
    const { engine, workers, worker } = harness()
    const first = engine.transcribe(audio(1), 16000)
    const second = engine.transcribe(audio(1), 16000)
    await flush()
    expect(workers).toHaveLength(1)
    expect(worker().loads()).toBe(1)

    worker().send({ type: 'loaded', ms: 1 })
    await flush()
    const [a, b] = worker().jobs()
    worker().send({ type: 'result', id: b?.id ?? '', text: 'Second.', ms: 1 })
    worker().send({ type: 'result', id: a?.id ?? '', text: 'First.', ms: 1 })
    await expect(first).resolves.toBe('First.')
    await expect(second).resolves.toBe('Second.')
  })

  it('keeps using a loaded worker', async () => {
    const { engine, workers, worker } = harness()
    const first = engine.transcribe(audio(1), 16000)
    await flush()
    worker().send({ type: 'loaded', ms: 1 })
    await flush()
    worker().send({ type: 'result', id: worker().lastJob().id, text: 'One.', ms: 1 })
    await first

    const second = engine.transcribe(audio(1), 16000)
    await flush()
    expect(workers).toHaveLength(1)
    expect(worker().loads()).toBe(1)
    worker().send({ type: 'result', id: worker().lastJob().id, text: 'Two.', ms: 1 })
    await expect(second).resolves.toBe('Two.')
  })

  it('returns nothing for no audio, without starting anything', async () => {
    const { engine, workers } = harness()
    await expect(engine.transcribe(new Float32Array(0), 16000)).resolves.toBe('')
    expect(workers).toHaveLength(0)
  })

  it('passes on a failed job in the worker’s own words, and keeps the worker', async () => {
    const { engine, workers, worker } = harness()
    const result = engine.transcribe(audio(1), 16000)
    await flush()
    worker().send({ type: 'loaded', ms: 1 })
    await flush()
    worker().send({
      type: 'error',
      id: worker().lastJob().id,
      message: 'The speech engine could not transcribe this recording. Try again.'
    })
    expect((await rejection(result)).message).toBe(
      'The speech engine could not transcribe this recording. Try again.'
    )
    expect(worker().killed).toBe(false)

    const next = engine.transcribe(audio(1), 16000)
    await flush()
    expect(workers).toHaveLength(1)
    worker().send({ type: 'result', id: worker().lastJob().id, text: 'Fine now.', ms: 1 })
    await expect(next).resolves.toBe('Fine now.')
  })

  it('reports a model that will not load, and starts afresh next time', async () => {
    const { engine, workers, worker } = harness()
    const result = engine.transcribe(audio(1), 16000)
    await flush()
    worker().send({
      type: 'error',
      message: 'The speech model could not be loaded. Remove it in Settings and download it again.'
    })
    expect((await rejection(result)).message).toBe(
      'The speech model could not be loaded. Remove it in Settings and download it again.'
    )
    expect(worker().killed).toBe(true)

    void engine.transcribe(audio(1), 16000).catch(() => undefined)
    await flush()
    expect(workers).toHaveLength(2)
    expect(worker().loads()).toBe(1)
  })

  it('says so when a worker cannot be started at all', async () => {
    const { engine } = harness({ spawnFails: true })
    expect((await rejection(engine.transcribe(audio(1), 16000))).message).toBe(ENGINE_UNAVAILABLE)
  })

  it('ignores messages it cannot read', async () => {
    const { engine, worker } = harness()
    const result = engine.transcribe(audio(1), 16000)
    await flush()
    worker().send({ type: 'loaded' }) // no ms
    worker().send({ type: 'surprise' })
    await flush()
    expect(worker().jobs()).toHaveLength(0)
    worker().send({ type: 'loaded', ms: 1 })
    await flush()
    worker().send({ type: 'result', id: worker().lastJob().id, text: 42 })
    worker().send({ type: 'result', id: worker().lastJob().id, text: 'Read.', ms: 1 })
    await expect(result).resolves.toBe('Read.')
  })
})

describe('when the worker is slow', () => {
  it('gives up after max(20 s, 1.5 × audio + 10 s), and kills the worker', async () => {
    const { engine, workers, worker } = harness()
    // 60 s of audio: 60 × 1.5 + 10 = 100 s.
    const result = engine.transcribe(audio(60), 16000)
    const failed = rejection(result)
    await flush()
    worker().send({ type: 'loaded', ms: 1 })
    await flush()

    await vi.advanceTimersByTimeAsync(99_999)
    expect(worker().killed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect((await failed).message).toBe('The speech engine took too long.')
    expect((await failed).message).toBe(ENGINE_TOO_SLOW)
    expect(worker().killed).toBe(true)

    // The next call gets a fresh worker.
    void engine.transcribe(audio(1), 16000).catch(() => undefined)
    await flush()
    expect(workers).toHaveLength(2)
  })

  it('allows at least 20 s for a short take', async () => {
    const { engine, worker } = harness()
    const failed = rejection(engine.transcribe(audio(2), 16000))
    await flush()
    worker().send({ type: 'loaded', ms: 1 })
    await flush()
    await vi.advanceTimersByTimeAsync(19_999)
    expect(worker().killed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect((await failed).message).toBe(ENGINE_TOO_SLOW)
  })

  it('gives up on a load that never finishes', async () => {
    const { engine, worker } = harness()
    const failed = rejection(engine.transcribe(audio(2), 16000))
    await flush()
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS)
    expect((await failed).message).toBe(ENGINE_TOO_SLOW_TO_START)
    expect(worker().killed).toBe(true)
  })
})

describe('cancelling', () => {
  it('rejects at once with an AbortError and ignores the late result', async () => {
    const { engine, workers, worker } = harness()
    const controller = new AbortController()
    const result = engine.transcribe(audio(1), 16000, controller.signal)
    await flush()
    worker().send({ type: 'loaded', ms: 1 })
    await flush()
    const job = worker().lastJob()

    controller.abort()
    const error = await rejection(result)
    expect(error.name).toBe('AbortError')

    // A decode cannot be interrupted: the worker finishes it, and nobody listens.
    worker().send({ type: 'result', id: job.id, text: 'Too late.', ms: 1 })
    expect(worker().killed).toBe(false)

    const next = engine.transcribe(audio(1), 16000)
    await flush()
    expect(workers).toHaveLength(1)
    worker().send({ type: 'result', id: worker().lastJob().id, text: 'Next take.', ms: 1 })
    await expect(next).resolves.toBe('Next take.')
  })

  it('rejects at once while the model is still loading, and lets the load finish', async () => {
    const { engine, workers, worker } = harness()
    const controller = new AbortController()
    const result = engine.transcribe(audio(1), 16000, controller.signal)
    await flush()
    controller.abort()
    expect((await rejection(result)).name).toBe('AbortError')
    expect(worker().jobs()).toHaveLength(0)
    expect(worker().killed).toBe(false)

    worker().send({ type: 'loaded', ms: 1 })
    const next = engine.transcribe(audio(1), 16000)
    await flush()
    expect(workers).toHaveLength(1)
    worker().send({ type: 'result', id: worker().lastJob().id, text: 'Loaded already.', ms: 1 })
    await expect(next).resolves.toBe('Loaded already.')
  })

  it('does not even start for a signal that has already fired', async () => {
    const { engine, workers } = harness()
    const controller = new AbortController()
    controller.abort()
    const samples = audio(1)
    expect((await rejection(engine.transcribe(samples, 16000, controller.signal))).name).toBe(
      'AbortError'
    )
    expect(workers).toHaveLength(0)
    // Its audio is still not left lying around.
    expect(samples.every((value) => value === 0)).toBe(true)
  })
})

describe('when the worker dies', () => {
  it('rejects what was pending, and the next call starts a new one', async () => {
    const { engine, workers, worker } = harness()
    const result = engine.transcribe(audio(1), 16000)
    await flush()
    worker().send({ type: 'loaded', ms: 1 })
    await flush()
    // An access violation in the native code: no JavaScript error, just gone.
    worker().exit(3221225477)
    expect((await rejection(result)).message).toBe(
      'The speech engine stopped unexpectedly. Try again.'
    )

    const next = engine.transcribe(audio(1), 16000)
    await flush()
    expect(workers).toHaveLength(2)
    worker().send({ type: 'loaded', ms: 1 })
    await flush()
    worker().send({ type: 'result', id: worker().lastJob().id, text: 'Back.', ms: 1 })
    await expect(next).resolves.toBe('Back.')
  })

  it('rejects a call still waiting for the model to load', async () => {
    const { engine, worker } = harness()
    const result = engine.transcribe(audio(1), 16000)
    await flush()
    worker().exit(1)
    expect((await rejection(result)).message).toBe(ENGINE_STOPPED)
  })

  it('pays no attention to a worker it has already replaced', async () => {
    const { engine, workers, worker } = harness()
    const first = rejection(engine.transcribe(audio(1), 16000))
    await flush()
    const old = worker()
    old.exit(1)
    await first

    const next = engine.transcribe(audio(1), 16000)
    await flush()
    expect(workers).toHaveLength(2)
    // The dead worker's last words change nothing.
    old.send({ type: 'loaded', ms: 1 })
    old.exit(1)
    await flush()
    expect(worker().jobs()).toHaveLength(0)
    worker().send({ type: 'loaded', ms: 1 })
    await flush()
    worker().send({ type: 'result', id: worker().lastJob().id, text: 'New worker.', ms: 1 })
    await expect(next).resolves.toBe('New worker.')
  })
})

describe('idle unload', () => {
  async function transcribeOnce(engine: LocalEngine, worker: () => FakeWorker): Promise<void> {
    const result = engine.transcribe(audio(1), 16000)
    await flush()
    if (worker().loads() === 1 && worker().jobs().length === 0) {
      worker().send({ type: 'loaded', ms: 1 })
      await flush()
    }
    worker().send({ type: 'result', id: worker().lastJob().id, text: 'Done.', ms: 1 })
    await result
  }

  it('kills the worker five minutes after the last transcription', async () => {
    const { engine, worker } = harness()
    await transcribeOnce(engine, worker)
    await vi.advanceTimersByTimeAsync(IDLE_UNLOAD_MS - 1)
    expect(worker().killed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(worker().killed).toBe(true)
    expect(worker().unloads()).toBe(1)
    expect(IDLE_UNLOAD_MS).toBe(5 * 60 * 1000)
  })

  it('restarts the clock with every use', async () => {
    const { engine, workers, worker } = harness()
    await transcribeOnce(engine, worker)
    await vi.advanceTimersByTimeAsync(IDLE_UNLOAD_MS - 1000)
    await transcribeOnce(engine, worker)
    await vi.advanceTimersByTimeAsync(IDLE_UNLOAD_MS - 1000)
    expect(worker().killed).toBe(false)
    expect(workers).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(worker().killed).toBe(true)
  })

  it('never unloads under a transcription still running', async () => {
    const { engine, worker } = harness()
    // Five minutes of audio is allowed longer than five minutes to decode.
    const result = engine.transcribe(audio(300), 16000)
    await flush()
    worker().send({ type: 'loaded', ms: 1 })
    await flush()
    await vi.advanceTimersByTimeAsync(IDLE_UNLOAD_MS + 1000)
    expect(worker().killed).toBe(false)
    worker().send({ type: 'result', id: worker().lastJob().id, text: 'Long.', ms: 1 })
    await expect(result).resolves.toBe('Long.')
  })

  it('starts again after an unload, loading the model once more', async () => {
    const { engine, workers, worker } = harness()
    await transcribeOnce(engine, worker)
    await vi.advanceTimersByTimeAsync(IDLE_UNLOAD_MS)
    await transcribeOnce(engine, worker)
    expect(workers).toHaveLength(2)
    expect(worker().loads()).toBe(1)
  })
})

describe('LocalEngine.prewarm', () => {
  it('spawns and loads once, however often it is called', async () => {
    const { engine, workers, worker } = harness()
    engine.prewarm()
    engine.prewarm()
    await flush()
    expect(workers).toHaveLength(1)
    expect(worker().loads()).toBe(1)
    worker().send({ type: 'loaded', ms: 1 })
    engine.prewarm()
    await flush()
    expect(workers).toHaveLength(1)
    expect(worker().loads()).toBe(1)
  })

  it('makes the next transcription skip the wait for the model', async () => {
    const { engine, worker } = harness()
    engine.prewarm()
    worker().send({ type: 'loaded', ms: 1 })
    const result = engine.transcribe(audio(1), 16000)
    await flush()
    expect(worker().jobs()).toHaveLength(1)
    worker().send({ type: 'result', id: worker().lastJob().id, text: 'Quick.', ms: 1 })
    await expect(result).resolves.toBe('Quick.')
  })

  it('restarts the idle clock, so an unused prewarm is released too', async () => {
    const { engine, worker } = harness()
    engine.prewarm()
    worker().send({ type: 'loaded', ms: 1 })
    await vi.advanceTimersByTimeAsync(IDLE_UNLOAD_MS - 1)
    expect(worker().killed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(worker().killed).toBe(true)
  })

  it('keeps a failed prewarm quiet, leaving the error to the call that needs the engine', async () => {
    const { engine, worker } = harness()
    engine.prewarm()
    worker().send({ type: 'error', message: 'The speech engine could not start on this PC.' })
    await flush()
    expect(worker().killed).toBe(true)
  })
})

describe('unload and dispose', () => {
  it('unload kills the worker now, and the next call starts another', async () => {
    const { engine, workers, worker } = harness()
    engine.prewarm()
    worker().send({ type: 'loaded', ms: 1 })
    engine.unload()
    expect(worker().killed).toBe(true)
    void engine.transcribe(audio(1), 16000).catch(() => undefined)
    await flush()
    expect(workers).toHaveLength(2)
  })

  it('dispose kills the worker, fails what was pending and refuses what comes after', async () => {
    const { engine, workers, worker } = harness()
    const pending = rejection(engine.transcribe(audio(1), 16000))
    await flush()
    engine.dispose()
    expect(worker().killed).toBe(true)
    expect((await pending).message).toBe(ENGINE_SHUT_DOWN)
    expect((await rejection(engine.transcribe(audio(1), 16000))).message).toBe(ENGINE_SHUT_DOWN)
    engine.prewarm()
    expect(workers).toHaveLength(1)
  })
})

describe('defaultThreadCount', () => {
  it('leaves a core free and never goes past four', () => {
    // Four were fastest on a 2 P-core + 8 E-core laptop; eight were 2–4× slower.
    expect(defaultThreadCount(1)).toBe(1)
    expect(defaultThreadCount(2)).toBe(1)
    expect(defaultThreadCount(4)).toBe(3)
    expect(defaultThreadCount(5)).toBe(4)
    expect(defaultThreadCount(14)).toBe(4)
    expect(defaultThreadCount(64)).toBe(4)
  })

  it('still gives one thread on a machine that reports none', () => {
    expect(defaultThreadCount(0)).toBe(1)
  })
})
