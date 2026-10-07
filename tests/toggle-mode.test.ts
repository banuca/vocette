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
const { ARM_INTENT_MS, ShortcutController } = await import('../src/main/shortcut-controller')
const { DictationController } = await import('../src/main/dictation-controller')
type WorkflowSettings = import('../src/main/dictation-controller').WorkflowSettings

const keyDown = (keycode: number): void => hook.emit('keydown', { keycode })
const keyUp = (keycode: number): void => hook.emit('keyup', { keycode })

function makeHarness(mode: 'hold' | 'toggle' = 'toggle', holdDelayMs = 250) {
  const settings: WorkflowSettings = {
    recordingMode: mode,
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
    polish: false,
    vocabulary: [],
    replacements: [],
    microphoneId: 'mic-1',
    transcriptionReady: true,
    notReadyReason: null
  }

  const sendToRecorder = vi.fn()
  const broadcastStatus = vi.fn()
  const dictation = new DictationController({
    sendToRecorder,
    getSettings: () => settings,
    transcribe: async () => 'Hello world.',
    writeClipboard: vi.fn(),
    snapshotClipboard: vi.fn(),
    restoreClipboard: vi.fn(),
    paste: vi.fn(),
    playSound: vi.fn(),
    broadcastStatus,
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
    onArm: () => dictation.prepareDictation(),
    onDisarm: () => dictation.abandonPreparation(),
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

  /** The request ids sent on one recorder channel, in order. */
  const sentIds = (channel: string): string[] =>
    sendToRecorder.mock.calls
      .filter(([sent]) => sent === channel)
      .map(([, payload]) => (payload as { requestId: string }).requestId)

  /** Every phase shown to the user, in order. */
  const phases = (): string[] =>
    broadcastStatus.mock.calls.map(([status]) => (status as { phase: string }).phase)

  return {
    dictation,
    shortcut,
    settings,
    tapChord,
    pressWithExtraKey,
    startRecorder,
    stopped,
    sentIds,
    phases
  }
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

describe('listening from the keypress, across the real shortcut backend', () => {
  it('holding to talk: the microphone opens once the chord has been held a moment, and nothing shows until the delay has passed', () => {
    const { startRecorder, stopped, sentIds, phases } = makeHarness('hold')
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    vi.advanceTimersByTime(ARM_INTENT_MS - 1)
    expect(sentIds('recorder:start')).toEqual([])
    vi.advanceTimersByTime(1)
    expect(sentIds('recorder:start')).toHaveLength(1)
    expect(phases()).toEqual([])

    // The device is live well inside the hold delay.
    vi.advanceTimersByTime(50)
    startRecorder()
    expect(phases()).toEqual([])

    // Held: the take that has been listening since is the dictation.
    vi.advanceTimersByTime(250 - ARM_INTENT_MS - 50)
    expect(phases()).toEqual(['recording'])
    expect(sentIds('recorder:start')).toHaveLength(1)

    keyUp(KEY.Shift)
    keyUp(KEY.Ctrl)
    expect(stopped()).toBe(true)
    expect(sentIds('recorder:cancel')).toEqual([])
  })

  it('holding to talk: Ctrl + Shift + T within 100 ms opens nothing', () => {
    const { dictation, pressWithExtraKey, sentIds, phases } = makeHarness('hold')
    // The third key arrives 40 ms in, as it does when a shortcut is typed.
    pressWithExtraKey()
    expect(sentIds('recorder:start')).toEqual([])
    expect(sentIds('recorder:cancel')).toEqual([])
    expect(phases()).toEqual([])
    expect(dictation.getStatus().phase).toBe('idle')
  })

  it('holding to talk: Ctrl + Shift + T after 150 ms opens and closes the microphone unseen', () => {
    const { dictation, sentIds, phases } = makeHarness('hold')
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    vi.advanceTimersByTime(150)
    keyDown(KEY.T)
    keyUp(KEY.T)
    keyUp(KEY.Shift)
    keyUp(KEY.Ctrl)
    vi.advanceTimersByTime(3000)

    const opened = sentIds('recorder:start')
    expect(opened).toHaveLength(1)
    expect(sentIds('recorder:cancel')).toEqual(opened)
    expect(phases()).toEqual([])
    expect(dictation.getStatus().phase).toBe('idle')
  })

  it('holding to talk: a quick tap opens nothing, and one let go after the moment closes unseen', () => {
    const quick = makeHarness('hold')
    quick.tapChord(80)
    vi.advanceTimersByTime(3000)
    expect(quick.sentIds('recorder:start')).toEqual([])
    expect(quick.phases()).toEqual([])
    expect(quick.dictation.getStatus().phase).toBe('idle')

    hook.listeners.clear()
    const slower = makeHarness('hold')
    slower.tapChord(150)
    vi.advanceTimersByTime(3000)
    expect(slower.sentIds('recorder:start')).toHaveLength(1)
    expect(slower.sentIds('recorder:cancel')).toEqual(slower.sentIds('recorder:start'))
    expect(slower.phases()).toEqual([])
    expect(slower.dictation.getStatus().phase).toBe('idle')
  })

  it('toggle: a quick tap starts an ordinary take, and the stop tap opens nothing', () => {
    const { dictation, tapChord, startRecorder, stopped, sentIds, phases } = makeHarness('toggle')
    tapChord(80)
    expect(phases()).toEqual(['starting'])
    expect(sentIds('recorder:start')).toHaveLength(1)
    startRecorder()
    expect(dictation.getStatus().phase).toBe('recording')

    tapChord(80)
    expect(sentIds('recorder:start')).toHaveLength(1)
    expect(sentIds('recorder:cancel')).toEqual([])
    expect(stopped()).toBe(true)
  })

  it('toggle: a tap held past the moment starts the take that is already listening', () => {
    const { dictation, tapChord, startRecorder, stopped, sentIds, phases } = makeHarness('toggle')
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    vi.advanceTimersByTime(ARM_INTENT_MS)
    // Open, and unseen.
    expect(sentIds('recorder:start')).toHaveLength(1)
    expect(phases()).toEqual([])
    startRecorder()
    vi.advanceTimersByTime(50)
    keyUp(KEY.Shift)
    keyUp(KEY.Ctrl)
    // The tap confirms it: straight to recording, with no second microphone.
    expect(phases()).toEqual(['recording'])
    expect(sentIds('recorder:start')).toHaveLength(1)
    expect(dictation.getStatus().phase).toBe('recording')

    // The stop tap still only stops.
    tapChord(80)
    expect(sentIds('recorder:start')).toHaveLength(1)
    expect(sentIds('recorder:cancel')).toEqual([])
    expect(stopped()).toBe(true)
  })

  it('toggle: a stop press that becomes another shortcut leaves the recording alone', () => {
    const { dictation, tapChord, pressWithExtraKey, startRecorder, stopped, sentIds } =
      makeHarness('toggle')
    tapChord(80)
    startRecorder()

    // Typed at speed: nothing is even announced.
    pressWithExtraKey()
    expect(dictation.getStatus().phase).toBe('recording')

    // After a pause: announced, turned away because a take is running, and
    // then disarmed with nothing to close.
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    vi.advanceTimersByTime(150)
    keyDown(KEY.T)
    keyUp(KEY.T)
    keyUp(KEY.Shift)
    keyUp(KEY.Ctrl)
    vi.advanceTimersByTime(400)

    expect(dictation.getStatus().phase).toBe('recording')
    expect(sentIds('recorder:start')).toHaveLength(1)
    expect(sentIds('recorder:cancel')).toEqual([])
    expect(stopped()).toBe(false)
  })

  it('with the setting off, nothing opens until the hold delay has passed', () => {
    const { settings, sentIds, phases } = makeHarness('hold')
    settings.instantCapture = false
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    vi.advanceTimersByTime(249)
    expect(sentIds('recorder:start')).toEqual([])

    vi.advanceTimersByTime(1)
    expect(sentIds('recorder:start')).toHaveLength(1)
    expect(phases()).toEqual(['starting'])
  })

  it('with no hold delay, the take simply starts as the keys go down', () => {
    const { sentIds, phases } = makeHarness('hold', 0)
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    expect(sentIds('recorder:start')).toHaveLength(1)
    expect(phases()).toEqual(['starting'])
    keyUp(KEY.Shift)
    expect(sentIds('recorder:cancel')).toEqual([])
  })
})
