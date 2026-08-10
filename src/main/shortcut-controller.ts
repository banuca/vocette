import { UiohookKey, uIOhook } from 'uiohook-napi'
import { chordIsSatisfied, type ShortcutChord } from '../shared/shortcuts'
import { MAX_CHORD_KEYS } from '../shared/shortcuts'
import { sortChordKeys } from '../shared/keycodes'

export interface ShortcutControllerOptions {
  chord: ShortcutChord
  holdDelayMs: number
  onPress: () => void
  onRelease: () => void
  onError: (message: string) => void
  /** Streams the chord being recorded by the "Change shortcut" button. */
  onCapture: (keys: number[], done: boolean) => void
}

/** How long synthetic paste keystrokes are ignored after `paste()`. */
const PASTE_ECHO_MS = 180

/**
 * Watches the global keyboard for the hold-to-talk chord.
 *
 * Two guards make arbitrary user chords safe:
 *
 * 1. Exclusivity (`chordIsSatisfied`) — a chord never fires while a modifier
 *    outside it is held. This is what stops AltGr, which Windows reports as a
 *    phantom Left Ctrl plus Right Alt, from triggering a Left Ctrl chord.
 *
 * 2. Hold delay — a chord that is a prefix of a longer shortcut (Left Ctrl +
 *    Left Shift vs Ctrl + Shift + T) must be held on its own for
 *    `holdDelayMs` before recording starts. Any other keypress in that window
 *    cancels it. Without this, a modifier-only chord fires on every
 *    Ctrl+Shift+key shortcut in the OS.
 */
export class ShortcutController {
  private readonly pressed = new Set<number>()
  private chord: ShortcutChord
  private holdDelayMs: number
  private armTimer: NodeJS.Timeout | null = null
  private active = false
  private running = false
  private enabled = true
  private capturing = false
  private captureKeys: number[] = []
  private pasteEchoUntil = 0

  constructor(private readonly options: ShortcutControllerOptions) {
    this.chord = options.chord
    this.holdDelayMs = options.holdDelayMs
  }

  start(): void {
    if (this.running) return
    // An EventEmitter with no 'error' listener throws on emit, which would take
    // the whole app down from inside the native hook. uiohook's types do not
    // declare the event, so this is attached through the emitter interface.
    ;(uIOhook as unknown as { on(event: 'error', listener: () => void): void }).on('error', () => {
      this.options.onError(
        'The keyboard hook reported an error. Restart the app if the shortcut stops working.'
      )
    })
    uIOhook.on('keydown', this.handleKeyDown)
    uIOhook.on('keyup', this.handleKeyUp)
    try {
      uIOhook.start()
      this.running = true
    } catch {
      uIOhook.off('keydown', this.handleKeyDown)
      uIOhook.off('keyup', this.handleKeyUp)
      this.options.onError('The global shortcut could not start. Restart the app and try again.')
    }
  }

  stop(): void {
    if (!this.running) return
    this.reset(true)
    uIOhook.off('keydown', this.handleKeyDown)
    uIOhook.off('keyup', this.handleKeyUp)
    try {
      uIOhook.stop()
    } catch {
      // Already torn down.
    }
    this.running = false
  }

  setChord(chord: ShortcutChord): void {
    this.reset(true)
    this.chord = chord
  }

  setHoldDelay(holdDelayMs: number): void {
    this.holdDelayMs = holdDelayMs
    this.cancelArm()
  }

  setEnabled(enabled: boolean): void {
    this.reset(true)
    this.enabled = enabled
  }

  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Clears all key state. Used when a keyup was missed — which happens
   * whenever the chord is released while an elevated window (UAC) has focus,
   * because libuiohook cannot see input there.
   */
  resetKeyState(): void {
    this.reset(true)
  }

  beginCapture(): void {
    this.reset(true)
    this.capturing = true
    this.captureKeys = []
  }

  cancelCapture(): void {
    this.capturing = false
    this.captureKeys = []
  }

  isCapturing(): boolean {
    return this.capturing
  }

  /**
   * Presses Ctrl+V in the focused app. The hook sees these synthetic events
   * too, so key state is suspended briefly to stop them re-triggering a
   * user-defined chord that happens to include Ctrl.
   */
  paste(): void {
    this.pasteEchoUntil = Date.now() + PASTE_ECHO_MS
    this.pressed.clear()
    uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl])
  }

  private reset(releaseIfActive: boolean): void {
    this.cancelArm()
    if (releaseIfActive && this.active) this.options.onRelease()
    this.active = false
    this.pressed.clear()
  }

  private cancelArm(): void {
    if (this.armTimer) {
      clearTimeout(this.armTimer)
      this.armTimer = null
    }
  }

  private handleKeyDown = (event: { keycode: number }): void => {
    if (Date.now() < this.pasteEchoUntil) return

    if (this.capturing) {
      if (
        !this.captureKeys.includes(event.keycode) &&
        this.captureKeys.length < MAX_CHORD_KEYS
      ) {
        this.captureKeys = sortChordKeys([...this.captureKeys, event.keycode])
      }
      this.options.onCapture([...this.captureKeys], false)
      return
    }

    if (!this.enabled) return

    const repeated = this.pressed.has(event.keycode)
    this.pressed.add(event.keycode)
    if (repeated) return

    if (this.active) {
      // Already dictating; nothing else to decide.
      return
    }

    // A key outside the chord means this is a different shortcut, not ours.
    if (!this.chord.keys.includes(event.keycode)) {
      this.cancelArm()
      return
    }

    if (!chordIsSatisfied(this.pressed, this.chord.keys)) {
      this.cancelArm()
      return
    }

    if (this.holdDelayMs <= 0) {
      this.activate()
      return
    }

    this.cancelArm()
    this.armTimer = setTimeout(() => {
      this.armTimer = null
      // Re-check: keys may have been released during the delay.
      if (!this.enabled || this.active) return
      if (!chordIsSatisfied(this.pressed, this.chord.keys)) return
      this.activate()
    }, this.holdDelayMs)
  }

  private handleKeyUp = (event: { keycode: number }): void => {
    if (Date.now() < this.pasteEchoUntil) return

    if (this.capturing) {
      if (this.captureKeys.length) {
        const keys = [...this.captureKeys]
        this.capturing = false
        this.captureKeys = []
        this.options.onCapture(keys, true)
      }
      return
    }

    this.pressed.delete(event.keycode)

    if (this.chord.keys.includes(event.keycode)) this.cancelArm()

    if (!this.active) return
    if (this.chord.keys.includes(event.keycode)) {
      this.active = false
      this.options.onRelease()
    }
  }

  private activate(): void {
    this.active = true
    this.options.onPress()
  }
}
