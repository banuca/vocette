import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DictationController,
  type DictationDeps,
  type ForegroundState,
  type SoundKind,
  type WorkflowSettings
} from '../src/main/dictation-controller'
import { planReplacements, planVocabulary } from '../src/shared/entitlement'
import type { Page, WorkflowStatus } from '../src/shared/types'

/** Stands in for the snapshot of whatever the user had copied. */
const USER_CLIPBOARD = { snapshot: 'what the user had copied' }

function makeHarness(
  overrides: {
    settings?: Partial<WorkflowSettings>
    /** Whether Esc is being watched; left out, the dependency is absent. */
    escapeWatched?: boolean
    shortcutLabel?: string
  } = {}
) {
  const settings: WorkflowSettings = {
    recordingMode: 'hold',
    instantCapture: true,
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
    pro: true,
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
  const recordHistory = vi.fn<DictationDeps['recordHistory']>()
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
    shortcutLabel: () => overrides.shortcutLabel ?? 'Left Ctrl + Left Shift',
    ...(overrides.escapeWatched === undefined
      ? {}
      : { escapeWatched: () => overrides.escapeWatched === true }),
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
    expect(deps.recordHistory).toHaveBeenCalledWith('Hello world.', 2100, 'gpt-transcribe', {
      waitMs: expect.any(Number)
    })
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
    expect(deps.recordHistory).toHaveBeenCalledWith('Hello,world!', 100, 'gpt-transcribe', {
      heardText: 'um hello,world!',
      waitMs: expect.any(Number)
    })
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
      'gpt-transcribe',
      { heardText: 'um, so I I think we should, uh, ship it', waitMs: expect.any(Number) }
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
    expect(deps.recordHistory).toHaveBeenCalledWith('Um ist ein Wort', 100, 'gpt-transcribe', {
      heardText: 'um ist ein Wort',
      waitMs: expect.any(Number)
    })
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
      'gpt-transcribe',
      { heardText: 'um, so I think it works', waitMs: expect.any(Number) }
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

    // Only the outer whitespace went, which is not a change worth keeping.
    expect(deps.recordHistory).toHaveBeenCalledWith('um hello,world!', 100, 'gpt-transcribe', {
      waitMs: expect.any(Number)
    })
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
      'gpt-transcribe',
      { heardText: 'Send it to John, I mean Sarah. New line. Thanks.', waitMs: expect.any(Number) }
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
    expect(deps.recordHistory).toHaveBeenCalledWith('\n', 100, 'gpt-transcribe', {
      heardText: 'New line.',
      waitMs: expect.any(Number)
    })
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
    expect(deps.recordHistory).toHaveBeenCalledWith('ITU rocks', 100, 'gpt-transcribe', {
      heardText: 'um itu rocks',
      waitMs: expect.any(Number)
    })
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
      'gpt-transcribe',
      { heardText: 'um console log is broken', waitMs: expect.any(Number) }
    )
  })
})

describe('what History keeps of what was heard', () => {
  async function dictate(
    harness: ReturnType<typeof makeHarness>,
    rawText: string
  ): Promise<void> {
    harness.deps.transcribe.mockResolvedValue(rawText)
    const requestId = harness.beginRecording()
    await harness.controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 100
    })
  }

  it("keeps the recogniser's own words when a rule changed them", async () => {
    // Cleanup leaves this sentence alone; only the user's rule changes it.
    const harness = makeHarness({
      settings: { replacements: [{ spoken: 'itu', written: 'ITU' }] }
    })
    await dictate(harness, 'Send it to itu.')

    expect(harness.deps.recordHistory).toHaveBeenCalledWith(
      'Send it to ITU.',
      100,
      'gpt-transcribe',
      { heardText: 'Send it to itu.', waitMs: expect.any(Number) }
    )
  })

  it('keeps nothing extra when what was delivered is what was heard', async () => {
    const harness = makeHarness()
    await dictate(harness, 'Hello world.')

    const extras = harness.deps.recordHistory.mock.calls[0]?.[3]
    // Not even as undefined: History stores the raw text only when it differs.
    expect(extras).toEqual({ waitMs: expect.any(Number) })
    expect(extras).not.toHaveProperty('heardText')
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
    expect(deps.recordHistory).toHaveBeenCalledWith('Landed after all.', 700, 'gpt-transcribe', {
      waitMs: expect.any(Number)
    })
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

describe('the live level meter', () => {
  it('admits a reading only from the take being recorded right now', async () => {
    const { controller, lastRequestId } = makeHarness()
    expect(controller.isRecordingRequest('')).toBe(false)

    controller.onShortcutPressed()
    const requestId = lastRequestId()
    // Still opening the microphone: nothing is being recorded yet.
    expect(controller.isRecordingRequest(requestId)).toBe(false)

    controller.onRecorderStarted({ requestId })
    expect(controller.isRecordingRequest(requestId)).toBe(true)
    expect(controller.isRecordingRequest('an-older-take')).toBe(false)
    expect(controller.isRecordingRequest('')).toBe(false)

    // Released, but recording until the recorder hands the audio over.
    controller.onShortcutReleased()
    expect(controller.isRecordingRequest(requestId)).toBe(true)

    const promise = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array(4),
      mimeType: 'audio/wav',
      durationMs: 100
    })
    expect(controller.isRecordingRequest(requestId)).toBe(false)
    await vi.advanceTimersByTimeAsync(80)
    await promise
    expect(controller.isRecordingRequest(requestId)).toBe(false)
  })

  it('admits nothing from a take that was cancelled or failed', () => {
    const { controller, beginRecording } = makeHarness()
    const cancelled = beginRecording()
    controller.cancelDictation()
    expect(controller.isRecordingRequest(cancelled)).toBe(false)

    const failed = beginRecording()
    controller.onRecorderError({ requestId: failed, message: 'The microphone stopped unexpectedly.' })
    expect(controller.isRecordingRequest(failed)).toBe(false)
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
      'parakeet-tdt-0.6b-v3-int8',
      { waitMs: expect.any(Number) }
    )
  })
})

