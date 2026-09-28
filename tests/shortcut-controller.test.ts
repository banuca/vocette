import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * uiohook-napi is a native module and installing a real global hook in a test
 * would be a bad idea, so the emitter is faked. `keyTap` is asserted on
 * directly by the paste-echo test.
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

const keyDown = (keycode: number): void => hook.emit('keydown', { keycode })
const keyUp = (keycode: number): void => hook.emit('keyup', { keycode })

function makeController(
  overrides: { holdDelayMs?: number; keys?: number[]; tapToFire?: boolean } = {}
) {
  const onPress = vi.fn()
  const onRelease = vi.fn()
  const onCapture = vi.fn()
  const onArm = vi.fn()
  const onDisarm = vi.fn()
  const onEscape = vi.fn()
  const controller = new ShortcutController({
    chord: { keys: overrides.keys ?? [KEY.Ctrl, KEY.Shift] },
    holdDelayMs: overrides.holdDelayMs ?? 250,
    onPress,
    onRelease,
    onArm,
    onDisarm,
    onEscape,
    onError: vi.fn(),
    onCapture
  })
  controller.start()
  if (overrides.tapToFire) controller.setTapToFire(true)
  return { controller, onPress, onRelease, onCapture, onArm, onDisarm, onEscape }
}

beforeEach(() => {
  vi.useFakeTimers()
  hook.listeners.clear()
  hook.keyTap.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('hold delay', () => {
  it('starts dictation once the chord is held long enough', () => {
    const { onPress } = makeController()
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    expect(onPress).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire for Ctrl + Shift + T', () => {
    // The regression that makes a modifier-only default usable: the letter
    // arrives well inside the hold window and cancels the arm.
    const { onPress } = makeController()
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    vi.advanceTimersByTime(60)
    keyDown(KEY.T)
    vi.advanceTimersByTime(1000)
    expect(onPress).not.toHaveBeenCalled()
  })

  it('does not fire when the chord is released early', () => {
    const { onPress, onRelease } = makeController()
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    vi.advanceTimersByTime(100)
    keyUp(KEY.Shift)
    vi.advanceTimersByTime(1000)
    expect(onPress).not.toHaveBeenCalled()
    expect(onRelease).not.toHaveBeenCalled()
  })

  it('releases when a chord key goes up after activating', () => {
    const { onPress, onRelease } = makeController()
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    vi.advanceTimersByTime(250)
    expect(onPress).toHaveBeenCalledTimes(1)
    keyUp(KEY.Shift)
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('fires immediately when the delay is zero', () => {
    const { onPress } = makeController({ holdDelayMs: 0 })
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('ignores auto-repeat while active', () => {
    const { onPress } = makeController({ holdDelayMs: 0 })
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    keyDown(KEY.Shift)
    keyDown(KEY.Shift)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('ignores AltGr plus Space for a Ctrl + Space chord', () => {
    const { onPress } = makeController({ keys: [KEY.Ctrl, KEY.Space], holdDelayMs: 0 })
    keyDown(KEY.Ctrl) // phantom Left Ctrl injected by AltGr
    keyDown(KEY.AltRight)
    keyDown(KEY.Space)
    vi.advanceTimersByTime(1000)
    expect(onPress).not.toHaveBeenCalled()
  })
})

describe('synthetic input suppression', () => {
  it('ignores the keystrokes the app injects on its own behalf', () => {
    // Injection itself belongs to the platform layer now; what has to happen
    // here is that the hook stops listening for a moment first, or our own
    // Ctrl+V would arm a user chord that also uses Ctrl.
    const { controller, onPress } = makeController({ keys: [KEY.Ctrl, KEY.Space], holdDelayMs: 0 })
    controller.suppressSyntheticInput()
    keyDown(KEY.Ctrl)
    keyDown(KEY.Space)
    expect(onPress).not.toHaveBeenCalled()
  })

  it('starts listening again once the window has passed', () => {
    const { controller, onPress } = makeController({ keys: [KEY.Ctrl, KEY.Space], holdDelayMs: 0 })
    controller.suppressSyntheticInput(10)
    vi.advanceTimersByTime(11)
    keyDown(KEY.Ctrl)
    keyDown(KEY.Space)
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})

describe('capture mode', () => {
  it('streams the chord and commits on release without triggering dictation', () => {
    const { controller, onCapture, onPress } = makeController({ holdDelayMs: 0 })
    controller.beginCapture()
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    expect(onCapture).toHaveBeenLastCalledWith([KEY.Ctrl, KEY.Shift], false)
    keyUp(KEY.Shift)
    expect(onCapture).toHaveBeenLastCalledWith([KEY.Ctrl, KEY.Shift], true)
    expect(onPress).not.toHaveBeenCalled()
    expect(controller.isCapturing()).toBe(false)
  })

  it('caps a captured chord at four keys', () => {
    const { controller, onCapture } = makeController()
    controller.beginCapture()
    keyDown(KEY.Ctrl)
    keyDown(KEY.Alt)
    keyDown(KEY.Shift)
    keyDown(KEY.Meta)
    keyDown(KEY.Space)
    const lastCall = onCapture.mock.calls.at(-1)
    expect(lastCall?.[0]).toHaveLength(4)
  })

  it('tracks keys still held after a capture commit', () => {
    // Regression: capture committed on the first keyup, but keys still held
    // were left untracked. Their auto-repeat keydowns then satisfied the chord
    // on their own, starting a dictation nobody asked for.
    const { controller, onPress } = makeController({ holdDelayMs: 0 })
    controller.beginCapture()
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    keyUp(KEY.Shift) // commit: Ctrl is still physically held
    expect(controller.isCapturing()).toBe(false)

    // The held Ctrl keeps auto-repeating; the repeats must not arm the chord.
    keyDown(KEY.Ctrl)
    keyDown(KEY.Ctrl)
    expect(onPress).not.toHaveBeenCalled()

    // A deliberate chord press from here behaves normally.
    keyUp(KEY.Ctrl)
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('seeds held keys when a capture is cancelled', () => {
    const { controller, onPress } = makeController({ holdDelayMs: 0 })
    controller.beginCapture()
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    controller.cancelCapture()

    // Both keys are still held: repeats must not trigger the chord.
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    expect(onPress).not.toHaveBeenCalled()

    // Releasing one and pressing it again is a fresh, deliberate chord.
    keyUp(KEY.Shift)
    keyDown(KEY.Shift)
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})

describe('enable and reset', () => {
  it('does nothing while disabled', () => {
    const { controller, onPress } = makeController({ holdDelayMs: 0 })
    controller.setEnabled(false)
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    expect(onPress).not.toHaveBeenCalled()
  })

  it('releases an active chord when key state is reset after a missed keyup', () => {
    const { controller, onPress, onRelease } = makeController({ holdDelayMs: 0 })
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    expect(onPress).toHaveBeenCalledTimes(1)
    controller.resetKeyState()
    expect(onRelease).toHaveBeenCalledTimes(1)
    // And the stale keys are gone, so the next press works normally.
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    expect(onPress).toHaveBeenCalledTimes(2)
  })
})

describe('arming, so listening can start before the hold delay has passed', () => {
  /** Holds the default chord down without letting go. */
  const holdChord = (): void => {
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
  }
  const letGo = (): void => {
    keyUp(KEY.Shift)
    keyUp(KEY.Ctrl)
  }
  /** Every way the controller can be reset while a chord is armed. */
  const resets: Array<(controller: InstanceType<typeof ShortcutController>) => void> = [
    (controller) => controller.resetKeyState(),
    (controller) => controller.setEnabled(false),
    (controller) => controller.setChord({ keys: [KEY.Ctrl, KEY.Space] }),
    (controller) => controller.setHoldDelay(400),
    (controller) => controller.beginCapture(),
    (controller) => controller.stop()
  ]

  it('arms once the chord has been held alone for a moment, and the arm ends in the press', () => {
    const { onArm, onDisarm, onPress, onRelease } = makeController()
    keyDown(KEY.Ctrl)
    // Half a chord is nothing yet, however long it is held.
    vi.advanceTimersByTime(ARM_INTENT_MS)
    expect(onArm).not.toHaveBeenCalled()
    keyDown(KEY.Shift)
    // The whole chord, but not yet for long enough to mean anything.
    vi.advanceTimersByTime(ARM_INTENT_MS - 1)
    expect(onArm).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onArm).toHaveBeenCalledTimes(1)
    expect(onPress).not.toHaveBeenCalled()

    // The hold delay still counts from when the chord went down.
    vi.advanceTimersByTime(250 - ARM_INTENT_MS)
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(onArm.mock.invocationCallOrder[0]).toBeLessThan(
      onPress.mock.invocationCallOrder[0] ?? 0
    )

    // An activation and then a release: never a disarm.
    keyUp(KEY.Shift)
    expect(onRelease).toHaveBeenCalledTimes(1)
    keyUp(KEY.Ctrl)
    vi.advanceTimersByTime(1000)
    expect(onDisarm).not.toHaveBeenCalled()
    expect(onArm).toHaveBeenCalledTimes(1)
  })

  it('does not arm when the delay is zero, because the take starts at once', () => {
    const { onArm, onDisarm, onPress } = makeController({ holdDelayMs: 0 })
    holdChord()
    expect(onPress).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    letGo()
    expect(onArm).not.toHaveBeenCalled()
    expect(onDisarm).not.toHaveBeenCalled()
  })

  it('never announces an arm when the hold delay is no longer than that moment', () => {
    const { onArm, onDisarm, onPress, onRelease } = makeController({ holdDelayMs: ARM_INTENT_MS })
    holdChord()
    vi.advanceTimersByTime(ARM_INTENT_MS - 1)
    expect(onPress).not.toHaveBeenCalled()
    // The take starts when an announcement would have come, so none does.
    vi.advanceTimersByTime(1)
    expect(onPress).toHaveBeenCalledTimes(1)
    letGo()
    expect(onRelease).toHaveBeenCalledTimes(1)

    // Another shortcut inside that delay announces nothing either.
    holdChord()
    vi.advanceTimersByTime(50)
    keyDown(KEY.T)
    keyUp(KEY.T)
    letGo()
    vi.advanceTimersByTime(1000)
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(onArm).not.toHaveBeenCalled()
    expect(onDisarm).not.toHaveBeenCalled()
  })

  it('opens nothing for another shortcut typed at speed: neither an arm nor a disarm', () => {
    const { onArm, onDisarm, onPress } = makeController()
    holdChord()
    vi.advanceTimersByTime(ARM_INTENT_MS - 1)
    keyDown(KEY.T)
    keyUp(KEY.T)
    letGo()
    vi.advanceTimersByTime(1000)
    expect(onArm).not.toHaveBeenCalled()
    expect(onDisarm).not.toHaveBeenCalled()
    expect(onPress).not.toHaveBeenCalled()
  })

  it('opens nothing for a held-to-talk chord let go within the moment', () => {
    const { onArm, onDisarm, onPress, onRelease } = makeController()
    holdChord()
    vi.advanceTimersByTime(ARM_INTENT_MS - 1)
    letGo()
    vi.advanceTimersByTime(1000)
    expect(onArm).not.toHaveBeenCalled()
    expect(onDisarm).not.toHaveBeenCalled()
    expect(onPress).not.toHaveBeenCalled()
    expect(onRelease).not.toHaveBeenCalled()
  })

  it('disarms on a key outside the chord once the arm was announced: Ctrl + Shift, a pause, then T', () => {
    const { onArm, onDisarm, onPress } = makeController()
    holdChord()
    vi.advanceTimersByTime(150)
    expect(onArm).toHaveBeenCalledTimes(1)
    keyDown(KEY.T)
    expect(onDisarm).toHaveBeenCalledTimes(1)

    keyUp(KEY.T)
    letGo()
    vi.advanceTimersByTime(1000)
    expect(onPress).not.toHaveBeenCalled()
    // Once, and not again as the keys come up.
    expect(onArm).toHaveBeenCalledTimes(1)
    expect(onDisarm).toHaveBeenCalledTimes(1)
  })

  it('disarms on a modifier outside the chord, which breaks it', () => {
    const { onDisarm, onPress } = makeController()
    holdChord()
    vi.advanceTimersByTime(ARM_INTENT_MS)
    keyDown(KEY.Alt)
    expect(onDisarm).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(onPress).not.toHaveBeenCalled()
  })

  it('disarms when a held-to-talk chord is let go after the moment but before the delay', () => {
    const { onDisarm, onPress, onRelease } = makeController()
    holdChord()
    vi.advanceTimersByTime(ARM_INTENT_MS + 50)
    keyUp(KEY.Shift)
    expect(onDisarm).toHaveBeenCalledTimes(1)
    keyUp(KEY.Ctrl)
    vi.advanceTimersByTime(1000)
    expect(onPress).not.toHaveBeenCalled()
    expect(onRelease).not.toHaveBeenCalled()
    expect(onDisarm).toHaveBeenCalledTimes(1)
  })

  it('treats a toggle tap within the moment as a press and nothing else', () => {
    const { onArm, onDisarm, onPress } = makeController({ tapToFire: true })
    holdChord()
    vi.advanceTimersByTime(ARM_INTENT_MS - 1)
    letGo()
    vi.advanceTimersByTime(1000)
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(onArm).not.toHaveBeenCalled()
    expect(onDisarm).not.toHaveBeenCalled()
  })

  it('treats a toggle tap after the announcement as a press, not a disarm', () => {
    const { onArm, onDisarm, onPress } = makeController({ tapToFire: true })
    holdChord()
    vi.advanceTimersByTime(ARM_INTENT_MS + 50)
    expect(onArm).toHaveBeenCalledTimes(1)
    letGo()
    vi.advanceTimersByTime(1000)
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(onDisarm).not.toHaveBeenCalled()
    expect(onArm).toHaveBeenCalledTimes(1)
  })

  it('still disarms an announced toggle press that turns out to be another shortcut', () => {
    const { onDisarm, onPress } = makeController({ tapToFire: true })
    holdChord()
    vi.advanceTimersByTime(ARM_INTENT_MS)
    keyDown(KEY.T)
    keyUp(KEY.T)
    letGo()
    vi.advanceTimersByTime(1000)
    expect(onDisarm).toHaveBeenCalledTimes(1)
    expect(onPress).not.toHaveBeenCalled()
  })

  it('disarms an announced arm on every reset: key state, switching off, a new chord or delay, a capture, stopping', () => {
    for (const reset of resets) {
      hook.listeners.clear()
      const { controller, onArm, onDisarm, onPress } = makeController()
      holdChord()
      vi.advanceTimersByTime(ARM_INTENT_MS)
      expect(onArm).toHaveBeenCalledTimes(1)
      reset(controller)
      expect(onDisarm).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(1000)
      expect(onPress).not.toHaveBeenCalled()
      expect(onDisarm).toHaveBeenCalledTimes(1)
    }
  })

  it('announces nothing at all when a reset comes within the moment', () => {
    for (const reset of resets) {
      hook.listeners.clear()
      const { controller, onArm, onDisarm, onPress } = makeController()
      holdChord()
      vi.advanceTimersByTime(ARM_INTENT_MS - 1)
      reset(controller)
      vi.advanceTimersByTime(1000)
      expect(onArm).not.toHaveBeenCalled()
      expect(onDisarm).not.toHaveBeenCalled()
      expect(onPress).not.toHaveBeenCalled()
    }
  })

  it('says nothing about a disarm when nothing was armed', () => {
    const { controller, onDisarm } = makeController()
    keyDown(KEY.Ctrl)
    keyDown(KEY.T)
    keyUp(KEY.T)
    keyUp(KEY.Ctrl)
    controller.resetKeyState()
    controller.setHoldDelay(400)
    controller.setEnabled(false)
    controller.setEnabled(true)
    controller.beginCapture()
    controller.cancelCapture()
    expect(onDisarm).not.toHaveBeenCalled()
  })

  it('never arms while the chord is active, held to talk or held to toggle', () => {
    for (const tapToFire of [false, true]) {
      hook.listeners.clear()
      const { onArm, onDisarm, onPress } = makeController({ tapToFire })
      holdChord()
      vi.advanceTimersByTime(250)
      expect(onPress).toHaveBeenCalledTimes(1)

      // Auto-repeat, another key, even the rest of a longer shortcut: while
      // the chord is active none of it arms or disarms anything.
      keyDown(KEY.Shift)
      keyDown(KEY.Alt)
      keyUp(KEY.Alt)
      keyDown(KEY.T)
      keyUp(KEY.T)
      vi.advanceTimersByTime(1000)
      expect(onArm).toHaveBeenCalledTimes(1)
      expect(onDisarm).not.toHaveBeenCalled()
      letGo()
    }
  })

  it('arms afresh for every press, and every announced arm ends exactly once', () => {
    const { onArm, onDisarm, onPress } = makeController()
    // Another shortcut typed at speed: nothing announced, so nothing to end.
    holdChord()
    keyDown(KEY.T)
    keyUp(KEY.T)
    letGo()
    // Another shortcut after a pause: announced, then disarmed.
    holdChord()
    vi.advanceTimersByTime(ARM_INTENT_MS + 50)
    keyDown(KEY.T)
    keyUp(KEY.T)
    letGo()
    // Let go too soon, but after the announcement: announced, then disarmed.
    holdChord()
    vi.advanceTimersByTime(ARM_INTENT_MS + 50)
    letGo()
    // Held: announced, then pressed.
    holdChord()
    vi.advanceTimersByTime(250)
    letGo()
    vi.advanceTimersByTime(1000)
    expect(onArm).toHaveBeenCalledTimes(3)
    expect(onDisarm).toHaveBeenCalledTimes(2)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('never announces an arm whose chord the app forgot while pasting', () => {
    // An injected paste clears the tracked keys before the moment has passed,
    // so there is no chord left to open the microphone for.
    const { controller, onArm, onDisarm, onPress } = makeController()
    holdChord()
    controller.suppressSyntheticInput(10)
    vi.advanceTimersByTime(250)
    expect(onArm).not.toHaveBeenCalled()
    expect(onPress).not.toHaveBeenCalled()
    expect(onDisarm).not.toHaveBeenCalled()
  })

  it('disarms when the delay runs out on a chord the app forgot after announcing it', () => {
    // The paste clears the tracked keys after the arm was announced: the delay
    // then finds no chord, and what the arm opened has to be let go.
    const { controller, onArm, onDisarm, onPress } = makeController()
    holdChord()
    vi.advanceTimersByTime(ARM_INTENT_MS + 50)
    expect(onArm).toHaveBeenCalledTimes(1)
    controller.suppressSyntheticInput(10)
    vi.advanceTimersByTime(250)
    expect(onPress).not.toHaveBeenCalled()
    expect(onDisarm).toHaveBeenCalledTimes(1)
  })

  it('is armed before it says so, so a reset from inside the listener disarms it', () => {
    const { controller, onArm, onDisarm, onPress } = makeController()
    onArm.mockImplementation(() => controller.resetKeyState())
    holdChord()
    vi.advanceTimersByTime(ARM_INTENT_MS)
    expect(onArm).toHaveBeenCalledTimes(1)
    expect(onDisarm).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(onPress).not.toHaveBeenCalled()
  })
})

describe('Esc', () => {
  it('reports Esc pressed on its own, once per press', () => {
    const { controller, onEscape } = makeController()
    expect(controller.supportsEscape).toBe(true)
    keyDown(KEY.Escape)
    // Auto-repeat while it is held is the same press.
    keyDown(KEY.Escape)
    keyDown(KEY.Escape)
    expect(onEscape).toHaveBeenCalledTimes(1)
    keyUp(KEY.Escape)
    keyDown(KEY.Escape)
    expect(onEscape).toHaveBeenCalledTimes(2)
  })

  it('leaves Esc with a modifier to the shortcut it belongs to', () => {
    const { onEscape } = makeController({ keys: [KEY.Ctrl, KEY.Space] })
    // Ctrl + Shift + Esc is Task Manager; Alt + Esc switches windows.
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    keyDown(KEY.Escape)
    keyUp(KEY.Escape)
    keyUp(KEY.Shift)
    keyUp(KEY.Ctrl)
    keyDown(KEY.Alt)
    keyDown(KEY.Escape)
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('counts Esc as alone while a key that is not a modifier is held', () => {
    const { onEscape } = makeController()
    keyDown(KEY.A)
    keyDown(KEY.Escape)
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('is not reported while a shortcut is being recorded, or with the shortcut off', () => {
    const { controller, onEscape, onCapture } = makeController()
    controller.beginCapture()
    keyDown(KEY.Escape)
    expect(onEscape).not.toHaveBeenCalled()
    // Recorded as part of the new chord instead, as any key is.
    expect(onCapture).toHaveBeenLastCalledWith([KEY.Escape], false)
    controller.cancelCapture()
    keyUp(KEY.Escape)

    controller.setEnabled(false)
    keyDown(KEY.Escape)
    expect(onEscape).not.toHaveBeenCalled()
  })

  it("ignores the app's own injected keystrokes", () => {
    const { controller, onEscape } = makeController()
    controller.suppressSyntheticInput(180)
    keyDown(KEY.Escape)
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('still ends a pending arm, as any key outside the chord does', () => {
    const { onEscape, onArm, onDisarm, onPress } = makeController()
    keyDown(KEY.Ctrl)
    keyDown(KEY.Shift)
    vi.advanceTimersByTime(ARM_INTENT_MS)
    expect(onArm).toHaveBeenCalledTimes(1)
    // With the chord's modifiers held this is not Esc alone, and it is a key
    // outside the chord: the arm ends and nothing records.
    keyDown(KEY.Escape)
    expect(onEscape).not.toHaveBeenCalled()
    expect(onDisarm).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(onPress).not.toHaveBeenCalled()
  })

  it('reports Esc and ends the arm when the chord has no modifier', () => {
    const { onEscape, onArm, onDisarm, onPress } = makeController({ keys: [KEY.F9] })
    keyDown(KEY.F9)
    vi.advanceTimersByTime(ARM_INTENT_MS)
    expect(onArm).toHaveBeenCalledTimes(1)
    keyDown(KEY.Escape)
    expect(onEscape).toHaveBeenCalledTimes(1)
    expect(onDisarm).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(onPress).not.toHaveBeenCalled()
  })
})
