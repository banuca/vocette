import type { ForegroundState } from '../dictation-controller'
import type {
  CapabilityMap,
  LinuxSession,
  PlatformId,
  SettingsPane
} from '../../shared/capabilities'
import type { ShortcutChord } from '../../shared/shortcuts'

/**
 * The main-process boundary between Murmur and the desktop it runs on.
 *
 * Everything platform-specific lives behind this: global shortcuts, the paste
 * target, key injection, permission state, and launch-at-login. The rest of
 * the main process talks only to these interfaces, so a platform that cannot
 * do something reports it instead of the app crashing or, worse, pretending.
 *
 * Every implementation loads its native dependency lazily and degrades to a
 * reported capability. Opening the window must never depend on a library, a
 * permission, or a desktop service being present.
 */

/** Verifies where a paste would land. `null` from `check()` means unknown. */
export interface TargetTracker {
  isAvailable(): boolean
  /** Remembers the currently focused target so `check()` can compare later. */
  capture(): void
  clear(): void
  check(): ForegroundState | null
}

export interface ShortcutBackendOptions {
  chord: ShortcutChord
  holdDelayMs: number
  /** Hold backends: chord went down. Toggle backends: the shortcut fired. */
  onPress(): void
  /** Hold backends only; a toggle backend never calls this. */
  onRelease(): void
  /**
   * The chord has been held on its own for a moment and its hold delay is
   * still running, so the user may be about to dictate — or may yet press the
   * rest of some other shortcut that begins the same way. Only a backend that
   * watches key-down calls this. Every arm announced here ends in exactly one
   * `onPress` (the chord was held) or one `onDisarm`. A press can also come
   * with no arm before it — a quick tap, or a delay too short to announce one.
   */
  onArm?(): void
  /**
   * An announced arm ended without activating: a key outside the chord, an
   * early release, a reset, a new chord or delay, or the start of a capture.
   * A toggle tap that fires `onPress` on release is an activation, not this.
   */
  onDisarm?(): void
  /**
   * Esc went down on its own, with no modifier held, while the shortcut is
   * enabled and no chord is being recorded. Only a backend that watches the
   * keyboard calls this, and says so with `supportsEscape`. The key is only
   * observed: the app in front sees the same Esc.
   */
  onEscape?(): void
  onError(message: string): void
  /** Streams the chord being recorded by "Change shortcut". */
  onCapture(keys: number[], done: boolean): void
}

/**
 * A source of global shortcut events.
 *
 * `supportsHold` is the honest half of this interface. A backend that can only
 * see a key going down must report `false`, so hold-to-talk is disabled rather
 * than simulated from a press callback that never has a matching release.
 */
export interface ShortcutBackend {
  /** True only when key-up is genuinely observed. */
  readonly supportsHold: boolean
  /** True when the backend can record a chord from live input. */
  readonly supportsCapture: boolean
  /** True when the backend reports Esc through `onEscape`. */
  readonly supportsEscape: boolean
  start(): void
  stop(): void
  setChord(chord: ShortcutChord): void
  setHoldDelay(holdDelayMs: number): void
  /**
   * Whether a chord released before the hold delay still counts as a press.
   * Toggle recording sets this, because the press that stops a dictation is a
   * tap. Backends that fire on press alone can ignore it.
   */
  setTapToFire(enabled: boolean): void
  setEnabled(enabled: boolean): void
  isEnabled(): boolean
  isCapturing(): boolean
  beginCapture(): void
  cancelCapture(): void
  resetKeyState(): void
  /** Ignores input for a moment, so injected keystrokes cannot re-trigger. */
  suppressSyntheticInput(milliseconds: number): void
  /** Why the shortcut is not currently in force, or null when it is. */
  registrationError(): string | null
}

export interface PlatformAdapter {
  readonly id: PlatformId
  /** Only set on Linux. */
  readonly session: LinuxSession | null
  /** Label of the chord this platform injects to paste, e.g. "Ctrl + V". */
  readonly pasteLabel: string
  /** The word used for this platform's primary modifier in shortcut hints. */
  readonly primaryModifierLabel: string
  createShortcutBackend(options: ShortcutBackendOptions): ShortcutBackend
  createTargetTracker(): TargetTracker
  /** Injects the paste chord into whatever currently has focus. */
  paste(): void
  /** True when paste injection is actually wired up on this platform. */
  canPaste(): boolean
  setLaunchAtLogin(enabled: boolean): void
  /** Opens the OS settings page that would grant a missing permission. */
  openSettingsPane(pane: SettingsPane): Promise<void>
  /**
   * A fresh capability read. Called again whenever the user might have changed
   * something outside the app, because macOS permissions can be revoked while
   * Murmur is running.
   */
  capabilities(context: CapabilityContext): CapabilityMap
}

/** Facts the adapter needs but does not own. */
export interface CapabilityContext {
  /** The backend actually in use, so a failed registration can be reported. */
  shortcuts: ShortcutBackend | null
  target: TargetTracker | null
  /** Whether OS-backed storage is fit to hold a credential. */
  secureStorage: { usable: boolean; reason: string }
}

/** A tracker for platforms with no safe way to verify the paste target. */
export class NullTargetTracker implements TargetTracker {
  isAvailable(): boolean {
    return false
  }
  capture(): void {}
  clear(): void {}
  check(): ForegroundState | null {
    return null
  }
}

/**
 * A backend for platforms with no usable global input.
 *
 * It exists so that a missing keyboard hook, or an operating system nobody has
 * written an adapter for, still yields a working application window. The
 * reason it was created is reported through `registrationError()` and reaches
 * the user as a capability, not as a crash.
 */
export class NullShortcutBackend implements ShortcutBackend {
  readonly supportsHold = false
  readonly supportsCapture = false
  readonly supportsEscape = false

  constructor(private readonly reason: string) {}

  start(): void {}
  stop(): void {}
  setChord(): void {}
  setHoldDelay(): void {}
  setTapToFire(): void {}
  setEnabled(): void {}
  isEnabled(): boolean {
    return false
  }
  isCapturing(): boolean {
    return false
  }
  /** Ends at once, so a Settings page waiting on a capture is never stranded. */
  beginCapture(): void {
    this.options?.onCapture([], true)
  }
  cancelCapture(): void {}
  resetKeyState(): void {}
  suppressSyntheticInput(): void {}
  registrationError(): string | null {
    return this.reason
  }

  private options: ShortcutBackendOptions | null = null

  /** Lets the null backend still answer a capture request from the UI. */
  withOptions(options: ShortcutBackendOptions): this {
    this.options = options
    return this
  }
}
