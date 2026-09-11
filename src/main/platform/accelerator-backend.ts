import { acceleratorForChord } from '../../shared/accelerator'
import { chordLabel } from '../../shared/keycodes'
import type { ShortcutChord } from '../../shared/shortcuts'
import type { ShortcutBackend, ShortcutBackendOptions } from './types'

/** The slice of Electron's `globalShortcut` this backend needs. */
export interface AcceleratorApi {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
  isRegistered(accelerator: string): boolean
}

/**
 * Global shortcuts registered with the desktop rather than observed from a
 * keyboard hook. This is the only option on Wayland, where the compositor owns
 * input and no application may watch the keyboard.
 *
 * The desktop hands back a single callback when the shortcut fires. There is
 * no matching release, so `supportsHold` is false and this backend drives
 * toggle recording only. Reporting hold support here and synthesising a
 * release would produce dictations that never stop.
 */
export class AcceleratorShortcutBackend implements ShortcutBackend {
  readonly supportsHold = false
  readonly supportsCapture = false

  private chord: ShortcutChord
  private enabled = true
  private started = false
  private registered: string | null = null
  private failure: string | null = null

  constructor(
    private readonly options: ShortcutBackendOptions,
    private readonly api: AcceleratorApi
  ) {
    this.chord = options.chord
  }

  start(): void {
    this.started = true
    this.apply()
  }

  stop(): void {
    this.started = false
    this.release()
  }

  setChord(chord: ShortcutChord): void {
    this.chord = chord
    this.apply()
  }

  /** Meaningless without key-up; kept so the interface stays uniform. */
  setHoldDelay(): void {}

  /** The desktop fires once per press already; there is no tap to rescue. */
  setTapToFire(): void {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.apply()
  }

  isEnabled(): boolean {
    return this.enabled
  }

  isCapturing(): boolean {
    return false
  }

  /**
   * There is no keyboard to watch, so a chord cannot be recorded from live
   * input. The capture ends immediately with nothing, which leaves the
   * Settings page showing the shortcut unchanged instead of hanging.
   */
  beginCapture(): void {
    this.options.onCapture([], true)
  }

  cancelCapture(): void {}

  resetKeyState(): void {}

  /** Nothing is observed, so nothing has to be suppressed. */
  suppressSyntheticInput(): void {}

  registrationError(): string | null {
    return this.failure
  }

  private release(): void {
    if (!this.registered) return
    try {
      this.api.unregister(this.registered)
    } catch {
      // The desktop may have dropped it already.
    }
    this.registered = null
  }

  private apply(): void {
    this.release()
    if (!this.started || !this.enabled) {
      this.failure = null
      return
    }

    const { accelerator, error } = acceleratorForChord(this.chord.keys)
    if (!accelerator) {
      this.failure = error
      return
    }

    let ok: boolean
    try {
      ok = this.api.register(accelerator, () => this.options.onPress())
    } catch {
      ok = false
    }
    if (!ok || !this.api.isRegistered(accelerator)) {
      this.failure =
        `The desktop would not register ${chordLabel(this.chord.keys)}. ` +
        'Another application may already use it — choose a different shortcut.'
      this.registered = null
      return
    }
    this.registered = accelerator
    this.failure = null
  }
}
