import { contextBridge, ipcRenderer } from 'electron'
import type { PlatformStatus, SettingsPane } from '../shared/capabilities'
import type { EngineStatus } from '../shared/engine'
import type {
  AppInfo,
  HistoryEntry,
  HistorySaveStatus,
  Page,
  PasteLastStatus,
  PublicSettings,
  SettingsUpdate,
  ShortcutCapture,
  Theme,
  WorkflowStatus
} from '../shared/types'

const api = {
  getSettings: (): Promise<PublicSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (update: SettingsUpdate): Promise<PublicSettings> =>
    ipcRenderer.invoke('settings:save', update),
  clearApiKey: (): Promise<PublicSettings> => ipcRenderer.invoke('settings:clear-api-key'),
  clearSessionApiKey: (): Promise<PublicSettings> =>
    ipcRenderer.invoke('settings:clear-session-key'),

  getPlatformStatus: (): Promise<PlatformStatus> => ipcRenderer.invoke('platform:status'),
  openPlatformSettings: (pane: SettingsPane): Promise<void> =>
    ipcRenderer.invoke('platform:open-settings', pane),

  // The on-device engine. Each command answers with the status as it stands;
  // download progress and every later change arrive through `onEngineStatus`.
  getEngineStatus: (): Promise<EngineStatus> => ipcRenderer.invoke('engine:get-status'),
  downloadModel: (): Promise<EngineStatus> => ipcRenderer.invoke('engine:download'),
  cancelModelDownload: (): Promise<EngineStatus> => ipcRenderer.invoke('engine:cancel-download'),
  removeModel: (): Promise<EngineStatus> => ipcRenderer.invoke('engine:remove-model'),

  // Recording from the window goes to the one dictation controller, exactly
  // like the global shortcut; the renderer never opens a microphone for this.
  startRecording: (): Promise<void> => ipcRenderer.invoke('dictation:start'),
  stopRecording: (): Promise<void> => ipcRenderer.invoke('dictation:stop'),
  cancelRecording: (): Promise<void> => ipcRenderer.invoke('dictation:cancel'),
  retryLastDictation: (): Promise<void> => ipcRenderer.invoke('dictation:retry'),

  getHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:list'),
  getHistorySaveStatus: (): Promise<HistorySaveStatus> => ipcRenderer.invoke('history:save-status'),
  deleteHistoryEntry: (id: string): Promise<HistoryEntry[]> =>
    ipcRenderer.invoke('history:delete', id),
  clearHistory: (): Promise<void> => ipcRenderer.invoke('history:clear'),
  exportHistory: (format: 'json' | 'txt'): Promise<{ saved: boolean; path: string | null }> =>
    ipcRenderer.invoke('history:export', format),

  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  openExternal: (target: string): Promise<void> => ipcRenderer.invoke('app:open-external', target),
  hideWindow: (): Promise<void> => ipcRenderer.invoke('app:hide-window'),
  announceReady: (): Promise<void> => ipcRenderer.invoke('app:ready'),

  beginShortcutCapture: (): Promise<void> => ipcRenderer.invoke('shortcut:begin-capture'),
  cancelShortcutCapture: (): Promise<void> => ipcRenderer.invoke('shortcut:cancel-capture'),
  getPasteLastStatus: (): Promise<PasteLastStatus> =>
    ipcRenderer.invoke('shortcut:paste-last-status'),

  onWorkflowStatus: (callback: (status: WorkflowStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: WorkflowStatus): void => callback(status)
    ipcRenderer.on('workflow:status', listener)
    return () => ipcRenderer.removeListener('workflow:status', listener)
  },
  /**
   * The microphone level, 0–1, while a take is recording. This preload is
   * shared, but the main process sends the level to the overlay alone, so in
   * the main window this listener never hears anything.
   */
  onLevel: (callback: (level: number) => void): (() => void) => {
    const listener = (_event: unknown, level: number): void => callback(level)
    ipcRenderer.on('workflow:level', listener)
    return () => ipcRenderer.removeListener('workflow:level', listener)
  },
  onPlatformStatus: (callback: (status: PlatformStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: PlatformStatus): void => callback(status)
    ipcRenderer.on('platform:status', listener)
    return () => ipcRenderer.removeListener('platform:status', listener)
  },
  onEngineStatus: (callback: (status: EngineStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: EngineStatus): void => callback(status)
    ipcRenderer.on('engine:status', listener)
    return () => ipcRenderer.removeListener('engine:status', listener)
  },
  onHistorySaveStatus: (callback: (status: HistorySaveStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: HistorySaveStatus): void => callback(status)
    ipcRenderer.on('history:save-status', listener)
    return () => ipcRenderer.removeListener('history:save-status', listener)
  },
  onHistoryChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('history:changed', listener)
    return () => ipcRenderer.removeListener('history:changed', listener)
  },
  onSettingsChanged: (callback: (settings: PublicSettings) => void): (() => void) => {
    const listener = (_event: unknown, settings: PublicSettings): void => callback(settings)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  },
  onShortcutCapture: (callback: (capture: ShortcutCapture) => void): (() => void) => {
    const listener = (_event: unknown, capture: ShortcutCapture): void => callback(capture)
    ipcRenderer.on('shortcut:capture', listener)
    return () => ipcRenderer.removeListener('shortcut:capture', listener)
  },
  /**
   * The interface palette. Sent on its own channel rather than folded into
   * `settings:changed`, because the overlay needs this one value and has no
   * business receiving the rest of the user's settings.
   */
  onTheme: (callback: (theme: Theme) => void): (() => void) => {
    const listener = (_event: unknown, theme: Theme): void => callback(theme)
    ipcRenderer.on('app:theme', listener)
    return () => ipcRenderer.removeListener('app:theme', listener)
  },
  onNavigate: (callback: (page: Page) => void): (() => void) => {
    const listener = (_event: unknown, page: Page): void => callback(page)
    ipcRenderer.on('app:navigate', listener)
    return () => ipcRenderer.removeListener('app:navigate', listener)
  }
}

export type MurmurApi = typeof api

contextBridge.exposeInMainWorld('murmur', api)