describe('instant capture: listening from the keypress', () => {
  type Harness = ReturnType<typeof makeHarness>

  /** Every message of one kind sent to the recorder, in order. */
  const sent = (harness: Harness, channel: string): unknown[] =>
    harness.deps.sendToRecorder.mock.calls
      .filter(([sentChannel]) => sentChannel === channel)
      .map(([, payload]) => payload)

  /** Nothing about the take has reached the user or anywhere they keep things. */
  const expectUnseen = (harness: Harness): void => {
    const { deps, controller } = harness
    expect(deps.broadcastStatus).not.toHaveBeenCalled()
    expect(deps.playSound).not.toHaveBeenCalled()
    expect(deps.transcribe).not.toHaveBeenCalled()
    expect(deps.recordHistory).not.toHaveBeenCalled()
    expect(deps.writeClipboard).not.toHaveBeenCalled()
    expect(deps.snapshotClipboard).not.toHaveBeenCalled()
    expect(deps.paste).not.toHaveBeenCalled()
    expect(deps.onRetryChanged).not.toHaveBeenCalled()
    expect(controller.canRetry()).toBe(false)
  }

  it('opens the microphone at the keypress, and shows and sounds nothing', () => {
    const harness = makeHarness({ settings: { playSounds: true } })
    const { controller, deps, lastRequestId } = harness
    controller.prepareDictation()

    expect(deps.sendToRecorder).toHaveBeenCalledTimes(1)
    expect(deps.sendToRecorder).toHaveBeenCalledWith('recorder:start', {
      requestId: lastRequestId(),
      microphoneId: 'mic-1'
    })
    // The window the press was made in is the paste target, as for any take.
    expect(deps.captureForeground).toHaveBeenCalledTimes(1)
    expect(controller.getStatus().phase).toBe('idle')
    expect(controller.isBusy()).toBe(false)
    expect(controller.isRecording()).toBe(false)

    // The microphone answering is not news either.
    controller.onRecorderStarted({ requestId: lastRequestId() })
    expectUnseen(harness)
  })

  it('arm, press, then the microphone answers: one "recording", one start sound, one take', () => {
    const harness = makeHarness()
    const { controller, deps, lastRequestId } = harness
    controller.prepareDictation()
    const requestId = lastRequestId()

    controller.onShortcutPressed()
    expect(deps.broadcastStatus).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'starting', detail: 'Keep holding the shortcut' })
    )
    expect(deps.playSound).not.toHaveBeenCalled()

    controller.onRecorderStarted({ requestId })
    expect(deps.broadcastStatus.mock.calls.map(([status]) => status.phase)).toEqual([
      'starting',
      'recording'
    ])
    expect(deps.playSound).toHaveBeenCalledTimes(1)
    expect(deps.playSound).toHaveBeenCalledWith('start')
    // The take opened at the keypress is the take: never a second microphone.
    expect(sent(harness, 'recorder:start')).toHaveLength(1)
    expect(deps.captureForeground).toHaveBeenCalledTimes(1)
  })

  it('arm, the microphone answers, then press: straight to recording, timed from the real start', () => {
    const harness = makeHarness()
    const { controller, deps, lastRequestId } = harness
    controller.prepareDictation()
    const requestId = lastRequestId()
    vi.advanceTimersByTime(120)
    controller.onRecorderStarted({ requestId })
    const liveAt = Date.now()
    vi.advanceTimersByTime(130)
    controller.onShortcutPressed()

    expect(deps.broadcastStatus).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'recording', message: 'Listening…', startedAt: liveAt })
    )
    expect(deps.playSound).toHaveBeenCalledTimes(1)
    expect(controller.isRecording()).toBe(true)

    // The five-minute cap counts from when recording really began.
    vi.advanceTimersByTime(5 * 60 * 1000 - 130 - 1)
    expect(sent(harness, 'recorder:stop')).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(sent(harness, 'recorder:stop')).toEqual([{ requestId }])
  })

  it('delivers a confirmed take like any other, first word and all', async () => {
    const harness = makeHarness()
    const { controller, deps, lastRequestId } = harness
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    controller.prepareDictation()
    const requestId = lastRequestId()
    controller.onRecorderStarted({ requestId })
    controller.onShortcutPressed()
    controller.onShortcutReleased()
    expect(deps.sendToRecorder).toHaveBeenLastCalledWith('recorder:stop', { requestId })

    const audio = new Uint8Array([1, 2, 3])
    const processing = controller.onRecorderAudio({
      requestId,
      audio,
      mimeType: 'audio/wav',
      durationMs: 1800
    })
    await vi.advanceTimersByTimeAsync(80)
    await processing

    expect(deps.transcribe).toHaveBeenCalledTimes(1)
    expect(deps.recordHistory).toHaveBeenCalledWith('Hello world.', 1800, 'gpt-transcribe', {
      waitMs: expect.any(Number)
    })
    expect(deps.paste).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'success', message: 'Pasted' })
    )
    expect([...audio]).toEqual([0, 0, 0])
  })

  it('arm, press, let go before the microphone answers: stops the moment it does', () => {
    const harness = makeHarness()
    const { controller, lastRequestId } = harness
    controller.prepareDictation()
    const requestId = lastRequestId()
    controller.onShortcutPressed()
    controller.onShortcutReleased()
    expect(sent(harness, 'recorder:stop')).toHaveLength(0)

    controller.onRecorderStarted({ requestId })
    expect(sent(harness, 'recorder:stop')).toEqual([{ requestId }])
  })

  it('arm, then let go before the microphone opened: cancelled unheard', () => {
    const harness = makeHarness()
    const { controller, lastRequestId } = harness
    controller.prepareDictation()
    const requestId = lastRequestId()
    controller.abandonPreparation()

    expect(sent(harness, 'recorder:cancel')).toEqual([{ requestId }])
    // A microphone answering afterwards is answering for nobody.
    controller.onRecorderStarted({ requestId })
    vi.advanceTimersByTime(10_000)
    expect(controller.getStatus().phase).toBe('idle')
    expect(sent(harness, 'recorder:cancel')).toHaveLength(1)
    expectUnseen(harness)
  })

  it('arm, the microphone opens, then another shortcut: cancelled unheard', () => {
    const harness = makeHarness()
    const { controller, lastRequestId } = harness
    controller.prepareDictation()
    const requestId = lastRequestId()
    vi.advanceTimersByTime(90)
    controller.onRecorderStarted({ requestId })
    vi.advanceTimersByTime(40)
    controller.abandonPreparation()

    expect(sent(harness, 'recorder:cancel')).toEqual([{ requestId }])
    vi.advanceTimersByTime(10_000)
    expect(controller.getStatus().phase).toBe('idle')
    expectUnseen(harness)
  })

  it('ignores the late audio of an abandoned take, and zeroes it', async () => {
    const harness = makeHarness()
    const { controller, lastRequestId } = harness
    controller.prepareDictation()
    const requestId = lastRequestId()
    controller.onRecorderStarted({ requestId })
    controller.abandonPreparation()

    const audio = new Uint8Array([5, 6, 7])
    await controller.onRecorderAudio({ requestId, audio, mimeType: 'audio/wav', durationMs: 300 })
    await vi.advanceTimersByTimeAsync(80)

    expect([...audio]).toEqual([0, 0, 0])
    expect(controller.getStatus().phase).toBe('idle')
    expectUnseen(harness)
  })

  it('abandons a take neither confirmed nor cancelled within two seconds', () => {
    const harness = makeHarness()
    const { controller, deps, lastRequestId } = harness
    controller.prepareDictation()
    const requestId = lastRequestId()
    controller.onRecorderStarted({ requestId })

    vi.advanceTimersByTime(1999)
    expect(sent(harness, 'recorder:cancel')).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(sent(harness, 'recorder:cancel')).toEqual([{ requestId }])
    // Silent, and never reported later as a microphone that did not start.
    vi.advanceTimersByTime(10_000)
    expect(sent(harness, 'recorder:cancel')).toHaveLength(1)
    expectUnseen(harness)

    // A press that does arrive after all starts afresh, where the user can see it.
    controller.onShortcutPressed()
    expect(sent(harness, 'recorder:start')).toHaveLength(2)
    expect(lastRequestId()).not.toBe(requestId)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'starting' })
    )
  })

  it('keeps the ceiling silent even when the microphone never answers', () => {
    const harness = makeHarness()
    const { controller, lastRequestId } = harness
    controller.prepareDictation()
    const requestId = lastRequestId()
    vi.advanceTimersByTime(8000)
    expect(sent(harness, 'recorder:cancel')).toEqual([{ requestId }])
    expect(controller.getStatus().phase).toBe('idle')
    expectUnseen(harness)
  })

  it('opens nothing while a take is being opened, recorded or transcribed', async () => {
    const harness = makeHarness()
    const { controller, deps, lastRequestId } = harness
    controller.onShortcutPressed()
    controller.prepareDictation()
    expect(sent(harness, 'recorder:start')).toHaveLength(1)

    const requestId = lastRequestId()
    controller.onRecorderStarted({ requestId })
    controller.prepareDictation()
    expect(sent(harness, 'recorder:start')).toHaveLength(1)

    let finish!: (text: string) => void
    deps.transcribe.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        })
    )
    controller.onShortcutReleased()
    const processing = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 500
    })
    await Promise.resolve()
    expect(controller.getStatus().phase).toBe('processing')
    controller.prepareDictation()
    expect(sent(harness, 'recorder:start')).toHaveLength(1)
    // An arm that was turned away leaves nothing behind to cancel.
    controller.abandonPreparation()
    expect(sent(harness, 'recorder:cancel')).toHaveLength(0)

    finish('Done.')
    await vi.advanceTimersByTimeAsync(80)
    await processing
    expect(deps.recordHistory).toHaveBeenCalledTimes(1)
    expect(deps.recordHistory).toHaveBeenCalledWith('Done.', 500, 'gpt-transcribe', {
      waitMs: expect.any(Number)
    })
  })

  it('does nothing with the setting off, and the press starts as it always did', () => {
    const harness = makeHarness({ settings: { instantCapture: false } })
    const { controller, deps } = harness
    controller.prepareDictation()
    controller.abandonPreparation()
    expect(deps.sendToRecorder).not.toHaveBeenCalled()
    expect(deps.captureForeground).not.toHaveBeenCalled()

    controller.onShortcutPressed()
    expect(sent(harness, 'recorder:start')).toHaveLength(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'starting' })
    )
  })

  it('opens nothing without a way to transcribe, and leaves the reason to the press', () => {
    const harness = makeHarness({
      settings: { transcriptionReady: false, notReadyReason: 'Download the speech model first.' }
    })
    const { controller, deps } = harness
    controller.prepareDictation()
    expect(deps.sendToRecorder).not.toHaveBeenCalled()
    expect(deps.broadcastStatus).not.toHaveBeenCalled()
    expect(deps.showMain).not.toHaveBeenCalled()

    controller.onShortcutPressed()
    expect(deps.sendToRecorder).not.toHaveBeenCalled()
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'error', detail: 'Download the speech model first.' })
    )
    expect(deps.showMain).toHaveBeenCalledWith('settings')
  })

  it('checks again when the press is held, and lets the take go if it can no longer be transcribed', () => {
    const harness = makeHarness()
    const { controller, deps, settings, lastRequestId } = harness
    controller.prepareDictation()
    const requestId = lastRequestId()
    settings.transcriptionReady = false
    settings.notReadyReason = 'Download the speech model first.'

    controller.onShortcutPressed()
    expect(sent(harness, 'recorder:cancel')).toEqual([{ requestId }])
    expect(sent(harness, 'recorder:start')).toHaveLength(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'error', detail: 'Download the speech model first.' })
    )
  })

  it('in toggle mode: arm, press, and a second press stops without opening another take', () => {
    const harness = makeHarness({ settings: { recordingMode: 'toggle' } })
    const { controller, deps, lastRequestId } = harness
    controller.prepareDictation()
    const requestId = lastRequestId()
    controller.onShortcutPressed()
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'starting',
        detail: 'Press Left Ctrl + Left Shift again to finish'
      })
    )
    controller.onRecorderStarted({ requestId })
    // Letting go means nothing in toggle mode.
    controller.onShortcutReleased()
    expect(controller.getStatus().phase).toBe('recording')

    // The press that stops it is armed too, and must not open a second take.
    controller.prepareDictation()
    controller.onShortcutPressed()
    expect(sent(harness, 'recorder:start')).toHaveLength(1)
    expect(deps.sendToRecorder).toHaveBeenLastCalledWith('recorder:stop', { requestId })
    expect(deps.playSound).toHaveBeenCalledTimes(1)
  })

  it('in toggle mode: a stop press that turns into another shortcut leaves the recording alone', () => {
    const harness = makeHarness({ settings: { recordingMode: 'toggle' } })
    const { controller, lastRequestId } = harness
    controller.prepareDictation()
    const requestId = lastRequestId()
    controller.onShortcutPressed()
    controller.onRecorderStarted({ requestId })

    controller.prepareDictation()
    controller.abandonPreparation()
    expect(sent(harness, 'recorder:cancel')).toHaveLength(0)
    expect(sent(harness, 'recorder:stop')).toHaveLength(0)
    expect(controller.getStatus().phase).toBe('recording')
  })

  it('leaves a confirmed take alone when an arm is abandoned after it', () => {
    const harness = makeHarness()
    const { controller } = harness
    controller.prepareDictation()
    controller.onShortcutPressed()
    controller.abandonPreparation()
    expect(sent(harness, 'recorder:cancel')).toHaveLength(0)
    expect(controller.getStatus().phase).toBe('starting')
  })

  it('arms afresh with a new id, and ignores the abandoned take’s late news', async () => {
    const harness = makeHarness()
    const { controller, deps, lastRequestId } = harness
    controller.prepareDictation()
    const abandoned = lastRequestId()
    controller.abandonPreparation()
    controller.prepareDictation()
    const current = lastRequestId()
    expect(current).not.toBe(abandoned)

    controller.onRecorderStarted({ requestId: abandoned })
    controller.onRecorderError({ requestId: abandoned, message: 'Microphone open cancelled' })
    const audio = new Uint8Array([8, 8])
    await controller.onRecorderAudio({
      requestId: abandoned,
      audio,
      mimeType: 'audio/wav',
      durationMs: 100
    })
    expect([...audio]).toEqual([0, 0])
    expect(deps.broadcastStatus).not.toHaveBeenCalled()

    // The current take was never reported live, so a press shows it opening…
    controller.onShortcutPressed()
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'starting' })
    )
    // …until its own microphone answers.
    controller.onRecorderStarted({ requestId: current })
    expect(controller.getStatus().phase).toBe('recording')
    expect(sent(harness, 'recorder:cancel')).toEqual([{ requestId: abandoned }])
  })

  it('keeps a failed take for Retry through a press that was never a dictation', async () => {
    const harness = makeHarness()
    const { controller, deps } = harness
    deps.transcribe.mockRejectedValueOnce(new Error('Provider unavailable.'))
    const first = harness.beginRecording()
    controller.onShortcutReleased()
    const audio = new Uint8Array([4, 4])
    await controller.onRecorderAudio({
      requestId: first,
      audio,
      mimeType: 'audio/wav',
      durationMs: 400
    })
    expect(controller.canRetry()).toBe(true)
    deps.onRetryChanged.mockClear()
    deps.broadcastStatus.mockClear()

    // Ctrl + Shift + T while the error is still on screen.
    controller.prepareDictation()
    controller.abandonPreparation()
    expect(controller.canRetry()).toBe(true)
    expect([...audio]).toEqual([4, 4])
    expect(deps.onRetryChanged).not.toHaveBeenCalled()
    expect(deps.broadcastStatus).not.toHaveBeenCalled()
    expect(controller.getStatus().phase).toBe('error')

    // Held this time: a new take, which replaces the kept one as any take does.
    controller.prepareDictation()
    controller.onShortcutPressed()
    expect(controller.canRetry()).toBe(false)
    expect([...audio]).toEqual([0, 0])
    expect(deps.onRetryChanged).toHaveBeenLastCalledWith(false)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'starting', canRetry: false })
    )
  })

  it('lets a lingering message go on time without disturbing the take opened under it', async () => {
    const harness = makeHarness()
    const { controller, deps, lastRequestId } = harness
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    await dictate(harness)
    expect(controller.getStatus().phase).toBe('success')
    vi.advanceTimersByTime(1500)

    controller.prepareDictation()
    const requestId = lastRequestId()
    deps.broadcastStatus.mockClear()
    vi.advanceTimersByTime(100)
    // The success message expires as it would have anyway…
    expect(deps.broadcastStatus).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'idle' })
    )
    // …and the take opened at the keypress carries on under the same id.
    expect(sent(harness, 'recorder:cancel')).toHaveLength(0)
    controller.onRecorderStarted({ requestId })
    controller.onShortcutPressed()
    expect(controller.getStatus().phase).toBe('recording')
    controller.onShortcutReleased()
    expect(deps.sendToRecorder).toHaveBeenLastCalledWith('recorder:stop', { requestId })
  })

  it('treats a recorder failure for an unconfirmed take as not news, and a held press tries again', () => {
    const harness = makeHarness()
    const { controller, deps, lastRequestId } = harness
    const unavailable =
      'The selected microphone is unavailable. Choose another microphone in Settings.'
    controller.prepareDictation()
    const first = lastRequestId()
    controller.onRecorderError({ requestId: first, message: unavailable })
    expectUnseen(harness)
    expect(deps.showMain).not.toHaveBeenCalled()

    controller.onShortcutPressed()
    expect(sent(harness, 'recorder:start')).toHaveLength(2)
    const second = lastRequestId()
    expect(second).not.toBe(first)
    // A device that really is at fault says so now, once the user can see it.
    controller.onRecorderError({ requestId: second, message: unavailable })
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'error', detail: unavailable })
    )
  })

  it('ends an unconfirmed take that the recorder finished on its own, unheard', async () => {
    // Audio only follows a stop, which a provisional take never gets — unless
    // its device went away and the recorder wrapped the take up itself.
    const harness = makeHarness()
    const { controller, deps, lastRequestId } = harness
    controller.prepareDictation()
    const requestId = lastRequestId()
    controller.onRecorderStarted({ requestId })
    const audio = new Uint8Array([3, 3])
    await controller.onRecorderAudio({ requestId, audio, mimeType: 'audio/wav', durationMs: 90 })

    expect([...audio]).toEqual([0, 0])
    expect(sent(harness, 'recorder:cancel')).toEqual([{ requestId }])
    expectUnseen(harness)

    controller.onShortcutPressed()
    expect(sent(harness, 'recorder:start')).toHaveLength(2)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'starting' })
    )
  })

  it('lets the tray reset close a take opened at the keypress', () => {
    const harness = makeHarness()
    const { controller, deps, lastRequestId } = harness
    controller.prepareDictation()
    const requestId = lastRequestId()
    controller.onRecorderStarted({ requestId })

    controller.resetKeyState()
    expect(sent(harness, 'recorder:cancel')).toEqual([{ requestId }])
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'idle' })
    )
    // The shortcut's own disarm follows, and finds nothing left to do.
    controller.abandonPreparation()
    expect(sent(harness, 'recorder:cancel')).toHaveLength(1)
  })

  it('closes a take opened at the keypress before Retry takes over', async () => {
    const harness = makeHarness()
    const { controller, deps, lastRequestId } = harness
    deps.transcribe
      .mockRejectedValueOnce(new Error('Provider unavailable.'))
      .mockResolvedValueOnce('On the second try.')
    const first = harness.beginRecording()
    controller.onShortcutReleased()
    await controller.onRecorderAudio({
      requestId: first,
      audio: new Uint8Array([2, 2]),
      mimeType: 'audio/wav',
      durationMs: 400
    })

    // The failed take's own clean-up has already told the recorder.
    const earlier = sent(harness, 'recorder:cancel').length
    controller.prepareDictation()
    const provisional = lastRequestId()
    const retry = controller.retryLast()
    expect(sent(harness, 'recorder:cancel').slice(earlier)).toEqual([{ requestId: provisional }])
    await vi.advanceTimersByTimeAsync(80)
    await retry
    expect(deps.recordHistory).toHaveBeenLastCalledWith(
      'On the second try.',
      400,
      'gpt-transcribe',
      { waitMs: expect.any(Number) }
    )
    // Its arm ending afterwards has nothing left to cancel.
    controller.abandonPreparation()
    expect(sent(harness, 'recorder:cancel')).toHaveLength(earlier + 1)
  })

  it('starts a take from the window cleanly over one opened at the keypress', () => {
    const harness = makeHarness()
    const { controller, deps, lastRequestId } = harness
    controller.prepareDictation()
    const provisional = lastRequestId()

    controller.startDictation('ui')
    const messages = deps.sendToRecorder.mock.calls.map(([channel, payload]) => [
      channel,
      (payload as { requestId: string }).requestId
    ])
    expect(messages).toEqual([
      ['recorder:start', provisional],
      ['recorder:cancel', provisional],
      ['recorder:start', lastRequestId()]
    ])
    expect(lastRequestId()).not.toBe(provisional)
    expect(deps.clearForeground).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'starting', detail: 'Press Stop when you have finished' })
    )
  })

  it('opens no take while "paste last dictation" is still delivering', async () => {
    const harness = makeHarness()
    const { controller, deps } = harness
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    const pasting = controller.pasteLast('Earlier words.')
    controller.prepareDictation()
    expect(deps.sendToRecorder).not.toHaveBeenCalled()
    // The paste checks against the target it captured itself, and no other.
    expect(deps.captureForeground).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(80)
    await pasting
    expect(deps.paste).toHaveBeenCalledTimes(1)
    expect(deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'success', message: 'Pasted your last dictation' })
    )

    // Once it has landed, the next press is heard from its keypress again.
    controller.prepareDictation()
    expect(sent(harness, 'recorder:start')).toHaveLength(1)
  })

  it('times a confirmed take’s microphone from the keypress, and reports one that never answers', () => {
    const harness = makeHarness()
    const { controller, lastRequestId } = harness
    controller.prepareDictation()
    const requestId = lastRequestId()
    vi.advanceTimersByTime(250)
    controller.onShortcutPressed()

    vi.advanceTimersByTime(8000 - 250 - 1)
    expect(controller.getStatus().phase).toBe('starting')
    vi.advanceTimersByTime(1)
    expect(controller.getStatus().phase).toBe('error')
    expect(sent(harness, 'recorder:cancel')).toEqual([{ requestId }])
  })

  it('gives the microphone back at shutdown', () => {
    const harness = makeHarness()
    const { controller, lastRequestId } = harness
    controller.prepareDictation()
    const requestId = lastRequestId()
    controller.shutdown()
    expect(sent(harness, 'recorder:cancel')).toEqual([{ requestId }])
    vi.advanceTimersByTime(10_000)
    expect(sent(harness, 'recorder:cancel')).toHaveLength(1)
    expectUnseen(harness)
  })

  it('warms the engine only once a take is confirmed and live, never costing the take anything', () => {
    const harness = makeHarness()
    const { controller, deps, lastRequestId } = harness
    const prewarm = vi.fn(() => {
      throw new Error('The speech engine could not start on this PC.')
    })
    Object.assign(deps, { prewarm })

    // A keypress that may yet be another shortcut loads nothing.
    controller.prepareDictation()
    controller.onRecorderStarted({ requestId: lastRequestId() })
    expect(prewarm).not.toHaveBeenCalled()
    // Confirmed, with the microphone already live: now it warms, once.
    controller.onShortcutPressed()
    expect(prewarm).toHaveBeenCalledTimes(1)
    expect(controller.getStatus().phase).toBe('recording')

    // An ordinary start warms when the microphone answers, not when asked for:
    // loading beside the device's own start-up slowed the device.
    controller.cancelDictation()
    controller.startDictation('ui')
    expect(prewarm).toHaveBeenCalledTimes(1)
    controller.onRecorderStarted({ requestId: lastRequestId() })
    expect(prewarm).toHaveBeenCalledTimes(2)
    expect(controller.getStatus().phase).toBe('recording')

    // A keypress abandoned before it was confirmed never warms at all.
    const abandoned = makeHarness()
    const abandonedPrewarm = vi.fn()
    Object.assign(abandoned.deps, { prewarm: abandonedPrewarm })
    abandoned.controller.prepareDictation()
    abandoned.controller.onRecorderStarted({ requestId: abandoned.lastRequestId() })
    abandoned.controller.abandonPreparation()
    expect(abandonedPrewarm).not.toHaveBeenCalled()
  })
})

