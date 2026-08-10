import type { AppInfo, HistoryEntry, Page, PublicSettings } from '../shared/types'

/** Everything a page needs from the shell, so pages stay free of globals. */
export interface AppContext {
  readonly content: HTMLElement
  settings: PublicSettings
  history: HistoryEntry[]
  appInfo: AppInfo
  setHeading(title: string, subtitle: string): void
  /** Replaces the cached settings and refreshes the sidebar. */
  applySettings(next: PublicSettings): void
  navigate(page: Page): void
  reloadHistory(): Promise<void>
}
