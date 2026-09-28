import { uIOhook } from 'uiohook-napi'
import { chordIsSatisfied, type ShortcutChord } from '../shared/shortcuts'
import { MAX_CHORD_KEYS } from '../shared/shortcuts'
import { isModifier, KEY, sortChordKeys } from '../shared/keycodes'
import type { ShortcutBackend, ShortcutBackendOptions } from './platform/types'

export type ShortcutControllerOptions = ShortcutBackendOptions

/** How long synthetic keystrokes are ignored after the app injects any. */
export const SYNTHETIC_ECHO_MS = 180

/**
 * How long a chord must be held on its own before the microphone is opened
 * for it. Most presses of a longer shortcut that starts with the chord —
 * Ctrl + Shift + T, Ctrl + Shift + P — bring the third key within this, and
 * then the microphone never opens at all: no indicator flash in the taskbar,
 * and no Bluetooth headset dropped to call quality for a keyboard shortcut.
 * Nobody starts speaking this quickly, so nothing worth keeping is lost.
 */
export const ARM_INTENT_MS = 100

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
 *
 * While the delay runs the chord is armed. Once it has been held alone for
 * `ARM_INTENT_MS`, `onArm` lets the microphone open, so the first word is
 * not lost. Whatever cancels an announced arm calls `onDisarm`, so audio
 * captured for some other shortcut is thrown away unheard.
 */
export class ShortcutController implements ShortcutBackend {
  /** libuiohook reports key-up, so hold-to-talk is genuinely supported. */
  readonly supportsHold = true
  readonly supportsCapture = true
  readonly supportsEscape = true
  private pressed = new Set<number>()
  private chord: ShortcutChord
  private holdDelayMs: number
  private armTimer: NodeJS.Timeout | null = null
  /** Fires `onArm` once the chord has been held alone for `ARM_INTENT_MS`. */
  private intentTimer: NodeJS.Timeout | null = null
  /** True once `onArm` has been called for the current arm. */
  private armAnnounced = false
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
    this.disarm()
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
    this.disarm()
    if (releaseIfActive && this.active) this.options.onRelease()
    this.active = false
    this.pressed.clear()
  }

  /**
   * Cancels a pending arm, and says so. The dictation controller may already
   * have opened the microphone for it, and has to throw that audio away.
   * Nothing is said when nothing was announced.
   */
  private disarm(): void {
    if (!this.armTimer) return
    clearTimeout(this.armTimer)
    this.armTimer = null
    // Only an arm that was announced opened anything to let go of.
    if (this.endArmAnnouncement()) this.options.onDisarm?.()
  }

  /**
   * Stops a pending announcement and reports whether one had been made.
   * Every way an arm ends goes through here, so the two timers never drift
   * apart.
   */
  private endArmAnnouncement(): boolean {
    if (this.intentTimer) clearTimeout(this.intentTimer)
    this.intentTimer = null
    const announced = this.armAnnounced
    this.armAnnounced = false
    return announced
  }

  /** The hold delay has run out on an armed chord. */
  private readonly holdDelayElapsed = (): void => {
    this.armTimer = null
    const announced = this.endArmAnnouncement()
    // Re-check: keys may have been released during the delay, or forgotten
    // when the app injected its own paste.
    if (this.enabled && !this.active && chordIsSatisfied(this.pressed, this.chord.keys)) {
      this.activate()
      return
    }
    // The arm ends without activating, so whatever it opened must be let go.
    if (announced) this.options.onDisarm?.()
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
    // Esc counts only on its own. With a modifier it is some other shortcut —
    // Ctrl + Shift + Esc is Task Manager, Alt + Esc switches windows — so it
    // is checked before this key joins the ones held.
    const escapeAlone = event.keycode === KEY.Escape && ![...this.pressed].some(isModifier)
    this.pressed.add(event.keycode)
    if (repeated) return

    // Reported before anything else is decided, and without stopping it: the
    // Esc is still a key outside the chord, so it ends a pending arm below.
    if (escapeAlone) this.options.onEscape?.()

    if (this.active) {
      // Already dictating; nothing else to decide. This is also why a chord
      // is never armed while active.
      return
    }

    // A key outside the chord means this is a different shortcut, not ours.
    if (!this.chord.keys.includes(event.keycode)) {
      this.disarm()
      return
    }

    if (!chordIsSatisfied(this.pressed, this.chord.keys)) {
      this.disarm()
      return
    }

    // Nothing to arm: the take starts now, which already catches the first word.
    if (this.holdDelayMs <= 0) {
      this.activate()
      return
    }

    this.disarm()
    this.armTimer = setTimeout(this.holdDelayElapsed, this.holdDelayMs)
    // Announced only once the chord has been held alone for a moment, and
    // not at all when the hold delay is that short anyway.
    if (this.holdDelayMs > ARM_INTENT_MS) {
      this.intentTimer = setTimeout(() => {
        this.intentTimer = null
        // Re-checked: the app's own paste may have cleared the tracked keys.
        if (!this.armTimer || this.active || !chordIsSatisfied(this.pressed, this.chord.keys)) return
        // Set before the call, so the arm is in force when the listener
        // opens the microphone for it.
        this.armAnnounced = true
        this.options.onArm?.()
      }, ARM_INTENT_MS)
    }
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
      // A tap: the chord matched and was released before the hold delay, with
      // no foreign key in between. It fires here instead of being lost. There
      // is no matching release — nothing is held any more — which is why this
      // only ever runs for toggle recording, where releases are ignored. The
      // arm ends in a press, so it is not a disarm.
      if (this.armTimer && this.tapToFire && !this.active) {
        clearTimeout(this.armTimer)
        this.armTimer = null
        // The tap is the press the arm was waiting for, announced or not.
        this.endArmAnnouncement()
        this.options.onPress()
        return
      }
      // Let go before the delay while holding to talk: not a dictation.
      this.disarm()
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