describe('your words, corrected after recognition', () => {
  /** A stand-in for the SCOWL list the main process supplies. */
  const COMMON = new Set(['send', 'it', 'to', 'mean', 'sarah', 'the', 'draft'])
  const isCommon = (word: string): boolean => COMMON.has(word)

  async function dictate(
    harness: ReturnType<typeof makeHarness>,
    rawText: string
  ): Promise<void> {
    harness.deps.transcribe.mockResolvedValue(rawText)
    const requestId = harness.beginRecording()
    await harness.controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 100
    })
  }

  it('corrects the raw text before cleanup runs', async () => {
    const harness = makeHarness({ settings: { vocabulary: ['ITU-T'] } })
    await dictate(harness, 'um the ITUT draft')

    expect(harness.deps.writeClipboard).toHaveBeenCalledWith('The ITU-T draft')
    expect(harness.deps.recordHistory).toHaveBeenCalledWith(
      'The ITU-T draft',
      100,
      'gpt-transcribe',
      { heardText: 'um the ITUT draft', waitMs: expect.any(Number) }
    )
  })

  it('lets cleanup see the corrected word', async () => {
    // Corrected first, "kirinda" is the name "Kirinde", so the spoken
    // correction can replace it. The other way round, cleanup would have seen
    // a lower-case word with no kind, kept "I mean", and only then had the
    // name fixed: "Send it to Kirinde, I mean Sarah."
    const harness = makeHarness({ settings: { vocabulary: ['Kirinde'] } })
    Object.assign(harness.deps, { commonWords: vi.fn(async () => isCommon) })
    await dictate(harness, 'Send it to kirinda, I mean Sarah.')

    expect(harness.deps.recordHistory).toHaveBeenCalledWith(
      'Send it to Sarah.',
      100,
      'gpt-transcribe',
      { heardText: 'Send it to kirinda, I mean Sarah.', waitMs: expect.any(Number) }
    )
  })

  it('reads the common-word list only when there are terms to correct', async () => {
    const commonWords = vi.fn(async () => isCommon)
    const empty = makeHarness()
    Object.assign(empty.deps, { commonWords })
    await dictate(empty, 'Send it to kirinda.')
    expect(commonWords).not.toHaveBeenCalled()

    const withTerms = makeHarness({ settings: { vocabulary: ['Kirinde'] } })
    Object.assign(withTerms.deps, { commonWords })
    await dictate(withTerms, 'Send it to kirinda.')
    expect(commonWords).toHaveBeenCalledTimes(1)
    expect(withTerms.deps.recordHistory).toHaveBeenCalledWith(
      'Send it to Kirinde.',
      100,
      'gpt-transcribe',
      { heardText: 'Send it to kirinda.', waitMs: expect.any(Number) }
    )
  })

  it('still delivers the take when the common-word list cannot be read', async () => {
    const harness = makeHarness({ settings: { vocabulary: ['ITU-T', 'Kirinde'] } })
    Object.assign(harness.deps, {
      commonWords: vi.fn(async () => {
        throw new Error('the list is missing')
      })
    })
    await dictate(harness, 'send the ITUT draft to kirinda')

    // Without the list only what cannot change a real word is corrected.
    expect(harness.deps.recordHistory).toHaveBeenCalledWith(
      'Send the ITU-T draft to kirinda',
      100,
      'gpt-transcribe',
      { heardText: 'send the ITUT draft to kirinda', waitMs: expect.any(Number) }
    )
    expect(harness.deps.broadcastStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'success' })
    )
  })
})

