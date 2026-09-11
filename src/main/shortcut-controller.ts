import { uIOhook } from 'uiohook-napi'
import { chordIsSatisfied, type ShortcutChord } from '../shared/shortcuts'
import { MAX_CHORD_KEYS } from '../shared/shortcuts'
import { sortChordKeys } from '../shared/keycodes'
import type { ShortcutBackend, ShortcutBackendOptions } from './platform/types'

export type ShortcutControllerOptions = ShortcutBackendOptions

/** How long synthetic keystrokes are ignored after the app injects any. */
export const SYNTHETIC_ECHO_MS = 180

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
export class ShortcutController implements ShortcutBackend {
  /** libuiohook reports key-up, so hold-to-talk is genuinely supported. */
  readonly supportsHold = true
  readonly supportsCapture = true
  private pressed = new Set<number>()
  private chord: ShortcutChord
  private holdDelayMs: number
  private armTimer: NodeJS.Timeout | null = null
  private active = false
  private running = false
  private enabled = true
  private capturing = false
  private captureKeys: number[] = []
  private echoUntil = 0
  private startError: string | null = null
  private tapToFire = false

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
      this.startError = null
    } catch {
      uIOhook.off('keydown', this.handleKeyDown)
      uIOhook.off('keyup', this.handleKeyUp)
      // Recorded as well as reported: the capability snapshot has to be able
      // to tell the user the shortcut is not in force, long after the toast.
      this.startError =
        'The global keyboard hook could not start, so the shortcut is not active. ' +
        'Use the Record button, or restart the app to try again.'
      this.options.onError('The global shortcut could not start. Restart the app and try again.')
    }
  }

  registrationError(): string | null {
    return this.startError
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

  /**
   * Whether a chord let go before the hold delay still counts as a press.
   *
   * Toggle recording needs this. The gesture that stops a dictation is a tap,
   * and nobody holds a shortcut for a quarter of a second to stop something —
   * so without it the second press is swallowed and recording never ends.
   *
   * The delay's real protection is untouched: a key pressed outside the chord
   * still cancels the arm, so Ctrl+Shift+T never fires a Ctrl+Shift chord.
   * Hold-to-talk leaves this off, where a tap should record nothing at all.
   */
  setTapToFire(enabled: boolean): void {
    this.tapToFire = enabled
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
    // While capturing, every recorded key is still physically held — any
    // earlier release would have committed the capture. Seed `pressed` from
    // them so a key held across the cancel cannot auto-repeat its way into
    // triggering a chord the user never intended.
    this.pressed = new Set(this.captureKeys)
    this.capturing = false
    this.captureKeys = []
  }

  isCapturing(): boolean {
    return this.capturing
  }

  /**
   * Ignores keyboard input for a moment. The hook sees the app's own injected
   * keystrokes, so they must not re-trigger a user chord that happens to share
   * a modifier with the paste chord. Call this immediately before injecting.
   */
  suppressSyntheticInput(milliseconds: number = SYNTHETIC_ECHO_MS): void {
    this.echoUntil = Date.now() + milliseconds
    this.pressed.clear()
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
    if (Date.now() < this.echoUntil) return

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
    if (Date.now() < this.echoUntil) return

    if (this.capturing) {
      if (this.captureKeys.length) {
        const keys = [...this.captureKeys]
        this.capturing = false
        this.captureKeys = []
        // Keys still physically held must stay tracked, or their auto-repeat
        // keydowns could later satisfy the chord spuriously.
        this.pressed = new Set(keys.filter((key) => key !== event.keycode))
        this.options.onCapture(keys, true)
      }
      return
    }

    this.pressed.delete(event.keycode)

    if (this.chord.keys.includes(event.keycode)) {
      const armed = this.armTimer !== null
      this.cancelArm()
      // A tap: the chord matched and was released before the hold delay, with
      // no foreign key in between. It fires here instead of being lost. There
      // is no matching release — nothing is held any more — which is why this
      // only ever runs for toggle recording, where releases are ignored.
      if (armed && this.tapToFire && !this.active) {
        this.options.onPress()
        return
      }
    }

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
