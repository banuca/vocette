import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DictationController,
  type DictationDeps,
  type ForegroundState,
  type SoundKind,
  type WorkflowSettings
} from '../src/main/dictation-controller'
import type { Page, WorkflowStatus } from '../src/shared/types'

function makeHarness(overrides: { settings?: Partial<WorkflowSettings> } = {}) {
  const settings: WorkflowSettings = {
    recordingMode: 'hold',
    autoPaste: true,
    pasteAvailable: true,
    removeFillers: true,
    playSounds: false,
    model: 'gpt-transcribe',
    language: 'en',
    microphoneId: 'mic-1',
    apiKeyConfigured: true,
    ...overrides.settings
  }

  const sendToRecorder = vi.fn<DictationDeps['sendToRecorder']>()
  const transcribe = vi.fn<DictationDeps['transcribe']>(async () => 'Hello world.')
  const writeClipboard = vi.fn<(text: string) => void>()
  const paste = vi.fn<() => void>()
  const playSound = vi.fn<(kind: SoundKind) => void>()
  const broadcastStatus = vi.fn<(status: WorkflowStatus) => void>()
  const showMain = vi.fn<(page: Page) => void>()
  const recordHistory = vi.fn<(text: string, durationMs: number, model: string) => void>()
  const captureForeground = vi.fn<() => void>()
  const clearForeground = vi.fn<() => void>()
  const getForegroundState = vi.fn<() => ForegroundState | null>(() => null)
  const onRetryChanged = vi.fn<(available: boolean) => void>()

  // No `DictationDeps` annotation on purpose: it would erase the Mock types
  // the tests rely on. The constructor call below proves compatibility.
  const deps = {
    sendToRecorder,
    getSettings: () => settings,
    transcribe,
    writeClipboard,
    paste,
    playSound,
    broadcastStatus,
    showMain,
    recordHistory,
    captureForeground,
    clearForeground,
    getForegroundState,
    shortcutLabel: () => 'Left Ctrl + Left Shift',
    onRetryChanged
  }

  const controller = new DictationController(deps)

  /** The request id the controller most recently sent to the recorder. */
  const lastRequestId = (): string => {
    const calls = deps.sendToRecorder.mock.calls.filter(([channel]) => channel === 'recorder:start')
    const last = calls.at(-1)
    return (last?.[1] as { requestId: string }).requestId
  }

  /** Drives press → started, returning the request id. */
  const beginRecording = (): string => {
    controller.onShortcutPressed()
    const requestId = lastRequestId()
    controller.onRecorderStarted({ requestId })
    return requestId
  }

  return { controller, deps, settings, lastRequestId, beginRecording }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('hold → recording → release', () => {
  it('walks the happy path and hands the transcript over', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    const requestId = beginRecording()

    expect(deps.sendToRecorder).toHaveBeenCalledWith('recorder:start', {
      requestId,
      microphoneId: 'mic-1'
    })
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'recording', message: 'Listening…' })
    )

    controller.onShortcutReleased()
    expect(deps.sendToRecorder).toHaveBeenCalledWith('recorder:stop', { requestId })

    const audio = new Uint8Array([1, 2, 3, 4])
    const promise = controller.onRecorderAudio({
      requestId,
      audio,
      mimeType: 'audio/wav',
      durationMs: 2100
    })
    await vi.advanceTimersByTimeAsync(80)
    await promise

    expect(deps.transcribe).toHaveBeenCalledWith(
      {
        audio: expect.any(Uint8Array),
        mimeType: 'audio/wav',
        durationMs: 2100,
        model: 'gpt-transcribe',
        language: 'en'
      },
      expect.any(AbortSignal)
    )
    expect(deps.writeClipboard).toHaveBeenCalledWith('Hello world.')
    expect(deps.recordHistory).toHaveBeenCalledWith('Hello world.', 2100, 'gpt-transcribe')
    expect(deps.paste).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'success' })
    )
    // The audio copy must be zeroed after a successful take.
    expect([...audio]).toEqual([0, 0, 0, 0])
  })

  it('falls back to clipboard-only when foreground tracking is unavailable', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.getForegroundState.mockReturnValue(null)
    const requestId = beginRecording()
    controller.onShortcutReleased()

    const promise = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array(8),
      mimeType: 'audio/wav',
      durationMs: 500
    })
    await vi.advanceTimersByTimeAsync(80)
    await promise

    expect(deps.writeClipboard).toHaveBeenCalledWith('Hello world.')
    expect(deps.paste).not.toHaveBeenCalled()
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'success', message: expect.stringContaining('Copied') })
    )
  })

  it('stops immediately when the chord was released during the starting phase', () => {
    const { controller, deps } = makeHarness()
    controller.onShortcutPressed()
    controller.onShortcutReleased()
    const requestId = deps.sendToRecorder.mock.calls.at(-1)?.[1] as { requestId: string }
    expect(deps.sendToRecorder).not.toHaveBeenCalledWith('recorder:stop', expect.anything())

    controller.onRecorderStarted({ requestId: requestId.requestId })
    expect(deps.sendToRecorder).toHaveBeenCalledWith('recorder:stop', {
      requestId: requestId.requestId
    })
  })

  it('ignores auto-repeat presses while active', () => {
    const { controller, deps, beginRecording } = makeHarness()
    beginRecording()
    controller.onShortcutPressed()
    controller.onShortcutPressed()
    expect(deps.sendToRecorder).toHaveBeenCalledTimes(1)
  })
})