describe('silence stays silent', () => {
  /** A shortcut take the recorder found no speech in, handed over. */
  async function silentTake(
    harness: ReturnType<typeof makeHarness>,
    audio = new Uint8Array([1, 2, 3, 4])
  ): Promise<string> {
    const requestId = harness.beginRecording()
    harness.controller.onShortcutReleased()
    await harness.controller.onRecorderAudio({
      requestId,
      audio,
      mimeType: 'audio/wav',
      durationMs: 1400,
      speechDetected: false
    })
    return requestId
  }

  it.each(['cloud', 'local'] as const)(
    'sends a silent take to neither engine, and keeps or delivers nothing (%s)',
    async (engine) => {
      const harness = makeHarness({ settings: { engine } })
      const { controller, deps } = harness
      deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
      const audio = new Uint8Array([1, 2, 3, 4])
      await silentTake(harness, audio)

      expect(deps.transcribe).not.toHaveBeenCalled()
      expect(deps.recordHistory).not.toHaveBeenCalled()
      expect(deps.snapshotClipboard).not.toHaveBeenCalled()
      expect(deps.writeClipboard).not.toHaveBeenCalled()
      expect(deps.paste).not.toHaveBeenCalled()
      expect(controller.canRetry()).toBe(false)
      expect(deps.onRetryChanged).not.toHaveBeenCalled()
      // Only the start cue: no error sound, and no success sound either.
      expect(deps.playSound.mock.calls).toEqual([['start']])
      expect([...audio]).toEqual([0, 0, 0, 0])
      expect(deps.broadcastStatus).toHaveBeenLastCalledWith({
        phase: 'cancelled',
        message: 'No speech heard — nothing was sent.',
        canRetry: false
      })
      // Straight from listening to the note: nothing was ever "Transcribing…".
      expect(deps.broadcastStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'processing' })
      )
    }
  )

  it('shows the note for about 1.6 s, and nothing fires after it', async () => {
    const harness = makeHarness()
    const { controller, deps } = harness
    await silentTake(harness)

    vi.advanceTimersByTime(1599)
    expect(controller.getStatus().phase).toBe('cancelled')
    vi.advanceTimersByTime(1)
    expect(controller.getStatus().phase).toBe('idle')

    // The stop watchdog and the five-minute cap went with the take, and the
    // recorder, which has already finished it, is told nothing more.
    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(deps.broadcastStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'error' })
    )
    expect(deps.sendToRecorder).not.toHaveBeenCalledWith('recorder:cancel', expect.anything())
    expect(deps.transcribe).not.toHaveBeenCalled()
  })

  it('lets the next press start at once, while the note is still showing', async () => {
    const harness = makeHarness()
    const { controller } = harness
    const silent = await silentTake(harness)

    const next = harness.beginRecording()
    expect(next).not.toBe(silent)
    expect(controller.getStatus().phase).toBe('recording')
    // The note's own timer must not reset the new take underneath it.
    vi.advanceTimersByTime(1600)
    expect(controller.getStatus().phase).toBe('recording')
  })

  it('still transcribes a take that held speech, or that carries no flag at all', async () => {
    for (const speechDetected of [true, undefined]) {
      const { controller, deps, beginRecording } = makeHarness()
      const requestId = beginRecording()
      controller.onShortcutReleased()
      const promise = controller.onRecorderAudio({
        requestId,
        audio: new Uint8Array([1, 2]),
        mimeType: 'audio/wav',
        durationMs: 900,
        speechDetected
      })
      await vi.advanceTimersByTimeAsync(80)
      await promise

      expect(deps.transcribe).toHaveBeenCalledTimes(1)
      expect(deps.recordHistory).toHaveBeenCalledWith('Hello world.', 900, 'gpt-transcribe', {
        waitMs: expect.any(Number)
      })
    }
  })
})

