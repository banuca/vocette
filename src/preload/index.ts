import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  HistoryEntry,
  Page,
  PublicSettings,
  SettingsUpdate,
  ShortcutCapture,
  WorkflowStatus
} from '../shared/types'

const api = {
  getSettings: (): Promise<PublicSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (update: SettingsUpdate): Promise<PublicSettings> =>
    ipcRenderer.invoke('settings:save', update),
  clearApiKey: (): Promise<PublicSettings> => ipcRenderer.invoke('settings:clear-api-key'),

  getHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:list'),
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

  onWorkflowStatus: (callback: (status: WorkflowStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: WorkflowStatus): void => callback(status)
    ipcRenderer.on('workflow:status', listener)
    return () => ipcRenderer.removeListener('workflow:status', listener)
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
  onNavigate: (callback: (page: Page) => void): (() => void) => {
    const listener = (_event: unknown, page: Page): void => callback(page)
    ipcRenderer.on('app:navigate', listener)
    return () => ipcRenderer.removeListener('app:navigate', listener)
  }
}

export type VoiceHotkeyApi = typeof api

contextBridge.exposeInMainWorld('voiceHotkey', api)