describe('paste honesty', () => {
  it('refuses to paste into an elevated window and says so', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: true })
    const requestId = beginRecording()
    controller.onShortcutReleased()

    const promise = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array(8),
      mimeType: 'audio/wav',
      durationMs: 500
    })
    await vi.advanceTimersByTimeAsync(80)
    await promise

    expect(deps.paste).not.toHaveBeenCalled()
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.stringContaining('elevated') })
    )
  })

  it('refuses to paste when focus moved during transcription', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.getForegroundState.mockReturnValue({ sameWindow: false, elevated: false })
    const requestId = beginRecording()
    controller.onShortcutReleased()

    const promise = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array(8),
      mimeType: 'audio/wav',
      durationMs: 500
    })
    await vi.advanceTimersByTimeAsync(80)
    await promise

    expect(deps.paste).not.toHaveBeenCalled()
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.stringContaining('focus moved') })
    )
  })

  it('pastes into the same window when nothing changed', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    const requestId = beginRecording()
    controller.onShortcutReleased()

    const promise = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array(8),
      mimeType: 'audio/wav',
      durationMs: 500
    })
    await vi.advanceTimersByTimeAsync(80)
    await promise

    expect(deps.paste).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'Copied and pasted' })
    )
  })

  it('rechecks the target after the clipboard settle delay before pasting', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    const requestId = beginRecording()
    controller.onShortcutReleased()

    const promise = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array(8),
      mimeType: 'audio/wav',
      durationMs: 500
    })
    await Promise.resolve()
    expect(deps.getForegroundState).toHaveBeenCalledTimes(1)

    deps.getForegroundState.mockReturnValue({ sameWindow: false, elevated: false })
    await vi.advanceTimersByTimeAsync(80)
    await promise

    expect(deps.getForegroundState).toHaveBeenCalledTimes(2)
    expect(deps.paste).not.toHaveBeenCalled()
  })
})

describe('language-aware cleanup', () => {
  it('applies light cleanup to explicitly English dictation', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.transcribe.mockResolvedValue('  um hello,world!  ')
    const requestId = beginRecording()

    await controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 100
    })

    expect(deps.recordHistory).toHaveBeenCalledWith('Hello, world!', 100, 'gpt-transcribe')
  })

  it('preserves non-English text that contains a legitimate um apart from outer whitespace', async () => {
    const { controller, deps, beginRecording } = makeHarness({ settings: { language: 'de' } })
    deps.transcribe.mockResolvedValue('  um ist ein Wort  ')
    const requestId = beginRecording()

    await controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 100
    })

    expect(deps.recordHistory).toHaveBeenCalledWith('um ist ein Wort', 100, 'gpt-transcribe')
  })

  it('preserves automatic-language Retry text apart from outer whitespace', async () => {
    const { controller, deps, beginRecording } = makeHarness({ settings: { language: 'auto' } })
    deps.transcribe
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce('  um automatic transcript  ')
    const requestId = beginRecording()

    await controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 100
    })
    await controller.retryLast()

    expect(deps.recordHistory).toHaveBeenLastCalledWith(
      'um automatic transcript',
      100,
      'gpt-transcribe'
    )
  })

  it('preserves English text apart from outer whitespace when cleanup is disabled', async () => {
    const { controller, deps, beginRecording } = makeHarness({
      settings: { removeFillers: false }
    })
    deps.transcribe.mockResolvedValue('  um hello,world!  ')
    const requestId = beginRecording()

    await controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 100
    })

    expect(deps.recordHistory).toHaveBeenCalledWith('um hello,world!', 100, 'gpt-transcribe')
  })
})

