import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  RecorderAudioPayload,
  RecorderCancelRequest,
  RecorderStartRequest,
  RecorderStopRequest
} from '../src/shared/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

async function flushAsyncStart(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function makeStream() {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  return { stream, track }
}

/** What the mocked audio preparation resolves with. */
interface Preparation {
  buffer: ArrayBuffer
  mimeType: string
  speechDetected?: boolean
}

type FakeContextState = 'suspended' | 'running' | 'closed'

/** How the next level meter's audio context behaves, set by each test. */
interface AudioBehaviour {
  /** The state a new context starts in. */
  startState: FakeContextState
  /** Whether `resume()` gets a suspended context running. */
  resumes: boolean
  /** Thrown by the constructor, as when there is no audio device at all. */
  constructorError: Error | null
  /** Thrown when the microphone is connected to the context. */
  sourceError: Error | null
  /** What every analyser reading sees. */
  samples: number[]
}

async function makeRecorderHarness() {
  const opens: Array<ReturnType<typeof deferred<MediaStream>>> = []
  const preparations: Array<Promise<Preparation>> = []
  const queuedTasks: Array<() => void> = []
  // The level meter's timer is driven by hand, one reading per `tickLevels`.
  const intervals = new Map<number, { callback: () => void; delay: number }>()
  let nextInterval = 1
  const audio: AudioBehaviour = {
    startState: 'running',
    resumes: true,
    constructorError: null,
    sourceError: null,
    samples: [0]
  }
  const contexts: FakeAudioContext[] = []

  class FakeAnalyser {
    fftSize = 2048
    getFloatTimeDomainData(target: Float32Array): void {
      target.fill(0)
      audio.samples.forEach((sample, index) => {
        if (index < target.length) target[index] = sample
      })
    }
  }

  class FakeAudioContext {
    state: FakeContextState
    readonly sources: MediaStream[] = []
    readonly close = vi.fn(async () => {
      if (this.state === 'closed') throw new DOMException('Already closed', 'InvalidStateError')
      this.state = 'closed'
    })
    readonly resume = vi.fn(async () => {
      if (audio.resumes && this.state === 'suspended') this.state = 'running'
    })

    constructor() {
      if (audio.constructorError) throw audio.constructorError
      this.state = audio.startState
      contexts.push(this)
    }

    createAnalyser(): FakeAnalyser {
      return new FakeAnalyser()
    }

    createMediaStreamSource(stream: MediaStream) {
      if (audio.sourceError) throw audio.sourceError
      this.sources.push(stream)
      return { connect: vi.fn() }
    }
  }
  const getUserMedia = vi.fn(() => {
    const open = opens.shift()
    if (!open) throw new Error('No microphone open was queued for this test.')
    return open.promise
  })
  const prepareForTranscription = vi.fn(async (blob: Blob) => {
    const preparation = preparations.shift()
    if (preparation) return preparation
    return { buffer: await blob.arrayBuffer(), mimeType: 'audio/wav' }
  })
  vi.doMock('../src/renderer/audio-prep', () => ({ prepareForTranscription }))

  let onStart!: (request: RecorderStartRequest) => void
  let onStop!: (request: RecorderStopRequest) => void
  let onCancel!: (request: RecorderCancelRequest) => void
  const audioReplies: RecorderAudioPayload[] = []
  const bridge = {
    onStart: vi.fn((listener: typeof onStart) => {
      onStart = listener
    }),
    onStop: vi.fn((listener: typeof onStop) => {
      onStop = listener
    }),
    onCancel: vi.fn((listener: typeof onCancel) => {
      onCancel = listener
    }),
    sendStarted: vi.fn(),
    // Electron serialises ipcRenderer.send synchronously. Snapshot the bytes
    // before production deliberately zeros its local buffer after the call.
    sendAudio: vi.fn((payload: RecorderAudioPayload) => {
      audioReplies.push({ ...payload, audio: payload.audio.slice() })
    }),
    sendError: vi.fn(),
    sendLevel: vi.fn()
  }

  const recorders: FakeMediaRecorder[] = []
  class FakeMediaRecorder {
    static isTypeSupported(): boolean {
      return true
    }

    state: RecordingState = 'inactive'
    readonly mimeType: string
    private finalData = new Blob()
    private readonly listeners = new Map<
      string,
      Array<(event?: { data: Blob }) => void>
    >()

    constructor(
      readonly mediaStream: MediaStream,
      options?: MediaRecorderOptions
    ) {
      this.mimeType = options?.mimeType ?? ''
      recorders.push(this)
    }

    addEventListener(type: string, listener: (event?: { data: Blob }) => void): void {
      const listeners = this.listeners.get(type) ?? []
      listeners.push(listener)
      this.listeners.set(type, listeners)
    }

    start(): void {
      this.state = 'recording'
    }

    stop(): void {
      this.state = 'inactive'
      queuedTasks.push(() => {
        if (this.finalData.size > 0) {
          this.listeners
            .get('dataavailable')
            ?.forEach((listener) => listener({ data: this.finalData }))
        }
        this.listeners.get('stop')?.forEach((listener) => listener())
      })
    }

    setFinalData(data: Blob): void {
      this.finalData = data
    }

    /** The device failing mid-take, as a real recorder reports it. */
    fail(): void {
      this.listeners.get('error')?.forEach((listener) => listener())
    }
  }

  vi.stubGlobal('window', {
    recorder: bridge,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: (callback: () => void, delay: number): number => {
      const id = nextInterval
      nextInterval += 1
      intervals.set(id, { callback, delay })
      return id
    },
    clearInterval: (id: number): void => {
      intervals.delete(id)
    }
  })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('AudioContext', FakeAudioContext)

  await import('../src/renderer/recorder')

  return {
    bridge,
    audioReplies,
    getUserMedia,
    onStart,
    onStop,
    onCancel,
    prepareForTranscription,
    recorders,
    audio,
    contexts,
    /** Every level timer still running, by its period in milliseconds. */
    levelTimerPeriods: () => [...intervals.values()].map((interval) => interval.delay),
    /** One reading from every level timer still running. */
    tickLevels: () => {
      for (const interval of [...intervals.values()]) interval.callback()
    },
    /** True once every audio context any take opened has been closed. */
    allContextsClosed: () =>
      contexts.every((context) => context.state === 'closed' && context.close.mock.calls.length === 1),
    queueOpen: () => {
      const open = deferred<MediaStream>()
      opens.push(open)
      return open
    },
    queuePreparation: (preparation: Promise<Preparation>) => {
      preparations.push(preparation)
    },
    runNextTask: async () => {
      const task = queuedTasks.shift()
      if (!task) throw new Error('No recorder event task was queued.')
      task()
      await flushAsyncStart()
    },
    queuedTaskCount: () => queuedTasks.length
  }
}

describe('recorder take ownership', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('../src/renderer/audio-prep')
    vi.unstubAllGlobals()
  })

  it('stops the active take stream after a cancelled microphone open resolves late', async () => {
    const harness = await makeRecorderHarness()
    const firstOpen = harness.queueOpen()
    const secondOpen = harness.queueOpen()
    const cancelledOpen = harness.queueOpen()
    const preparingOpen = harness.queueOpen()
    const newestOpen = harness.queueOpen()
    const preparation = deferred<{ buffer: ArrayBuffer; mimeType: string }>()
    const first = makeStream()
    const second = makeStream()
    const preparing = makeStream()
    const newest = makeStream()

    harness.onStart({ requestId: 'take-a', microphoneId: '' })
    harness.onCancel({ requestId: 'take-a' })
    harness.onStart({ requestId: 'take-b', microphoneId: '' })

    secondOpen.resolve(second.stream)
    await flushAsyncStart()
    expect(harness.bridge.sendStarted).toHaveBeenCalledWith({ requestId: 'take-b' })

    firstOpen.resolve(first.stream)
    await flushAsyncStart()
    expect(first.track.stop).toHaveBeenCalledTimes(1)

    harness.onStop({ requestId: 'take-b' })
    await harness.runNextTask()

    expect(second.track.stop).toHaveBeenCalledTimes(1)

    // A cancelled open may reject after a newer take is already recording.
    harness.onStart({ requestId: 'take-c', microphoneId: '' })
    harness.onCancel({ requestId: 'take-c' })
    harness.onStart({ requestId: 'take-d', microphoneId: '' })
    preparingOpen.resolve(preparing.stream)
    await flushAsyncStart()
    cancelledOpen.reject(new DOMException('late device failure', 'NotReadableError'))
    await flushAsyncStart()
    expect(harness.bridge.sendStarted).toHaveBeenCalledWith({ requestId: 'take-d' })
    expect(harness.bridge.sendError).not.toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'take-c' })
    )
    // The late failure leaves the newer take's level meter reading, and only
    // under the newer take's own id.
    harness.audio.samples = [0.25]
    harness.tickLevels()
    expect(harness.bridge.sendLevel).toHaveBeenLastCalledWith({ requestId: 'take-d', level: 0.25 })

    // Audio preparation also belongs to its take. Cancelling it allows a new
    // recording, and its late result must not be emitted into that recording.
    harness.queuePreparation(preparation.promise)
    harness.recorders.at(-1)?.setFinalData(
      new Blob([new Uint8Array([1])], { type: 'audio/webm' })
    )
    harness.onStop({ requestId: 'take-d' })
    await harness.runNextTask()
    expect(harness.prepareForTranscription).toHaveBeenCalledTimes(1)
    harness.onCancel({ requestId: 'take-d' })
    harness.onStart({ requestId: 'take-e', microphoneId: '' })
    newestOpen.resolve(newest.stream)
    await flushAsyncStart()

    preparation.resolve({ buffer: new Uint8Array([9]).buffer, mimeType: 'audio/wav' })
    await flushAsyncStart()
    expect(harness.bridge.sendAudio).not.toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'take-d' })
    )
    expect(harness.bridge.sendStarted).toHaveBeenCalledWith({ requestId: 'take-e' })

    harness.onCancel({ requestId: 'take-e' })
    expect(newest.track.stop).toHaveBeenCalledTimes(1)

    // Takes b, d and e each had a meter, and each closed it once; the opens
    // that were cancelled before a stream arrived never made one.
    expect(harness.contexts).toHaveLength(3)
    expect(harness.allContextsClosed()).toBe(true)
    expect(harness.levelTimerPeriods()).toEqual([])
  })

  it('closes a stream that arrives after a cancel sent while the device was still opening', async () => {
    // Listening from the keypress opens the microphone at once and cancels it
    // when the press turns out to be another shortcut — typically some tens of
    // milliseconds later, well before a slow device has answered.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const harness = await makeRecorderHarness()
      const slowOpen = harness.queueOpen()
      const nextOpen = harness.queueOpen()
      const slow = makeStream()
      const next = makeStream()

      harness.onStart({ requestId: 'provisional-take', microphoneId: '' })
      vi.advanceTimersByTime(50)
      await flushAsyncStart()
      expect(harness.getUserMedia).toHaveBeenCalledTimes(1)
      harness.onCancel({ requestId: 'provisional-take' })

      // The next press can open a take straight away: the recorder is free.
      harness.onStart({ requestId: 'next-take', microphoneId: '' })
      await flushAsyncStart()
      expect(harness.getUserMedia).toHaveBeenCalledTimes(2)
      expect(harness.bridge.sendError).not.toHaveBeenCalled()

      // The cancelled device answers late: its stream is closed at once, and
      // nothing is ever recorded from it.
      slowOpen.resolve(slow.stream)
      await flushAsyncStart()
      expect(slow.track.stop).toHaveBeenCalledTimes(1)
      expect(harness.recorders).toHaveLength(0)
      expect(harness.bridge.sendStarted).not.toHaveBeenCalled()

      nextOpen.resolve(next.stream)
      await flushAsyncStart()
      expect(harness.bridge.sendStarted).toHaveBeenCalledTimes(1)
      expect(harness.bridge.sendStarted).toHaveBeenCalledWith({ requestId: 'next-take' })
      expect(harness.recorders).toHaveLength(1)
      expect(next.track.stop).not.toHaveBeenCalled()

      // Nor does the cancelled take's open timeout come back later as an error.
      vi.advanceTimersByTime(6000)
      await flushAsyncStart()
      expect(harness.bridge.sendError).not.toHaveBeenCalled()

      harness.onCancel({ requestId: 'next-take' })
      expect(next.track.stop).toHaveBeenCalledTimes(1)
      expect(slow.track.stop).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits final queued audio exactly once, releases the microphone and allows a new take', async () => {
    const harness = await makeRecorderHarness()
    const firstOpen = harness.queueOpen()
    const nextOpen = harness.queueOpen()
    const first = makeStream()
    const next = makeStream()
    const preparedAudio = new Uint8Array([9, 8, 7])
    harness.queuePreparation(
      Promise.resolve({ buffer: preparedAudio.buffer, mimeType: 'audio/wav', speechDetected: true })
    )
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_450)

    harness.onStart({ requestId: 'successful-take', microphoneId: 'mic-1' })
    firstOpen.resolve(first.stream)
    await flushAsyncStart()
    const recorder = harness.recorders.at(-1)
    recorder?.setFinalData(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }))

    harness.onStop({ requestId: 'successful-take' })
    expect(recorder?.state).toBe('inactive')
    expect(harness.queuedTaskCount()).toBe(1)
    expect(harness.bridge.sendAudio).not.toHaveBeenCalled()

    await harness.runNextTask()

    expect(harness.bridge.sendAudio).toHaveBeenCalledTimes(1)
    expect(harness.audioReplies).toEqual([{
      requestId: 'successful-take',
      audio: new Uint8Array([9, 8, 7]),
      mimeType: 'audio/wav',
      durationMs: 450,
      speechDetected: true
    }])
    expect(first.track.stop).toHaveBeenCalledTimes(1)
    expect(harness.bridge.sendError).not.toHaveBeenCalled()

    harness.onStart({ requestId: 'next-take', microphoneId: '' })
    nextOpen.resolve(next.stream)
    await flushAsyncStart()
    expect(harness.bridge.sendStarted).toHaveBeenLastCalledWith({ requestId: 'next-take' })

    harness.onCancel({ requestId: 'next-take' })
    expect(next.track.stop).toHaveBeenCalledTimes(1)

    expect(harness.contexts).toHaveLength(2)
    expect(harness.allContextsClosed()).toBe(true)
    expect(harness.levelTimerPeriods()).toEqual([])
  })

  it('suppresses queued completion after cancellation without disturbing a newer take', async () => {
    const harness = await makeRecorderHarness()
    const abandonedOpen = harness.queueOpen()
    const newerOpen = harness.queueOpen()
    const abandoned = makeStream()
    const newer = makeStream()

    harness.onStart({ requestId: 'abandoned-take', microphoneId: '' })
    abandonedOpen.resolve(abandoned.stream)
    await flushAsyncStart()
    const abandonedRecorder = harness.recorders.at(-1)
    abandonedRecorder?.setFinalData(
      new Blob([new Uint8Array([4, 5, 6])], { type: 'audio/webm' })
    )

    harness.onStop({ requestId: 'abandoned-take' })
    expect(abandonedRecorder?.state).toBe('inactive')
    harness.onCancel({ requestId: 'abandoned-take' })
    expect(abandoned.track.stop).toHaveBeenCalledTimes(1)

    harness.onStart({ requestId: 'newer-take', microphoneId: '' })
    newerOpen.resolve(newer.stream)
    await flushAsyncStart()
    const newerRecorder = harness.recorders.at(-1)

    await harness.runNextTask()

    expect(harness.bridge.sendAudio).not.toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'abandoned-take' })
    )
    expect(harness.bridge.sendError).not.toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'abandoned-take' })
    )
    expect(harness.bridge.sendStarted).toHaveBeenLastCalledWith({ requestId: 'newer-take' })
    expect(newerRecorder?.state).toBe('recording')
    expect(newer.track.stop).not.toHaveBeenCalled()
    // Nor its level meter: the abandoned take closed only its own context.
    expect(harness.contexts[0]?.state).toBe('closed')
    expect(harness.contexts[1]?.state).toBe('running')
    harness.audio.samples = [-0.3]
    harness.tickLevels()
    expect(harness.bridge.sendLevel).toHaveBeenLastCalledWith({ requestId: 'newer-take', level: 0.3 })

    harness.onCancel({ requestId: 'newer-take' })
    expect(newer.track.stop).toHaveBeenCalledTimes(1)
    expect(harness.allContextsClosed()).toBe(true)
    expect(harness.levelTimerPeriods()).toEqual([])
  })
})