/**
 * Free's limits as a take meets them. The settings are built with the same
 * functions the main process uses for every take, so this is the path a real
 * dictation follows: the cloud request and the correction after it both see
 * the capped list, and the stored list itself is never cut.
 */
describe('the plan limits, as a take uses them', () => {
  const settingsFor = (
    vocabulary: string,
    replacements: string,
    pro: boolean
  ): Partial<WorkflowSettings> => ({
    pro,
    vocabulary: planVocabulary(vocabulary, pro),
    replacements: planReplacements(replacements, pro)
  })

  /** Fifty terms, then Dataverse as the fifty-first. */
  const TERMS = [...Array.from({ length: 50 }, (_, index) => `Term${index}`), 'Dataverse'].join('\n')
  /** Twenty rules, then a twenty-first. */
  const RULES = Array.from({ length: 21 }, (_, index) => `word${index} => W${index}`).join('\n')

  async function dictate(harness: ReturnType<typeof makeHarness>, rawText: string): Promise<void> {
    harness.deps.transcribe.mockResolvedValue(rawText)
    const requestId = harness.beginRecording()
    await harness.controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/wav',
      durationMs: 100
    })
  }

  const sentTerms = (harness: ReturnType<typeof makeHarness>): string[] =>
    harness.deps.transcribe.mock.calls[0]?.[0].vocabulary ?? []

  it('leaves the 51st term out of the request and the correction on Free', async () => {
    const harness = makeHarness({ settings: settingsFor(TERMS, '', false) })
    await dictate(harness, 'Open data verse now.')

    expect(sentTerms(harness)).toHaveLength(50)
    expect(sentTerms(harness)).not.toContain('Dataverse')
    // Nothing changed what was heard, so no heard text is kept beside it.
    expect(harness.deps.recordHistory).toHaveBeenCalledWith(
      'Open data verse now.',
      100,
      'gpt-transcribe',
      { waitMs: expect.any(Number) }
    )
  })

  it('sends the 51st term with Pro, and corrects to it', async () => {
    const harness = makeHarness({ settings: settingsFor(TERMS, '', true) })
    await dictate(harness, 'Open data verse now.')

    expect(sentTerms(harness)).toHaveLength(51)
    expect(sentTerms(harness).at(-1)).toBe('Dataverse')
    expect(harness.deps.recordHistory).toHaveBeenCalledWith(
      'Open Dataverse now.',
      100,
      'gpt-transcribe',
      { heardText: 'Open data verse now.', waitMs: expect.any(Number) }
    )
  })

  it('applies the first 20 rules on Free, and the 21st only with Pro', async () => {
    const free = makeHarness({ settings: settingsFor('', RULES, false) })
    await dictate(free, 'Say word0 and word20.')
    expect(free.deps.recordHistory).toHaveBeenCalledWith('Say W0 and word20.', 100, 'gpt-transcribe', {
      heardText: 'Say word0 and word20.',
      waitMs: expect.any(Number)
    })

    const pro = makeHarness({ settings: settingsFor('', RULES, true) })
    await dictate(pro, 'Say word0 and word20.')
    expect(pro.deps.recordHistory).toHaveBeenCalledWith('Say W0 and W20.', 100, 'gpt-transcribe', {
      heardText: 'Say word0 and word20.',
      waitMs: expect.any(Number)
    })
  })
})

