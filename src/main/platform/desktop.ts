import type { AcceleratorApi } from './accelerator-backend'

/**
 * The Electron services the adapters need, behind an interface so every
 * adapter can be unit-tested without an Electron app object.
 */
export interface DesktopServices {
  setLoginItemSettings(settings: {
    openAtLogin: boolean
    args?: string[]
    path?: string
  }): void
  openExternal(url: string): Promise<void>
  globalShortcut: AcceleratorApi
}
