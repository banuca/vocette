import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DictationController,
  type DictationDeps,
  type ForegroundState,
  type SoundKind,
  type WorkflowSettings
} from '../src/main/dictation-controller'
import type { Page, WorkflowStatus } from '../src/shared/types'

/** Stands in for the snapshot of whatever the user had copied. */
const USER_CLIPBOARD = { snapshot: 'what the user had copied' }

function makeHarness(overrides: { settings?: Partial<WorkflowSettings> } = {}) {
  const settings: WorkflowSettings = {
    recordingMode: 'hold',
    autoPaste: true,
    pasteAvailable: true,
    restoreClipboard: true,
    removeFillers: true,
    spokenCorrections: true,
    spokenFormatting: true,
    playSounds: false,
    engine: 'cloud',
    model: 'gpt-transcribe',
    language: 'en',
    vocabulary: [],
    replacements: [],
    microphoneId: 'mic-1',
    transcriptionReady: true,
    notReadyReason: null,
    ...overrides.settings
  }

  const sendToRecorder = vi.fn<DictationDeps['sendToRecorder']>()
  const transcribe = vi.fn<DictationDeps['transcribe']>(async () => 'Hello world.')
  const writeClipboard = vi.fn<(text: string) => void>()
  const snapshotClipboard = vi.fn<() => unknown>(() => USER_CLIPBOARD)
  const restoreClipboard = vi.fn<(token: unknown, ours: string) => void>()
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
    snapshotClipboard,
    restoreClipboard,
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
        engine: 'cloud',
        audio: expect.any(Uint8Array),
        mimeType: 'audio/wav',
        durationMs: 2100,
        model: 'gpt-transcribe',
        language: 'en',
        vocabulary: [],
        onRetry: expect.any(Function)
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

  it('forwards the configured vocabulary to the transcriber', async () => {
    // Read at decision time from getSettings, like every other field, so a
    // list edited mid-take applies to the take that follows it.
    const { controller, deps, beginRecording } = makeHarness({
      settings: { vocabulary: ['Kirinde', 'ITU-T'] }
    })
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    const requestId = beginRecording()
    controller.onShortcutReleased()
    const promise = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1, 2]),
      mimeType: 'audio/wav',
      durationMs: 900
    })
    await vi.advanceTimersByTimeAsync(80)
    await promise

    expect(deps.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ vocabulary: ['Kirinde', 'ITU-T'] }),
      expect.any(AbortSignal)
    )
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
    // Not "Copied and pasted": the clipboard is given back after the paste.
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'Pasted' })
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

/** A shortcut take, run until its paste has been sent or refused. */
async function dictate(harness: ReturnType<typeof makeHarness>): Promise<void> {
  const requestId = harness.beginRecording()
  harness.controller.onShortcutReleased()
  const promise = harness.controller.onRecorderAudio({
    requestId,
    audio: new Uint8Array([1, 2, 3]),
    mimeType: 'audio/wav',
    durationMs: 500
  })
  await vi.advanceTimersByTimeAsync(80)
  await promise
}