describe('cancellation ownership', () => {
  it('does not commit a transcription that resolves after the take was cancelled', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    let resolveTranscription!: (text: string) => void
    let signal!: AbortSignal
    deps.transcribe.mockImplementation(
      (_payload, attemptSignal) =>
        new Promise<string>((resolve) => {
          signal = attemptSignal
          resolveTranscription = resolve
        })
    )

    const requestId = beginRecording()
    controller.onShortcutReleased()
    const processing = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
      durationMs: 500
    })
    await Promise.resolve()
    expect(controller.getStatus().phase).toBe('processing')
    expect(signal.aborted).toBe(false)

    controller.resetKeyState()
    expect(signal.aborted).toBe(true)
    const newerRequestId = beginRecording()
    expect(controller.getStatus().phase).toBe('recording')

    resolveTranscription('Cancelled words must not escape.')
    await vi.advanceTimersByTimeAsync(80)
    await processing

    expect(deps.recordHistory).not.toHaveBeenCalled()
    expect(deps.writeClipboard).not.toHaveBeenCalled()
    expect(deps.paste).not.toHaveBeenCalled()
    expect(controller.getStatus().phase).toBe('recording')
    expect(deps.sendToRecorder).toHaveBeenLastCalledWith('recorder:start', {
      requestId: newerRequestId,
      microphoneId: 'mic-1'
    })
  })

  it('ignores a cancelled rejection after a newer take starts', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    let rejectTranscription!: (error: Error) => void
    deps.transcribe.mockImplementation(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectTranscription = reject
        })
    )

    const requestId = beginRecording()
    controller.onShortcutReleased()
    const processing = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([4, 5, 6]),
      mimeType: 'audio/wav',
      durationMs: 500
    })
    await Promise.resolve()

    controller.resetKeyState()
    beginRecording()
    rejectTranscription(new Error('late network failure'))
    await processing

    expect(controller.getStatus().phase).toBe('recording')
    expect(controller.canRetry()).toBe(false)
    expect(deps.broadcastStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'error', detail: 'late network failure' })
    )
  })

  it('cancels Retry without turning the cancellation into a failure', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.transcribe.mockRejectedValueOnce(new Error('temporary failure'))
    const requestId = beginRecording()
    controller.onShortcutReleased()
    const audio = new Uint8Array([7, 8, 9])
    await controller.onRecorderAudio({
      requestId,
      audio,
      mimeType: 'audio/wav',
      durationMs: 500
    })
    expect(controller.canRetry()).toBe(true)

    let resolveRetry!: (text: string) => void
    let retrySignal!: AbortSignal
    deps.transcribe.mockImplementation(
      (_payload, signal) =>
        new Promise<string>((resolve) => {
          retrySignal = signal
          resolveRetry = resolve
        })
    )
    deps.recordHistory.mockClear()
    deps.writeClipboard.mockClear()
    deps.paste.mockClear()

    const retry = controller.retryLast()
    await Promise.resolve()
    controller.resetKeyState()
    expect(retrySignal.aborted).toBe(true)

    resolveRetry('late retry result')
    await retry

    expect(deps.recordHistory).not.toHaveBeenCalled()
    expect(deps.writeClipboard).not.toHaveBeenCalled()
    expect(deps.paste).not.toHaveBeenCalled()
    expect(controller.getStatus().phase).toBe('idle')
    expect(controller.canRetry()).toBe(true)
    expect([...audio]).toEqual([7, 8, 9])
  })

  it('suppresses a late rejection after shutdown and releases owned audio', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    let rejectTranscription!: (error: Error) => void
    let signal!: AbortSignal
    deps.transcribe.mockImplementation(
      (_payload, attemptSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal = attemptSignal
          rejectTranscription = reject
        })
    )

    const requestId = beginRecording()
    controller.onShortcutReleased()
    const audio = new Uint8Array([3, 2, 1])
    const processing = controller.onRecorderAudio({
      requestId,
      audio,
      mimeType: 'audio/wav',
      durationMs: 500
    })
    await Promise.resolve()

    controller.shutdown()
    const broadcastsAfterShutdown = deps.broadcastStatus.mock.calls.length
    expect(signal.aborted).toBe(true)
    expect([...audio]).toEqual([0, 0, 0])

    rejectTranscription(new Error('late shutdown rejection'))
    await processing

    expect(deps.broadcastStatus).toHaveBeenCalledTimes(broadcastsAfterShutdown)
    expect(controller.canRetry()).toBe(false)
  })

  it('does not paste or announce success when cancelled during the paste delay', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    const requestId = beginRecording()
    controller.onShortcutReleased()

    const processing = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 500
    })
    await Promise.resolve()
    expect(deps.recordHistory).toHaveBeenCalledTimes(1)
    expect(deps.writeClipboard).toHaveBeenCalledTimes(1)
    expect(deps.getForegroundState).toHaveBeenCalledTimes(1)

    controller.resetKeyState()
    await vi.advanceTimersByTimeAsync(80)
    await processing

    expect(deps.paste).not.toHaveBeenCalled()
    expect(deps.playSound).not.toHaveBeenCalledWith('success')
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith({ phase: 'idle', message: 'Ready' })
  })
})