describe('Esc cancels a recording nobody is holding a key for', () => {
  const lastStatus = (harness: ReturnType<typeof makeHarness>): WorkflowStatus | undefined =>
    harness.deps.broadcastStatus.mock.calls.at(-1)?.[0]

  it('cancels a hands-free recording, unheard', async () => {
    const harness = makeHarness({ settings: { recordingMode: 'toggle' }, escapeWatched: true })
    const { controller, deps } = harness
    const requestId = harness.beginRecording()
    expect(controller.getStatus().phase).toBe('recording')

    controller.cancelOnEscape()
    expect(deps.sendToRecorder).toHaveBeenLastCalledWith('recorder:cancel', { requestId })
    expect(lastStatus(harness)).toEqual(
      expect.objectContaining({ phase: 'cancelled', message: 'Dictation cancelled' })
    )
    // Audio that still arrives for it is thrown away.
    await controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
      durationMs: 1500
    })
    expect(deps.transcribe).not.toHaveBeenCalled()
    expect(deps.recordHistory).not.toHaveBeenCalled()
    expect(controller.canRetry()).toBe(false)
  })

  it('cancels while the microphone is still opening', () => {
    const harness = makeHarness({ settings: { recordingMode: 'toggle' }, escapeWatched: true })
    harness.controller.onShortcutPressed()
    expect(harness.controller.getStatus().phase).toBe('starting')
    harness.controller.cancelOnEscape()
    expect(harness.controller.getStatus().phase).toBe('cancelled')
  })

  it('cancels a take started from the window, whatever the mode', () => {
    const harness = makeHarness({ escapeWatched: true })
    harness.controller.startDictation('ui')
    harness.controller.onRecorderStarted({ requestId: harness.lastRequestId() })
    harness.controller.cancelOnEscape()
    expect(harness.controller.getStatus().phase).toBe('cancelled')
  })

  it('leaves a take that is held to talk alone', () => {
    const harness = makeHarness({ escapeWatched: true })
    harness.beginRecording()
    harness.controller.cancelOnEscape()
    expect(harness.controller.getStatus().phase).toBe('recording')
  })

  it('leaves a take alone once it is being transcribed', async () => {
    const harness = makeHarness({ settings: { recordingMode: 'toggle' }, escapeWatched: true })
    const { controller, deps } = harness
    let finish: (text: string) => void = () => {}
    deps.transcribe.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        })
    )
    const requestId = harness.beginRecording()
    controller.onShortcutPressed()
    const delivered = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
      durationMs: 1500
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getStatus().phase).toBe('processing')

    controller.cancelOnEscape()
    expect(controller.getStatus().phase).toBe('processing')
    finish('Hello world.')
    await vi.advanceTimersByTimeAsync(100)
    await delivered
    expect(deps.recordHistory).toHaveBeenCalledTimes(1)
  })

  it('does nothing when nothing is recording, nor to a keypress take not yet confirmed', () => {
    const harness = makeHarness({ settings: { recordingMode: 'toggle' }, escapeWatched: true })
    harness.controller.cancelOnEscape()
    expect(harness.deps.broadcastStatus).not.toHaveBeenCalled()

    // A provisional take is the shortcut's to keep or drop. Esc is a key
    // outside the chord, so the arm ending is what lets it go.
    harness.controller.prepareDictation()
    harness.controller.cancelOnEscape()
    expect(harness.deps.broadcastStatus).not.toHaveBeenCalled()
    expect(harness.deps.sendToRecorder).not.toHaveBeenCalledWith(
      'recorder:cancel',
      expect.anything()
    )
  })
})