describe('clipboard custody', () => {
  it('copies the clipboard before the transcript goes on, and gives it back 750 ms after the paste', async () => {
    const harness = makeHarness()
    const { deps } = harness
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    await dictate(harness)

    expect(deps.paste).toHaveBeenCalledTimes(1)
    expect(deps.snapshotClipboard).toHaveBeenCalledTimes(1)
    // Taken first, so it holds what the user had rather than the transcript.
    expect(deps.snapshotClipboard.mock.invocationCallOrder[0]).toBeLessThan(
      deps.writeClipboard.mock.invocationCallOrder[0] ?? 0
    )

    vi.advanceTimersByTime(749)
    expect(deps.restoreClipboard).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(deps.restoreClipboard).toHaveBeenCalledWith(USER_CLIPBOARD, 'Hello world.')
    expect(deps.restoreClipboard).toHaveBeenCalledTimes(1)
  })

  it('takes no copy when focus has moved, and leaves the transcript on the clipboard', async () => {
    const harness = makeHarness()
    const { deps } = harness
    deps.getForegroundState.mockReturnValue({ sameWindow: false, elevated: false })
    await dictate(harness)

    expect(deps.snapshotClipboard).not.toHaveBeenCalled()
    expect(deps.writeClipboard).toHaveBeenCalledWith('Hello world.')
    vi.advanceTimersByTime(5000)
    expect(deps.restoreClipboard).not.toHaveBeenCalled()
  })

  it('keeps the transcript when the paste is refused at the last moment', async () => {
    const harness = makeHarness()
    const { deps } = harness
    // Focus moves during the settle delay, after the copy was taken.
    deps.getForegroundState
      .mockReturnValueOnce({ sameWindow: true, elevated: false })
      .mockReturnValue({ sameWindow: false, elevated: false })
    await dictate(harness)

    expect(deps.snapshotClipboard).toHaveBeenCalledTimes(1)
    expect(deps.paste).not.toHaveBeenCalled()
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'Copied — paste manually (focus moved)' })
    )
    // The user has to paste it themselves, so it must still be there.
    vi.advanceTimersByTime(5000)
    expect(deps.restoreClipboard).not.toHaveBeenCalled()
  })

  it('takes no copy when "Put my clipboard back" is off', async () => {
    const harness = makeHarness({ settings: { restoreClipboard: false } })
    const { deps } = harness
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    await dictate(harness)

    expect(deps.paste).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'success', message: 'Pasted' })
    )
    vi.advanceTimersByTime(5000)
    expect(deps.snapshotClipboard).not.toHaveBeenCalled()
    expect(deps.restoreClipboard).not.toHaveBeenCalled()
  })

  it('never reads the clipboard for a delivery that only copies', async () => {
    // Started from the window: there is no target, so nothing is pasted.
    const fromWindow = makeHarness()
    fromWindow.deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    fromWindow.controller.startDictation('ui')
    const requestId = fromWindow.lastRequestId()
    fromWindow.controller.onRecorderStarted({ requestId })
    fromWindow.controller.stopDictation()
    await fromWindow.controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 300
    })
    expect(fromWindow.deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'success', message: 'Copied to clipboard' })
    )
    expect(fromWindow.deps.snapshotClipboard).not.toHaveBeenCalled()

    // Automatic paste switched off.
    const pasteOff = makeHarness({ settings: { autoPaste: false } })
    pasteOff.deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    await dictate(pasteOff)
    expect(pasteOff.deps.writeClipboard).toHaveBeenCalledWith('Hello world.')
    expect(pasteOff.deps.snapshotClipboard).not.toHaveBeenCalled()

    vi.advanceTimersByTime(5000)
    expect(fromWindow.deps.restoreClipboard).not.toHaveBeenCalled()
    expect(pasteOff.deps.restoreClipboard).not.toHaveBeenCalled()
  })

  it('still gives the clipboard back when the take is cancelled after the paste was sent', async () => {
    const harness = makeHarness()
    const { controller, deps } = harness
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    // Cancelled the instant the keystroke goes out.
    deps.paste.mockImplementation(() => controller.cancelDictation())
    await dictate(harness)

    expect(deps.paste).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'cancelled' })
    )
    // The paste already happened, so the loan is returned as if nothing else had.
    vi.advanceTimersByTime(750)
    expect(deps.restoreClipboard).toHaveBeenCalledWith(USER_CLIPBOARD, 'Hello world.')
  })

  it('gives the clipboard back at once when the take is cancelled before the paste', async () => {
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
    // Copied and written; waiting out the settle delay.
    expect(deps.snapshotClipboard).toHaveBeenCalledTimes(1)
    expect(deps.writeClipboard).toHaveBeenCalledTimes(1)

    controller.cancelDictation()
    await vi.advanceTimersByTimeAsync(80)
    await processing

    expect(deps.paste).not.toHaveBeenCalled()
    // Nothing was delivered, so nothing borrowed stays borrowed.
    expect(deps.restoreClipboard).toHaveBeenCalledWith(USER_CLIPBOARD, 'Hello world.')
    vi.advanceTimersByTime(5000)
    expect(deps.restoreClipboard).toHaveBeenCalledTimes(1)
  })

  it('gives back a clipboard still on loan at shutdown, at once', async () => {
    const harness = makeHarness()
    const { controller, deps } = harness
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    await dictate(harness)
    expect(deps.restoreClipboard).not.toHaveBeenCalled()

    controller.shutdown()
    expect(deps.restoreClipboard).toHaveBeenCalledWith(USER_CLIPBOARD, 'Hello world.')
    // And only once: the scheduled return is not left to run as well.
    vi.advanceTimersByTime(5000)
    expect(deps.restoreClipboard).toHaveBeenCalledTimes(1)
  })

  it('settles a loan still outstanding before copying the clipboard for the next paste', async () => {
    const harness = makeHarness()
    const { controller, deps } = harness
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    await dictate(harness)
    expect(deps.restoreClipboard).not.toHaveBeenCalled()

    // Pasted again well inside the 750 ms: the copy must be of what the user
    // had, so the first loan is returned before the second is taken.
    const pasting = controller.pasteLast('Hello world.')
    expect(deps.restoreClipboard).toHaveBeenCalledTimes(1)
    expect(deps.restoreClipboard.mock.invocationCallOrder[0]).toBeLessThan(
      deps.snapshotClipboard.mock.invocationCallOrder[1] ?? 0
    )
    await vi.advanceTimersByTimeAsync(80)
    await pasting

    vi.advanceTimersByTime(750)
    expect(deps.restoreClipboard).toHaveBeenCalledTimes(2)
  })

  it('pastes anyway when the clipboard cannot be read', async () => {
    const harness = makeHarness()
    const { deps } = harness
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    deps.snapshotClipboard.mockImplementation(() => {
      throw new Error('The clipboard is locked by another application.')
    })
    await dictate(harness)

    // A clipboard problem is not a failed dictation: nothing to retry.
    expect(deps.paste).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'success', message: 'Pasted' })
    )
    expect(harness.controller.canRetry()).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(deps.restoreClipboard).not.toHaveBeenCalled()
  })
})