describe('abandonment (regressions)', () => {
  it('cancels the recorder when the start watchdog fires', () => {
    const { controller, deps, beginRecording } = makeHarness()
    beginRecording()
    expect(controller.getStatus().phase).toBe('recording')
    expect(deps.sendToRecorder).not.toHaveBeenCalledWith('recorder:cancel', expect.anything())

    vi.advanceTimersByTime(5 * 60 * 1000)
    // Even after the maximum-duration force stop, nothing may be abandoned
    // without a reply from the recorder.
    expect(controller.getStatus().phase).toBe('recording')

    controller.resetKeyState()
    expect(deps.sendToRecorder).toHaveBeenCalledWith(
      'recorder:cancel',
      expect.objectContaining({ requestId: expect.any(String) })
    )
    expect(controller.getStatus().phase).toBe('idle')
  })

  it('tray reset during recording cancels the take and frees the mic', () => {
    const { controller, deps, beginRecording } = makeHarness()
    const requestId = beginRecording()

    controller.resetKeyState()
    expect(deps.sendToRecorder).toHaveBeenCalledWith('recorder:cancel', { requestId })
    expect(controller.getStatus().phase).toBe('idle')

    // The old build left the recorder running here: the next press would fail
    // with "The microphone is already recording." A fresh press must start.
    deps.sendToRecorder.mockClear()
    controller.onShortcutPressed()
    expect(deps.sendToRecorder).toHaveBeenCalledWith(
      'recorder:start',
      expect.objectContaining({ requestId: expect.any(String) })
    )
  })

  it('cancels the recorder when the microphone never starts', () => {
    const { controller, deps } = makeHarness()
    controller.onShortcutPressed()
    const requestId = deps.sendToRecorder.mock.calls.at(-1)?.[1] as { requestId: string }

    vi.advanceTimersByTime(8000)
    expect(deps.sendToRecorder).toHaveBeenCalledWith('recorder:cancel', {
      requestId: requestId.requestId
    })
    expect(controller.getStatus().phase).toBe('error')
  })

  it('abandons a take whose stop never produces audio', () => {
    const { controller, deps, beginRecording } = makeHarness()
    beginRecording()
    controller.onShortcutReleased()
    expect(deps.sendToRecorder).toHaveBeenCalledWith('recorder:stop', expect.anything())

    vi.advanceTimersByTime(10_000)
    expect(controller.getStatus().phase).toBe('error')
  })

  it('ends the take at the maximum duration and still watches the stop reply', () => {
    const { controller, deps, beginRecording } = makeHarness()
    beginRecording()
    // No release: the five-minute cap is what ends the take.
    expect(
      deps.sendToRecorder.mock.calls.filter(([channel]) => channel === 'recorder:stop')
    ).toHaveLength(0)

    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(
      deps.sendToRecorder.mock.calls.filter(([channel]) => channel === 'recorder:stop')
    ).toHaveLength(1)

    // And the stop watchdog still guards the reply.
    vi.advanceTimersByTime(10_000)
    expect(controller.getStatus().phase).toBe('error')
  })

  it('ignores stale recorder events after a reset', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    const requestId = beginRecording()
    controller.resetKeyState()
    deps.transcribe.mockClear()

    await controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array(4),
      mimeType: 'audio/wav',
      durationMs: 10
    })
    expect(deps.transcribe).not.toHaveBeenCalled()
  })
})