type Harness = Awaited<ReturnType<typeof makeRecorderHarness>>
type RecordingTake = Awaited<ReturnType<typeof recordingTake>>

/** Opens a take and lets it reach recording, with its level meter running. */
async function recordingTake(harness: Harness, requestId = 'take') {
  const open = harness.queueOpen()
  const microphone = makeStream()
  harness.onStart({ requestId, microphoneId: '' })
  open.resolve(microphone.stream)
  await flushAsyncStart()
  return { microphone, recorder: harness.recorders.at(-1) }
}

describe('the live level meter', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('../src/renderer/audio-prep')
    vi.unstubAllGlobals()
  })

  it('reads its own take about 14 times a second while recording, and closes once the audio is sent', async () => {
    const harness = await makeRecorderHarness()
    const open = harness.queueOpen()
    const microphone = makeStream()

    harness.onStart({ requestId: 'take', microphoneId: '' })
    // Nothing to read while the microphone is still opening.
    expect(harness.contexts).toHaveLength(0)
    open.resolve(microphone.stream)
    await flushAsyncStart()

    expect(harness.contexts).toHaveLength(1)
    expect(harness.contexts[0]?.sources).toEqual([microphone.stream])
    expect(harness.levelTimerPeriods()).toEqual([70])

    harness.audio.samples = [0.1, -0.4213, 0.3]
    harness.tickLevels()
    harness.audio.samples = [0]
    harness.tickLevels()
    expect(harness.bridge.sendLevel.mock.calls).toEqual([
      [{ requestId: 'take', level: 0.42 }],
      [{ requestId: 'take', level: 0 }]
    ])

    harness.recorders.at(-1)?.setFinalData(new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' }))
    harness.onStop({ requestId: 'take' })
    await harness.runNextTask()

    expect(harness.bridge.sendAudio).toHaveBeenCalledTimes(1)
    expect(harness.allContextsClosed()).toBe(true)
    expect(harness.levelTimerPeriods()).toEqual([])
    harness.tickLevels()
    expect(harness.bridge.sendLevel).toHaveBeenCalledTimes(2)
  })

  it('reads the loudest sample either side of zero, to two decimals, and never above 1', async () => {
    const harness = await makeRecorderHarness()
    await recordingTake(harness)
    const readings: Array<[number[], number]> = [
      [[0.004, -0.006], 0.01],
      [[0.125], 0.13],
      [[0.004, -0.0049], 0],
      [[0], 0],
      [[1.7, -2], 1],
      [[Number.POSITIVE_INFINITY], 1],
      [[Number.NaN, 0.2], 0.2]
    ]

    for (const [samples, level] of readings) {
      harness.audio.samples = samples
      harness.tickLevels()
      expect(harness.bridge.sendLevel).toHaveBeenLastCalledWith({ requestId: 'take', level })
    }

    harness.onCancel({ requestId: 'take' })
  })

  // Every way a recording take can end, each of which must let the meter go.
  const endings: Array<[string, (harness: Harness, take: RecordingTake) => Promise<void>]> = [
    ['it is cancelled while recording', async (harness) => {
      harness.onCancel({ requestId: 'take' })
    }],
    ['the microphone fails mid-take', async (harness, take) => {
      take.recorder?.fail()
      expect(harness.bridge.sendError).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'take' })
      )
    }],
    ['it stops with no audio captured', async (harness) => {
      harness.onStop({ requestId: 'take' })
      await harness.runNextTask()
      expect(harness.bridge.sendError).toHaveBeenCalledWith({
        requestId: 'take',
        message: 'No microphone audio was captured.'
      })
    }],
    ['its recorder had already stopped when asked to stop', async (harness, take) => {
      if (take.recorder) take.recorder.state = 'inactive'
      harness.onStop({ requestId: 'take' })
      expect(harness.bridge.sendError).toHaveBeenCalledWith({
        requestId: 'take',
        message: 'The recording had already stopped.'
      })
    }],
    ['it is cancelled between the stop and the final audio', async (harness, take) => {
      take.recorder?.setFinalData(new Blob([new Uint8Array([1])], { type: 'audio/webm' }))
      harness.onStop({ requestId: 'take' })
      harness.onCancel({ requestId: 'take' })
      await harness.runNextTask()
    }],
    ['it is cancelled while its audio is prepared', async (harness, take) => {
      const preparation = deferred<{ buffer: ArrayBuffer; mimeType: string }>()
      harness.queuePreparation(preparation.promise)
      take.recorder?.setFinalData(new Blob([new Uint8Array([1])], { type: 'audio/webm' }))
      harness.onStop({ requestId: 'take' })
      await harness.runNextTask()
      harness.onCancel({ requestId: 'take' })
      preparation.resolve({ buffer: new Uint8Array([9]).buffer, mimeType: 'audio/wav' })
      await flushAsyncStart()
      expect(harness.bridge.sendAudio).not.toHaveBeenCalled()
    }],
    ['its audio cannot be read', async (harness, take) => {
      const preparation = deferred<{ buffer: ArrayBuffer; mimeType: string }>()
      harness.queuePreparation(preparation.promise)
      take.recorder?.setFinalData(new Blob([new Uint8Array([1])], { type: 'audio/webm' }))
      harness.onStop({ requestId: 'take' })
      await harness.runNextTask()
      preparation.reject(new Error('undecodable'))
      await flushAsyncStart()
      expect(harness.bridge.sendError).toHaveBeenCalledWith({
        requestId: 'take',
        message: 'The captured microphone audio could not be read.'
      })
    }]
  ]

  it.each(endings)('closes its context once when %s', async (_ending, end) => {
    const harness = await makeRecorderHarness()
    const take = await recordingTake(harness)
    expect(harness.contexts).toHaveLength(1)
    expect(harness.contexts[0]?.state).toBe('running')

    await end(harness, take)

    expect(harness.allContextsClosed()).toBe(true)
    expect(harness.levelTimerPeriods()).toEqual([])
    expect(take.microphone.track.stop).toHaveBeenCalled()
    harness.tickLevels()
    expect(harness.bridge.sendLevel).not.toHaveBeenCalled()
  })

  it('never makes a context for a take whose microphone never opened for it', async () => {
    const harness = await makeRecorderHarness()
    const lateOpen = harness.queueOpen()
    const refusedOpen = harness.queueOpen()
    const late = makeStream()

    // Cancelled while opening; the stream turns up afterwards.
    harness.onStart({ requestId: 'late-take', microphoneId: '' })
    harness.onCancel({ requestId: 'late-take' })
    lateOpen.resolve(late.stream)
    await flushAsyncStart()
    expect(late.track.stop).toHaveBeenCalledTimes(1)

    // Refused outright.
    harness.onStart({ requestId: 'refused-take', microphoneId: '' })
    refusedOpen.reject(new DOMException('Permission denied', 'NotAllowedError'))
    await flushAsyncStart()
    expect(harness.bridge.sendError).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'refused-take' })
    )

    expect(harness.contexts).toEqual([])
    expect(harness.levelTimerPeriods()).toEqual([])
    expect(harness.bridge.sendLevel).not.toHaveBeenCalled()
  })

  it('sends nothing from a context the window will not start, and still closes it', async () => {
    const harness = await makeRecorderHarness()
    harness.audio.startState = 'suspended'
    harness.audio.resumes = false
    harness.audio.samples = [0.5]
    await recordingTake(harness)

    const [context] = harness.contexts
    expect(context?.resume).toHaveBeenCalledTimes(1)
    harness.tickLevels()
    harness.tickLevels()
    expect(harness.bridge.sendLevel).not.toHaveBeenCalled()
    // The recording itself is untouched.
    expect(harness.bridge.sendStarted).toHaveBeenCalledWith({ requestId: 'take' })
    expect(harness.bridge.sendError).not.toHaveBeenCalled()

    harness.onCancel({ requestId: 'take' })
    expect(harness.allContextsClosed()).toBe(true)
  })

  it('starts reading once a suspended context is allowed to run', async () => {
    const harness = await makeRecorderHarness()
    harness.audio.startState = 'suspended'
    harness.audio.samples = [0.5]
    await recordingTake(harness)

    expect(harness.contexts[0]?.state).toBe('running')
    harness.tickLevels()
    expect(harness.bridge.sendLevel).toHaveBeenCalledWith({ requestId: 'take', level: 0.5 })

    harness.onCancel({ requestId: 'take' })
    expect(harness.allContextsClosed()).toBe(true)
  })

  const faults: Array<[string, 'constructorError' | 'sourceError']> = [
    ['no context can be made at all', 'constructorError'],
    ['the microphone cannot be connected to it', 'sourceError']
  ]

  it.each(faults)('records as normal when %s', async (_case, fault) => {
    const harness = await makeRecorderHarness()
    harness.audio[fault] = new DOMException('No audio device', 'NotSupportedError')
    const take = await recordingTake(harness)

    expect(harness.bridge.sendStarted).toHaveBeenCalledWith({ requestId: 'take' })
    // A context made before the fault is closed straight away.
    expect(harness.allContextsClosed()).toBe(true)
    expect(harness.levelTimerPeriods()).toEqual([])

    take.recorder?.setFinalData(new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' }))
    harness.onStop({ requestId: 'take' })
    await harness.runNextTask()
    expect(harness.bridge.sendAudio).toHaveBeenCalledTimes(1)
    expect(harness.bridge.sendError).not.toHaveBeenCalled()
    expect(harness.bridge.sendLevel).not.toHaveBeenCalled()
  })

  it('tells main when the prepared take held no speech, and still settles it', async () => {
    const harness = await makeRecorderHarness()
    const open = harness.queueOpen()
    const microphone = makeStream()
    harness.queuePreparation(
      Promise.resolve({
        buffer: new Uint8Array([0, 0]).buffer,
        mimeType: 'audio/wav',
        speechDetected: false
      })
    )

    harness.onStart({ requestId: 'silent-take', microphoneId: '' })
    open.resolve(microphone.stream)
    await flushAsyncStart()
    harness.recorders.at(-1)?.setFinalData(
      new Blob([new Uint8Array([1])], { type: 'audio/webm' })
    )
    harness.onStop({ requestId: 'silent-take' })
    await harness.runNextTask()

    // Main decides what silence means; the recorder reports it once, as audio,
    // never as an error.
    expect(harness.bridge.sendAudio).toHaveBeenCalledTimes(1)
    expect(harness.audioReplies[0]).toEqual(
      expect.objectContaining({ requestId: 'silent-take', speechDetected: false })
    )
    expect(harness.bridge.sendError).not.toHaveBeenCalled()
    expect(microphone.track.stop).toHaveBeenCalledTimes(1)
  })
})