describe('waiting for held modifier keys before pasting', () => {
  it('pastes only once Alt and Shift from the shortcut have been let go', async () => {
    const { controller, deps } = makeHarness()
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    let held = true
    const modifiersHeld = vi.fn(() => held)
    Object.assign(deps, { modifiersHeld })

    const pasting = controller.pasteLast('Earlier words.')
    await vi.advanceTimersByTimeAsync(80)
    await vi.advanceTimersByTimeAsync(150)
    // Still held: a Ctrl + V now would arrive as Ctrl + Alt + Shift + V.
    expect(deps.paste).not.toHaveBeenCalled()

    held = false
    await vi.advanceTimersByTimeAsync(30)
    await pasting
    expect(deps.paste).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'success', message: 'Pasted your last dictation' })
    )
  })

  it('copies instead when the keys are still held after the wait', async () => {
    const { controller, deps } = makeHarness()
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    Object.assign(deps, { modifiersHeld: () => true })

    const pasting = controller.pasteLast('Earlier words.')
    await vi.advanceTimersByTimeAsync(80 + 1500 + 50)
    await pasting

    expect(deps.paste).not.toHaveBeenCalled()
    expect(deps.writeClipboard).toHaveBeenCalledWith('Earlier words.')
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'success',
        message: 'Copied — paste manually (keys were still held down)'
      })
    )
    // The transcript is what the user needs now, so nothing is put back.
    vi.advanceTimersByTime(1000)
    expect(deps.restoreClipboard).not.toHaveBeenCalled()
  })

  it('does not wait when the platform cannot tell', async () => {
    const { controller, deps } = makeHarness()
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    Object.assign(deps, { modifiersHeld: () => null })

    const pasting = controller.pasteLast('Earlier words.')
    await vi.advanceTimersByTimeAsync(80)
    await pasting
    expect(deps.paste).toHaveBeenCalledTimes(1)
  })

  it('never delays a dictation whose shortcut was already released', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    const modifiersHeld = vi.fn(() => false)
    Object.assign(deps, { modifiersHeld })
    const requestId = beginRecording()
    controller.onShortcutReleased()
    const processing = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
      durationMs: 1200
    })
    await vi.advanceTimersByTimeAsync(80)
    await processing
    expect(modifiersHeld).toHaveBeenCalled()
    expect(deps.paste).toHaveBeenCalledTimes(1)
  })
})

