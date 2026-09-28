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

async function makeRecorderHarness() {
  const opens: Array<ReturnType<typeof deferred<MediaStream>>> = []
  const preparations: Array<Promise<Preparation>> = []
  const queuedTasks: Array<() => void> = []
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
    sendError: vi.fn()
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
  }

  vi.stubGlobal('window', {
    recorder: bridge,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)

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

    harness.onCancel({ requestId: 'newer-take' })
    expect(newer.track.stop).toHaveBeenCalledTimes(1)
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