describe('how long the text took', () => {
  const successStatus = (harness: ReturnType<typeof makeHarness>): WorkflowStatus | undefined =>
    harness.deps.broadcastStatus.mock.calls
      .map(([status]) => status)
      .filter((status) => status.phase === 'success')
      .at(-1)

  it('is measured from letting go until the text is ready, and kept and shown', async () => {
    const harness = makeHarness()
    const { controller, deps } = harness
    deps.getForegroundState.mockReturnValue({ sameWindow: true, elevated: false })
    deps.transcribe.mockImplementation(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('Hello world.'), 420))
    )
    const requestId = harness.beginRecording()
    vi.advanceTimersByTime(3_000)
    controller.onShortcutReleased()
    // The recorder takes a moment to hand the audio over; the user is waiting.
    vi.advanceTimersByTime(60)
    const delivered = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
      durationMs: 3_000
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await delivered

    const extras = deps.recordHistory.mock.calls[0]?.[3]
    expect(extras?.waitMs).toBe(480)
    expect(successStatus(harness)).toEqual(
      expect.objectContaining({ message: 'Pasted', waitMs: 480 })
    )
  })

  it('counts a Retry from its own press', async () => {
    const harness = makeHarness()
    const { controller, deps } = harness
    deps.transcribe.mockRejectedValueOnce(new Error('Network down.'))
    const requestId = harness.beginRecording()
    controller.onShortcutReleased()
    await controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
      durationMs: 1_000
    })
    expect(controller.canRetry()).toBe(true)

    // A long pause before pressing Retry is not part of the wait.
    vi.advanceTimersByTime(60_000)
    deps.transcribe.mockImplementation(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('On the second try.'), 700))
    )
    const retried = controller.retryLast()
    await vi.advanceTimersByTimeAsync(1_000)
    await retried
    expect(deps.recordHistory.mock.calls.at(-1)?.[3]?.waitMs).toBe(700)
  })

  it('starts as the audio arrives for a take the recorder ended by itself', async () => {
    const harness = makeHarness({ settings: { recordingMode: 'toggle' } })
    const { controller, deps } = harness
    deps.transcribe.mockImplementation(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('Cut short.'), 250))
    )
    const requestId = harness.beginRecording()
    vi.advanceTimersByTime(5_000)
    // No stop was asked for: the device went away, say, and the recorder
    // handed over what it had.
    const delivered = controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
      durationMs: 5_000
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await delivered
    expect(deps.recordHistory.mock.calls[0]?.[3]?.waitMs).toBe(250)
  })

  it('is never sent to the transcriber', async () => {
    const harness = makeHarness()
    const requestId = harness.beginRecording()
    harness.controller.onShortcutReleased()
    await harness.controller.onRecorderAudio({
      requestId,
      audio: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
      durationMs: 1_000
    })
    const [payload] = harness.deps.transcribe.mock.calls[0] ?? []
    expect(payload).not.toHaveProperty('waitMs')
  })
})