describe('paste last dictation', () => {
  it('pastes into the window in front, borrowing the clipboard like a dictation', async () => {
    const { controller, deps } = makeHarness()
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    const pasting = controller.pasteLast('Earlier words.')
    await vi.advanceTimersByTimeAsync(80)
    await pasting

    // The target is captured now, then checked like any other.
    expect(deps.captureForeground).toHaveBeenCalledTimes(1)
    expect(deps.captureForeground.mock.invocationCallOrder[0]).toBeLessThan(
      deps.getForegroundState.mock.invocationCallOrder[0] ?? 0
    )
    expect(deps.snapshotClipboard.mock.invocationCallOrder[0]).toBeLessThan(
      deps.writeClipboard.mock.invocationCallOrder[0] ?? 0
    )
    expect(deps.writeClipboard).toHaveBeenCalledWith('Earlier words.')
    expect(deps.paste).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith({
      phase: 'success',
      message: 'Pasted your last dictation',
      detail: 'Earlier words.',
      canRetry: false
    })
    // Nothing is transcribed again, and nothing new goes into history.
    expect(deps.transcribe).not.toHaveBeenCalled()
    expect(deps.recordHistory).not.toHaveBeenCalled()

    vi.advanceTimersByTime(750)
    expect(deps.restoreClipboard).toHaveBeenCalledWith(USER_CLIPBOARD, 'Earlier words.')
    vi.advanceTimersByTime(1600)
    expect(controller.getStatus().phase).toBe('idle')
  })

  it('copies instead of typing into a window it cannot verify or that runs elevated', async () => {
    const { controller, deps } = makeHarness()
    await controller.pasteLast('Earlier words.')
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'success',
        message: 'Copied — paste manually (focus could not be verified)'
      })
    )

    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: true })
    await controller.pasteLast('Earlier words.')
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'success',
        message: 'Copied — paste manually (focused app runs elevated)'
      })
    )

    expect(deps.writeClipboard).toHaveBeenCalledTimes(2)
    expect(deps.writeClipboard).toHaveBeenLastCalledWith('Earlier words.')
    expect(deps.paste).not.toHaveBeenCalled()
    // The transcript stays for the user to paste, so nothing is borrowed.
    expect(deps.snapshotClipboard).not.toHaveBeenCalled()
  })

  it('is ignored while a take is running', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    beginRecording()
    const broadcasts = deps.broadcastStatus.mock.calls.length

    await controller.pasteLast('Earlier words.')
    await vi.advanceTimersByTimeAsync(80)

    expect(deps.writeClipboard).not.toHaveBeenCalled()
    expect(deps.paste).not.toHaveBeenCalled()
    expect(deps.snapshotClipboard).not.toHaveBeenCalled()
    // Only the take captured a target.
    expect(deps.captureForeground).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenCalledTimes(broadcasts)
    expect(controller.getStatus().phase).toBe('recording')
  })

  it('pastes with "Paste automatically" off, because it was asked for by name', async () => {
    const { controller, deps } = makeHarness({ settings: { autoPaste: false } })
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    const pasting = controller.pasteLast('Earlier words.')
    await vi.advanceTimersByTimeAsync(80)
    await pasting

    expect(deps.paste).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'Pasted your last dictation' })
    )
  })

  it('only copies where this platform cannot paste safely', async () => {
    const { controller, deps } = makeHarness({ settings: { pasteAvailable: false } })
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    await controller.pasteLast('Earlier words.')

    expect(deps.writeClipboard).toHaveBeenCalledWith('Earlier words.')
    expect(deps.paste).not.toHaveBeenCalled()
    expect(deps.snapshotClipboard).not.toHaveBeenCalled()
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'success', message: 'Copied to clipboard' })
    )
  })

  it('gives way to a take started during its settle delay', async () => {
    const { controller, deps } = makeHarness()
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    const pasting = controller.pasteLast('Earlier words.')
    expect(deps.writeClipboard).toHaveBeenCalledWith('Earlier words.')

    controller.startDictation('shortcut')
    await vi.advanceTimersByTimeAsync(80)
    await pasting

    // No keystroke, and no success announced over the new take.
    expect(deps.paste).not.toHaveBeenCalled()
    expect(controller.getStatus().phase).toBe('starting')
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'starting' })
    )
    // Nothing was pasted, so the clipboard goes back at once.
    expect(deps.restoreClipboard).toHaveBeenCalledWith(USER_CLIPBOARD, 'Earlier words.')
  })

  it('lets a second press supersede one still waiting to paste', async () => {
    const { controller, deps } = makeHarness()
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    const first = controller.pasteLast('Earlier words.')
    const second = controller.pasteLast('Earlier words.')
    await vi.advanceTimersByTimeAsync(80)
    await Promise.all([first, second])

    expect(deps.paste).toHaveBeenCalledTimes(1)
    // The first loan was settled when the second borrowed; the second one is
    // returned on its own schedule, not cut short by the first giving up.
    expect(deps.restoreClipboard).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(750)
    expect(deps.restoreClipboard).toHaveBeenCalledTimes(2)
  })

  it('does nothing without text to paste', async () => {
    const { controller, deps } = makeHarness()
    await controller.pasteLast('')
    expect(deps.captureForeground).not.toHaveBeenCalled()
    expect(deps.writeClipboard).not.toHaveBeenCalled()
    expect(deps.broadcastStatus).not.toHaveBeenCalled()
  })
})

