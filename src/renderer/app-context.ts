import type { PlatformStatus } from '../shared/capabilities'
import type { EngineStatus } from '../shared/engine'
import type { MicrophoneAccess } from './setup-guide'
import type {
  AppInfo,
  HistoryEntry,
  LicenceStatus,
  Page,
  PublicSettings,
  TranscriptionEngine,
  WorkflowStatus
} from '../shared/types'

/** What a page is opened to do, beyond showing itself. */
export interface NavigationIntent {
  /**
   * Settings opens with this engine chosen but not saved — the setup card's
   * "use your own API key instead" arrives this way.
   */
  engine?: TranscriptionEngine
}

/** Everything a page needs from the shell, so pages stay free of globals. */
export interface AppContext {
  readonly content: HTMLElement
  settings: PublicSettings
  history: HistoryEntry[]
  appInfo: AppInfo
  /** What this desktop actually allows. Re-read while the app runs. */
  platform: PlatformStatus
  /**
   * Whether a dictation can be transcribed now, and where the speech model
   * stands. Pushed by the main process whenever either changes.
   */
  engine: EngineStatus
  /** The dictation as the main process last reported it. */
  workflow: WorkflowStatus
  /** Microphone permission as the renderer last observed it. */
  microphone: MicrophoneAccess
  /**
   * Where this PC stands with Pro: the plan, the trial, the licence. Pushed by
   * the main process on every change, and asked for again when the window
   * comes back into focus, because the trial can end while it is open.
   */
  licence: LicenceStatus
  setHeading(title: string, subtitle: string): void
  /** Replaces the cached settings and refreshes the sidebar. */
  applySettings(next: PublicSettings): void
  /** Replaces the cached capabilities and refreshes anything that shows them. */
  applyPlatform(next: PlatformStatus): void
  /** Replaces the cached engine status and refreshes anything that depends on it. */
  applyEngine(next: EngineStatus): void
  /** Replaces the cached licence status and refreshes anything that shows it. */
  applyLicence(next: LicenceStatus): void
  navigate(page: Page, intent?: NavigationIntent): void
  reloadHistory(): Promise<void>
}