describe('errors and retry', () => {
  it('keeps the failed take and retries it without the microphone', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.transcribe
      .mockRejectedValueOnce(new Error('The transcription service is temporarily unavailable.'))
      .mockResolvedValueOnce('On the second try.')

    const requestId = beginRecording()
    controller.onShortcutReleased()
    const audio = new Uint8Array([9, 9, 9])
    await controller.onRecorderAudio({
      requestId,
      audio,
      mimeType: 'audio/wav',
      durationMs: 1200
    })

    expect(controller.getStatus().phase).toBe('error')
    expect(controller.canRetry()).toBe(true)
    expect(deps.onRetryChanged).toHaveBeenLastCalledWith(true)
    // The failed audio is kept (not zeroed) for the retry.
    expect([...audio]).toEqual([9, 9, 9])

    const retryPromise = controller.retryLast()
    await vi.advanceTimersByTimeAsync(80)
    await retryPromise

    expect(deps.transcribe).toHaveBeenCalledTimes(2)
    expect(deps.writeClipboard).toHaveBeenCalledWith('On the second try.')
    expect(deps.paste).not.toHaveBeenCalled()
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.stringContaining('paste manually') })
    )
    expect(controller.canRetry()).toBe(false)
    expect(deps.onRetryChanged).toHaveBeenLastCalledWith(false)
    expect([...audio]).toEqual([0, 0, 0])
  })

  it('can retry again after a second failure', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.transcribe.mockReset().mockRejectedValue(new Error('Still down.'))
    const requestId = beginRecording()
    controller.onShortcutReleased()
    const audio = new Uint8Array([5])
    await controller.onRecorderAudio({
      requestId,
      audio,
      mimeType: 'audio/wav',
      durationMs: 100
    })
    expect(controller.canRetry()).toBe(true)

    await controller.retryLast()
    expect(controller.canRetry()).toBe(true)
    expect([...audio]).toEqual([5])
  })

  it('drops the retry take when a new dictation starts', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.transcribe.mockReset().mockRejectedValue(new Error('boom'))
    const requestId = beginRecording()
    controller.onShortcutReleased()
    const audio = new Uint8Array([7])
    await controller.onRecorderAudio({
      requestId,
      audio,
      mimeType: 'audio/wav',
      durationMs: 100
    })
    expect(controller.canRetry()).toBe(true)

    vi.advanceTimersByTime(4500) // error status resets to idle
    beginRecording()
    expect(controller.canRetry()).toBe(false)
    expect([...audio]).toEqual([0])
  })

  it('sends the user to Settings when no API key is configured', () => {
    const { controller, deps } = makeHarness({ settings: { apiKeyConfigured: false } })
    controller.onShortcutPressed()
    expect(deps.sendToRecorder).not.toHaveBeenCalled()
    expect(deps.showMain).toHaveBeenCalledWith('settings')
    expect(controller.getStatus().phase).toBe('error')
  })
})