describe('the finish hint', () => {
  const details = (harness: ReturnType<typeof makeHarness>): (string | undefined)[] =>
    harness.deps.broadcastStatus.mock.calls.map(([status]) => status.detail)

  it('hold to talk: keep holding, then let go', () => {
    const harness = makeHarness({ escapeWatched: true })
    harness.beginRecording()
    expect(details(harness)).toEqual([
      'Keep holding the shortcut',
      'Release Left Ctrl + Left Shift to finish'
    ])
  })

  it('hands-free: press again, or Esc', () => {
    const harness = makeHarness({ settings: { recordingMode: 'toggle' }, escapeWatched: true })
    harness.beginRecording()
    expect(details(harness)).toEqual([
      'Press Left Ctrl + Left Shift to finish · Esc to cancel',
      'Press Left Ctrl + Left Shift to finish · Esc to cancel'
    ])
  })

  it('hands-free with a long chord: the chord is not spelt out, so Esc stays visible', () => {
    const harness = makeHarness({
      settings: { recordingMode: 'toggle' },
      escapeWatched: true,
      shortcutLabel: 'Left Ctrl + Left Alt + Space'
    })
    harness.beginRecording()
    expect(details(harness).at(-1)).toBe('Press the shortcut again to finish · Esc to cancel')
  })

  it('from the window: press Stop, or Esc', () => {
    const harness = makeHarness({ escapeWatched: true })
    harness.controller.startDictation('ui')
    harness.controller.onRecorderStarted({ requestId: harness.lastRequestId() })
    expect(details(harness)).toEqual([
      'Press Stop when you have finished · Esc to cancel',
      'Press Stop when you have finished · Esc to cancel'
    ])
  })

  it('offers Esc only while it is being watched', () => {
    const toggle = makeHarness({ settings: { recordingMode: 'toggle' }, escapeWatched: false })
    toggle.beginRecording()
    expect(details(toggle)).toEqual([
      'Press Left Ctrl + Left Shift again to finish',
      'Press Left Ctrl + Left Shift again to finish'
    ])

    const fromWindow = makeHarness({ escapeWatched: false })
    fromWindow.controller.startDictation('ui')
    fromWindow.controller.onRecorderStarted({ requestId: fromWindow.lastRequestId() })
    expect(details(fromWindow).at(-1)).toBe('Press Stop when you have finished')
  })

  it('gives a hands-free take opened at the keypress the same hint once confirmed', () => {
    const harness = makeHarness({ settings: { recordingMode: 'toggle' }, escapeWatched: true })
    harness.controller.prepareDictation()
    harness.controller.onRecorderStarted({ requestId: harness.lastRequestId() })
    harness.controller.onShortcutPressed()
    expect(details(harness)).toEqual(['Press Left Ctrl + Left Shift to finish · Esc to cancel'])
  })
})