describe('language-aware cleanup', () => {
  it('applies cleanup to explicitly English dictation', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.transcribe.mockResolvedValue('  um hello,world!  ')
    const requestId = beginRecording()

    await controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 100
    })

    // No space is inserted after the comma any more: that rule is what
    // turned "example.com" into "example. com".
    expect(deps.recordHistory).toHaveBeenCalledWith('Hello,world!', 100, 'gpt-transcribe')
  })

  it('removes fillers under Automatic, which the old English-only gate skipped', async () => {
    const { controller, deps, beginRecording } = makeHarness({ settings: { language: 'auto' } })
    deps.transcribe.mockResolvedValue('  um, so I I think we should, uh, ship it  ')
    const requestId = beginRecording()

    await controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 100
    })

    // What is pasted and what history keeps are the same cleaned text.
    expect(deps.writeClipboard).toHaveBeenCalledWith('So I think we should ship it')
    expect(deps.recordHistory).toHaveBeenCalledWith(
      'So I think we should ship it',
      100,
      'gpt-transcribe'
    )
  })

  it('keeps a German "um", which is a word, while still repairing the text', async () => {
    const { controller, deps, beginRecording } = makeHarness({ settings: { language: 'de' } })
    deps.transcribe.mockResolvedValue('  um ist ein Wort  ')
    const requestId = beginRecording()

    await controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 100
    })

    // Only the capital is new: the repairs now run in every language.
    expect(deps.recordHistory).toHaveBeenCalledWith('Um ist ein Wort', 100, 'gpt-transcribe')
  })

  it('cleans automatic-language Retry text the same way as the first attempt', async () => {
    const { controller, deps, beginRecording } = makeHarness({ settings: { language: 'auto' } })
    deps.transcribe
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce('  um, so I think it works  ')
    const requestId = beginRecording()

    await controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 100
    })
    await controller.retryLast()

    expect(deps.recordHistory).toHaveBeenLastCalledWith(
      'So I think it works',
      100,
      'gpt-transcribe'
    )
  })

  it('preserves English text apart from outer whitespace when every cleanup switch is off', async () => {
    const { controller, deps, beginRecording } = makeHarness({
      settings: { removeFillers: false, spokenCorrections: false, spokenFormatting: false }
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

  it('passes the spoken-correction and line-break switches through to the cleanup', async () => {
    const { controller, deps, beginRecording } = makeHarness({
      settings: { spokenCorrections: false }
    })
    deps.transcribe.mockResolvedValue('Send it to John, I mean Sarah. New line. Thanks.')
    const requestId = beginRecording()

    await controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 100
    })

    // Corrections off: "I mean" stays. Line breaks on: the command becomes one.
    expect(deps.recordHistory).toHaveBeenCalledWith(
      'Send it to John, I mean Sarah.\nThanks.',
      100,
      'gpt-transcribe'
    )
  })

  it('pastes a take that was only a spoken line break', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    deps.transcribe.mockResolvedValue('New line.')
    const requestId = beginRecording()
    controller.onShortcutReleased()

    const promise = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 100
    })
    await vi.advanceTimersByTimeAsync(80)
    await promise

    // A line break is something the user asked for, not silence.
    expect(deps.writeClipboard).toHaveBeenCalledWith('\n')
    expect(deps.recordHistory).toHaveBeenCalledWith('\n', 100, 'gpt-transcribe')
    expect(deps.paste).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'success', message: 'Pasted' })
    )
  })

  it('reports a take that held only fillers as empty', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.transcribe.mockResolvedValue('  Um, uh... hmm.  ')
    const requestId = beginRecording()

    await controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 100
    })

    expect(deps.recordHistory).not.toHaveBeenCalled()
    expect(deps.writeClipboard).not.toHaveBeenCalled()
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'error',
        detail: 'Only filler words or silence were detected.'
      })
    )
  })
})