describe('status lifecycle', () => {
  it('returns to idle after the success message lingers', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    const requestId = beginRecording()
    controller.onShortcutReleased()
    const promise = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array(4),
      mimeType: 'audio/wav',
      durationMs: 100
    })
    await vi.advanceTimersByTimeAsync(80)
    await promise
    expect(controller.getStatus().phase).toBe('success')

    vi.advanceTimersByTime(1600)
    expect(controller.getStatus().phase).toBe('idle')
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith({ phase: 'idle', message: 'Ready' })
  })

  it('accepts a new press while a success message is still showing', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    const first = beginRecording()
    controller.onShortcutReleased()
    const promise = controller.onRecorderAudio({
      requestId: first,
      audio: new Uint8Array(4),
      mimeType: 'audio/wav',
      durationMs: 100
    })
    await vi.advanceTimersByTimeAsync(80)
    await promise
    expect(controller.getStatus().phase).toBe('success')

    controller.onShortcutPressed()
    const starts = deps.sendToRecorder.mock.calls.filter(([channel]) => channel === 'recorder:start')
    expect(starts).toHaveLength(2)
  })

  it('reports hook errors as dictation errors', () => {
    const { controller, deps } = makeHarness()
    controller.reportError('The keyboard hook reported an error.')
    expect(controller.getStatus().phase).toBe('error')
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'error',
        detail: 'The keyboard hook reported an error.'
      })
    )
  })

  it('plays the start cue once recording begins', () => {
    const { deps, beginRecording } = makeHarness({ settings: { playSounds: true } })
    beginRecording()
    expect(deps.playSound).toHaveBeenCalledWith('start')
  })
})

