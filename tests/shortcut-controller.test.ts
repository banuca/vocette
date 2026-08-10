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
const { ShortcutController } = await import('../src/main/shortcut-controller')

const keyDown = (keycode: number): void => hook.emit('keydown', { keycode })
const keyUp = (keycode: number): void => hook.emit('keyup', { keycode })

function makeController(overrides: { holdDelayMs?: number; keys?: number[] } = {}) {
  const onPress = vi.fn()
  const onRelease = vi.fn()
  const onCapture = vi.fn()
  const controller = new ShortcutController({
    chord: { keys: overrides.keys ?? [KEY.Ctrl, KEY.Shift] },
    holdDelayMs: overrides.holdDelayMs ?? 250,
    onPress,
    onRelease,
    onError: vi.fn(),
    onCapture
  })
  controller.start()
  return { controller, onPress, onRelease, onCapture }
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

describe('paste echo', () => {
  it('ignores the synthetic keystrokes it generates itself', () => {
    const { controller, onPress } = makeController({ keys: [KEY.Ctrl, KEY.Space], holdDelayMs: 0 })
    controller.paste()
    expect(hook.keyTap).toHaveBeenCalledTimes(1)
    // uiohook reports our own Ctrl+V back to us; it must not arm a Ctrl chord.
    keyDown(KEY.Ctrl)
    keyDown(KEY.Space)
    expect(onPress).not.toHaveBeenCalled()
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