describe('replacements and snippets', () => {
  it('applies a rule to the delivered and recorded text, after cleanup', async () => {
    const { controller, deps, beginRecording } = makeHarness({
      settings: { replacements: [{ spoken: 'itu', written: 'ITU' }] }
    })
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    deps.transcribe.mockResolvedValue('um itu rocks')
    const requestId = beginRecording()
    controller.onShortcutReleased()

    const promise = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 100
    })
    await vi.advanceTimersByTimeAsync(80)
    await promise

    // Cleanup took the "um" out; the rule then wrote the capitals it wanted.
    expect(deps.writeClipboard).toHaveBeenCalledWith('ITU rocks')
    expect(deps.recordHistory).toHaveBeenCalledWith('ITU rocks', 100, 'gpt-transcribe')
    expect(deps.paste).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'success', detail: 'ITU rocks' })
    )
  })

  it('runs after cleanup, so what a rule writes is never recapitalised', async () => {
    // The other way round, cleanup would have dropped the "um" afterwards and
    // capitalised the snippet into "Console.log()".
    const { controller, deps, beginRecording } = makeHarness({
      settings: { replacements: [{ spoken: 'console log', written: 'console.log()' }] }
    })
    deps.transcribe.mockResolvedValue('um console log is broken')
    const requestId = beginRecording()

    await controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 100
    })

    expect(deps.writeClipboard).toHaveBeenCalledWith('console.log() is broken')
    expect(deps.recordHistory).toHaveBeenCalledWith(
      'console.log() is broken',
      100,
      'gpt-transcribe'
    )
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
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith({
      phase: 'idle',
      message: 'Ready',
      canRetry: false
    })
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
    // Retry is pressed in Murmur's own window or tray, so the result goes to
    // the clipboard for the user to paste where they meant it to go.
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'success', message: 'Copied to clipboard' })
    )
    expect(controller.canRetry()).toBe(false)
    expect(deps.onRetryChanged).toHaveBeenLastCalledWith(false)
    expect([...audio]).toEqual([0, 0, 0])
  })

  it('never pastes a retry into whatever has focus, which is Murmur itself', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    // The window in front when Retry is pressed checks out as a valid target —
    // it is Murmur's own window — and still nothing may be typed into it.
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    deps.transcribe
      .mockRejectedValueOnce(new Error('The transcription service is temporarily unavailable.'))
      .mockResolvedValueOnce('On the second try.')
    const requestId = beginRecording()
    controller.onShortcutReleased()
    await controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([9, 9, 9]),
      mimeType: 'audio/wav',
      durationMs: 1200
    })
    deps.captureForeground.mockClear()

    const retryPromise = controller.retryLast()
    await vi.advanceTimersByTimeAsync(80)
    await retryPromise

    expect(deps.captureForeground).not.toHaveBeenCalled()
    expect(deps.clearForeground).toHaveBeenCalled()
    expect(deps.paste).not.toHaveBeenCalled()
    expect(deps.snapshotClipboard).not.toHaveBeenCalled()
    expect(deps.writeClipboard).toHaveBeenLastCalledWith('On the second try.')
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

  /** A shortcut take whose transcription fails once, left showing its error. */
  async function failOnce(harness: ReturnType<typeof makeHarness>): Promise<void> {
    harness.deps.transcribe.mockRejectedValueOnce(
      new Error('The transcription service is temporarily unavailable.')
    )
    const requestId = harness.beginRecording()
    harness.controller.onShortcutReleased()
    await harness.controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([4, 4]),
      mimeType: 'audio/wav',
      durationMs: 400
    })
  }

  it('tells the window on every status whether a failed take is kept, idle included', async () => {
    const harness = makeHarness()
    const { deps } = harness
    await failOnce(harness)

    // Nothing was kept while the take was being recorded.
    expect(deps.broadcastStatus).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'recording', canRetry: false })
    )
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'error', canRetry: true })
    )
    vi.advanceTimersByTime(4500)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith({
      phase: 'idle',
      message: 'Ready',
      canRetry: true
    })
  })

  it('stops offering Retry once the retried take has landed', async () => {
    const harness = makeHarness()
    const { controller, deps } = harness
    await failOnce(harness)
    deps.transcribe.mockResolvedValueOnce('On the second try.')
    deps.broadcastStatus.mockClear()

    const retry = controller.retryLast()
    await vi.advanceTimersByTimeAsync(80)
    await retry

    // Still kept while it is being sent again, in case this attempt fails too…
    expect(deps.broadcastStatus).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'processing', canRetry: true })
    )
    // …and no longer offered from the moment it has been delivered.
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'success', canRetry: false })
    )
    vi.advanceTimersByTime(1600)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'idle', canRetry: false })
    )
  })

  it('stops offering Retry the moment a new take starts', async () => {
    const harness = makeHarness()
    const { controller, deps } = harness
    await failOnce(harness)

    // While the error is still on screen: that is when people press again.
    controller.startDictation('ui')
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'starting', canRetry: false })
    )
  })

  it('keeps a failed on-device take for Retry too', async () => {
    const harness = makeHarness({
      settings: { engine: 'local', model: 'parakeet-tdt-0.6b-v3-int8' }
    })
    await failOnce(harness)
    expect(harness.deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'error', canRetry: true })
    )
    expect(harness.controller.canRetry()).toBe(true)
  })

  it('says the service was busy while it is asked once more, then carries on', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    deps.transcribe.mockImplementationOnce(async (payload) => {
      payload.onRetry?.()
      return 'Landed after all.'
    })
    const requestId = beginRecording()
    controller.onShortcutReleased()
    const processing = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1, 2]),
      mimeType: 'audio/wav',
      durationMs: 700
    })
    await vi.advanceTimersByTimeAsync(80)
    await processing

    expect(deps.broadcastStatus).toHaveBeenCalledWith({
      phase: 'processing',
      message: 'Transcribing…',
      detail: 'The service was busy — trying once more',
      canRetry: false
    })
    const processingDetails = deps.broadcastStatus.mock.calls
      .map(([status]) => status)
      .filter((status) => status.phase === 'processing')
      .map((status) => status.detail)
    expect(processingDetails).toEqual([
      'Your audio is being converted to text',
      'The service was busy — trying once more'
    ])
    // The retry was the service's own business: the take still lands.
    expect(deps.recordHistory).toHaveBeenCalledWith('Landed after all.', 700, 'gpt-transcribe')
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'success' })
    )
  })

  it('does not bring a cancelled take back to "Transcribing…" when the service retries', async () => {
    const { controller, deps, beginRecording } = makeHarness()
    let announceRetry!: () => void
    let finish!: (text: string) => void
    deps.transcribe.mockImplementationOnce(
      (payload) =>
        new Promise<string>((resolve) => {
          announceRetry = () => payload.onRetry?.()
          finish = resolve
        })
    )
    const requestId = beginRecording()
    controller.onShortcutReleased()
    const processing = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1, 2]),
      mimeType: 'audio/wav',
      durationMs: 700
    })

    controller.cancelDictation()
    const broadcasts = deps.broadcastStatus.mock.calls.length
    announceRetry()
    finish('Too late.')
    await processing

    expect(deps.broadcastStatus).toHaveBeenCalledTimes(broadcasts)
    expect(controller.getStatus().phase).toBe('cancelled')
  })

  it('sends the user to Settings when transcription is not set up', () => {
    const { controller, deps } = makeHarness({
      settings: {
        transcriptionReady: false,
        notReadyReason: 'Add your API key in Settings before recording.'
      }
    })
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
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith({
      phase: 'idle',
      message: 'Ready',
      canRetry: false
    })
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

  it('names what is missing, in the words readiness gave it', () => {
    // The on-device engine needs its model, not a key: asking for a key
    // there would send the user looking for the wrong thing.
    for (const reason of [
      'Download the speech model first.',
      'Add your API key in Settings before recording.'
    ]) {
      const { controller, deps } = makeHarness({
        settings: { transcriptionReady: false, notReadyReason: reason }
      })
      controller.startDictation('ui')
      expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: 'error', detail: reason })
      )
      expect(deps.showMain).toHaveBeenCalledWith('settings')
      expect(deps.sendToRecorder).not.toHaveBeenCalled()
    }
  })

  it('hands the engine the take was set up for to the transcriber', async () => {
    const { controller, deps, beginRecording } = makeHarness({
      settings: { engine: 'local', model: 'parakeet-tdt-0.6b-v3-int8' }
    })
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    const requestId = beginRecording()
    controller.onShortcutReleased()
    const promise = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1, 2]),
      mimeType: 'audio/wav',
      durationMs: 1200
    })
    await vi.advanceTimersByTimeAsync(80)
    await promise

    expect(deps.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ engine: 'local' }),
      expect.any(AbortSignal)
    )
    // History names the model that did the work.
    expect(deps.recordHistory).toHaveBeenCalledWith(
      'Hello world.',
      1200,
      'parakeet-tdt-0.6b-v3-int8'
    )
  })
})
