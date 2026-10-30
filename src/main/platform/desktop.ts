import type { AcceleratorApi } from './accelerator-backend'
import type { StartupTaskSwitch } from './startup-task'

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
  /**
   * The Microsoft Store build's startup task, which takes the place of the
   * login item there (startup-task.ts). Absent everywhere else.
   */
  startupTask?: StartupTaskSwitch | null
}