describe('recording modes and window controls', () => {
  /** Runs a take to completion from whichever entry point started it. */
  const finish = async (
    harness: ReturnType<typeof makeHarness>,
    requestId: string
  ): Promise<void> => {
    const promise = harness.controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1, 2, 3, 4]),
      mimeType: 'audio/wav',
      durationMs: 1200
    })
    await vi.advanceTimersByTimeAsync(80)
    await promise
  }

  it('toggles with one press each way when the platform cannot report a release', () => {
    const harness = makeHarness({ settings: { recordingMode: 'toggle' } })
    const { controller, deps } = harness
    controller.onShortcutPressed()
    controller.onRecorderStarted({ requestId: harness.lastRequestId() })
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'recording' })
    )

    // A release means nothing in toggle mode and must not end the take.
    controller.onShortcutReleased()
    expect(deps.sendToRecorder).not.toHaveBeenCalledWith('recorder:stop', expect.anything())

    controller.onShortcutPressed()
    expect(deps.sendToRecorder).toHaveBeenCalledWith('recorder:stop', {
      requestId: harness.lastRequestId()
    })
  })

  it('tells the user how to finish, in the words that match the mode', () => {
    const hold = makeHarness()
    hold.controller.startDictation('shortcut')
    expect(hold.deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: 'Keep holding the shortcut' })
    )

    const toggle = makeHarness({ settings: { recordingMode: 'toggle' } })
    toggle.controller.startDictation('shortcut')
    expect(toggle.deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: 'Press Left Ctrl + Left Shift again to finish' })
    )

    const fromWindow = makeHarness()
    fromWindow.controller.startDictation('ui')
    expect(fromWindow.deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: 'Press Stop when you have finished' })
    )
  })

  it('captures no target for a take started from the app window', async () => {
    const harness = makeHarness()
    const { controller, deps } = harness
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })

    controller.startDictation('ui')
    expect(deps.captureForeground).not.toHaveBeenCalled()
    expect(deps.clearForeground).toHaveBeenCalledTimes(1)

    const requestId = harness.lastRequestId()
    controller.onRecorderStarted({ requestId })
    controller.stopDictation()
    await finish(harness, requestId)

    // Delivered, but never typed into whatever happened to be behind us.
    expect(deps.writeClipboard).toHaveBeenCalledWith('Hello world.')
    expect(deps.paste).not.toHaveBeenCalled()
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'success', message: 'Copied to clipboard' })
    )
  })

  it('still captures the target for a take started by the shortcut', () => {
    const { controller, deps } = makeHarness()
    controller.startDictation('shortcut')
    expect(deps.captureForeground).toHaveBeenCalledTimes(1)
    expect(deps.clearForeground).not.toHaveBeenCalled()
  })

  it('keeps a retried window take on the clipboard', async () => {
    const harness = makeHarness()
    const { controller, deps } = harness
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    deps.transcribe.mockRejectedValueOnce(new Error('Provider unavailable.'))

    controller.startDictation('ui')
    const requestId = harness.lastRequestId()
    controller.onRecorderStarted({ requestId })
    controller.stopDictation()
    await finish(harness, requestId)
    expect(controller.canRetry()).toBe(true)

    deps.clearForeground.mockClear()
    await controller.retryLast()
    await vi.advanceTimersByTimeAsync(80)
    expect(deps.clearForeground).toHaveBeenCalledTimes(1)
    expect(deps.paste).not.toHaveBeenCalled()
  })

  it('copies without pasting where the platform cannot paste safely', async () => {
    const harness = makeHarness({ settings: { pasteAvailable: false } })
    const { controller, deps } = harness
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    const requestId = harness.beginRecording()
    controller.onShortcutReleased()
    await finish(harness, requestId)
    expect(deps.paste).not.toHaveBeenCalled()
    expect(deps.writeClipboard).toHaveBeenCalledWith('Hello world.')
  })

  it('cancels a take outright: no transcription, no history, no retry', async () => {
    const harness = makeHarness()
    const { controller, deps } = harness
    const requestId = harness.beginRecording()

    controller.cancelDictation()
    expect(deps.sendToRecorder).toHaveBeenCalledWith('recorder:cancel', { requestId })
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'cancelled', message: 'Dictation cancelled' })
    )
    expect(controller.canRetry()).toBe(false)

    // Audio arriving after the cancellation belongs to a take nobody wants.
    await controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1, 2]),
      mimeType: 'audio/wav',
      durationMs: 900
    })
    expect(deps.transcribe).not.toHaveBeenCalled()
    expect(deps.recordHistory).not.toHaveBeenCalled()
  })

  it('cancels during transcription and zeroes the audio', async () => {
    const harness = makeHarness()
    const { controller, deps } = harness
    let settle!: (text: string) => void
    deps.transcribe.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          settle = resolve
        })
    )
    const requestId = harness.beginRecording()
    controller.onShortcutReleased()
    const audio = new Uint8Array([9, 9, 9, 9])
    const promise = controller.onRecorderAudio({
      requestId,
      audio,
      mimeType: 'audio/wav',
      durationMs: 1000
    })

    controller.cancelDictation()
    settle('Too late.')
    await promise

    expect([...audio]).toEqual([0, 0, 0, 0])
    expect(deps.writeClipboard).not.toHaveBeenCalled()
    expect(deps.recordHistory).not.toHaveBeenCalled()
  })

  it('does nothing when there is nothing to cancel or stop', () => {
    const { controller, deps } = makeHarness()
    controller.cancelDictation()
    controller.stopDictation()
    expect(deps.broadcastStatus).not.toHaveBeenCalled()
  })

  it('refuses to start a second take while one is running', () => {
    const harness = makeHarness()
    harness.beginRecording()
    const starts = (): number =>
      harness.deps.sendToRecorder.mock.calls.filter(([channel]) => channel === 'recorder:start')
        .length
    const before = starts()
    harness.controller.startDictation('ui')
    expect(starts()).toBe(before)
  })

  it('reports what is busy and what is recording, for the buttons', async () => {
    const harness = makeHarness()
    const { controller } = harness
    expect(controller.isBusy()).toBe(false)
    const requestId = harness.beginRecording()
    expect(controller.isRecording()).toBe(true)
    expect(controller.isBusy()).toBe(true)
    controller.stopDictation()
    const promise = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 500
    })
    expect(controller.isRecording()).toBe(false)
    expect(controller.isBusy()).toBe(true)
    await vi.advanceTimersByTimeAsync(80)
    await promise
  })

  it('asks for a key without naming a provider it may not be using', () => {
    const { controller, deps } = makeHarness({ settings: { apiKeyConfigured: false } })
    controller.startDictation('ui')
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: 'Add your own API key in Settings before recording.' })
    )
    expect(deps.showMain).toHaveBeenCalledWith('settings')
  })
})
