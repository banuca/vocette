import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Toggle mode across the real shortcut backend and the real dictation
 * controller, wired the way `src/main/index.ts` wires them. The unit tests for
 * each half passed while toggle mode still failed to stop on the second press,
 * because the defect lived in the seam between them.
 */
const hook = {
  listeners: new Map<string, ((event: { keycode: number }) => void)[]>(),
  on(event: string, listener: (payload: never) => void) {
    const list = hook.listeners.get(event) ?? []
    list.push(listener as (event: { keycode: number }) => void)
    hook.listeners.set(event, list)
  },
  off: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  keyTap: vi.fn(),
  emit(event: string, payload: { keycode: number }) {
    for (const listener of hook.listeners.get(event) ?? []) listener(payload)
  }
}

vi.mock('uiohook-napi', () => ({
  uIOhook: hook,
  UiohookKey: { V: 0x002f, Ctrl: 0x001d }
}))

const { KEY } = await import('../src/shared/keycodes')
const { ShortcutController } = await import('../src/main/shortcut-controller')
const { DictationController } = await import('../src/main/dictation-controller')
type WorkflowSettings = import('../src/main/dictation-controller').WorkflowSettings

const keyDown = (keycode: number): void => hook.emit('keydown', { keycode })
const keyUp = (keycode: number): void => hook.emit('keyup', { keycode })

function makeHarness(mode: 'hold' | 'toggle' = 'toggle', holdDelayMs = 250) {
  const settings: WorkflowSettings = {
    recordingMode: mode,
    autoPaste: true,
    pasteAvailable: true,
    removeFillers: true,
    spokenCorrections: true,
    spokenFormatting: true,
    playSounds: false,
    engine: 'cloud',
    model: 'gpt-transcribe',
    language: 'en',
    vocabulary: [],
    microphoneId: 'mic-1',
    transcriptionReady: true,
    notReadyReason: null
  }

  const sendToRecorder = vi.fn()
  const dictation = new DictationController({
    sendToRecorder,
    getSettings: () => settings,
    transcribe: async () => 'Hello world.',
    writeClipboard: vi.fn(),
    paste: vi.fn(),
    playSound: vi.fn(),
    broadcastStatus: vi.fn(),
    showMain: vi.fn(),
    recordHistory: vi.fn(),
    captureForeground: vi.fn(),
    clearForeground: vi.fn(),
    getForegroundState: () => null,
    shortcutLabel: () => 'Left Ctrl + Left Shift',
    onRetryChanged: vi.fn()
  })

  const shortcut = new ShortcutController({
    chord: { keys: [KEY.Ctrl, KEY.Shift] },
    holdDelayMs,
    onPress: () => dictation.onShortcutPressed(),
    onRelease: () => dictation.onShortcutReleased(),
    onError: vi.fn(),
    onCapture: vi.fn()
  })
  shortcut.start()
  // Exactly what `applyRecordingMode()` does in src/main/index.ts.
  shortcut.setTapToFire(mode === 'toggle')

  /** Presses and releases the chord, held for `heldMs`. */
  const tapChord = (heldMs: number): void => {
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    vi.advanceTimersByTime(heldMs)
    keyUp(KEY.Shift)
    keyUp(KEY.Ctrl)
  }

  /** The chord as the prefix of a longer OS shortcut, e.g. Ctrl+Shift+T. */
  const pressWithExtraKey = (): void => {
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    vi.advanceTimersByTime(40)
    keyDown(KEY.T)
    vi.advanceTimersByTime(60)
    keyUp(KEY.T)
    keyUp(KEY.Shift)
    keyUp(KEY.Ctrl)
    vi.advanceTimersByTime(400)
  }

  const startRecorder = (): void => {
    const start = sendToRecorder.mock.calls.filter(([channel]) => channel === 'recorder:start').at(-1)
    dictation.onRecorderStarted({ requestId: (start?.[1] as { requestId: string }).requestId })
  }

  const stopped = (): boolean =>
    sendToRecorder.mock.calls.some(([channel]) => channel === 'recorder:stop')

  return { dictation, shortcut, settings, tapChord, pressWithExtraKey, startRecorder, stopped }
}

beforeEach(() => {
  vi.useFakeTimers()
  hook.listeners.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('toggle mode', () => {
  it('starts on the first press and stops on a second press of the same length', () => {
    const { dictation, tapChord, startRecorder, stopped } = makeHarness()

    tapChord(500)
    startRecorder()
    expect(dictation.getStatus().phase).toBe('recording')

    tapChord(500)
    expect(stopped()).toBe(true)
  })

  it('stops on a quick second press, which is how people actually tap a toggle', () => {
    const { dictation, tapChord, startRecorder, stopped } = makeHarness()

    tapChord(500)
    startRecorder()
    expect(dictation.getStatus().phase).toBe('recording')

    // Well under the 250 ms hold delay: a normal tap.
    tapChord(80)
    expect(stopped()).toBe(true)
  })

  it('starts from a quick tap too, without waiting out the hold delay', () => {
    const { dictation, tapChord } = makeHarness()

    tapChord(80)
    expect(dictation.getStatus().phase).toBe('starting')
  })

  it('still ignores the chord when it is the prefix of a longer shortcut', () => {
    const { dictation, pressWithExtraKey } = makeHarness()

    pressWithExtraKey()
    expect(dictation.getStatus().phase).toBe('idle')
  })

  it('leaves hold-to-talk alone: a tap records nothing', () => {
    const { dictation, tapChord } = makeHarness('hold')

    tapChord(80)
    expect(dictation.getStatus().phase).toBe('idle')
  })
})
