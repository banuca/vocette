import {
  available,
  unavailable,
  type CapabilityMap,
  type PlatformId
} from '../../shared/capabilities'
import type { DesktopServices } from './desktop'
import type { HookModule } from './hook-backend'
import { createLinuxAdapter } from './linux'
import { createMacAdapter } from './macos'
import {
  NullShortcutBackend,
  NullTargetTracker,
  type CapabilityContext,
  type PlatformAdapter
} from './types'
import { createWindowsAdapter } from './windows'

export type { DesktopServices } from './desktop'
export type { PlatformAdapter, ShortcutBackend, TargetTracker } from './types'

const UNSUPPORTED =
  'Vocette has no system integration for this operating system yet. ' +
  'Recording from the window, transcription, the clipboard and history all work.'

/**
 * Loads the keyboard hook, or reports that it could not be loaded.
 *
 * `uiohook-napi` is native and throws at import time on an architecture it has
 * no prebuild for. The import is dynamic precisely so that failure becomes a
 * capability the user is told about, rather than a main process that dies
 * before a window exists.
 */
export async function loadHookModule(): Promise<HookModule | null> {
  try {
    const module = await import('./hook-backend')
    return module.hookModule
  } catch {
    return null
  }
}

/** For an operating system with no adapter: everything degrades, nothing throws. */
export function createFallbackAdapter(): PlatformAdapter {
  return {
    id: 'unknown',
    session: null,
    pasteLabel: 'Ctrl + V',
    primaryModifierLabel: 'Ctrl',
    createShortcutBackend: (options) => new NullShortcutBackend(UNSUPPORTED).withOptions(options),
    createTargetTracker: () => new NullTargetTracker(),
    paste: () => {},
    canPaste: () => false,
    setLaunchAtLogin: () => {},
    openSettingsPane: async () => {},
    capabilities: (context: CapabilityContext): CapabilityMap => ({
      globalHold: unavailable(UNSUPPORTED),
      globalToggle: unavailable(UNSUPPORTED),
      targetVerification: unavailable(UNSUPPORTED),
      autoPaste: unavailable(UNSUPPORTED),
      launchAtLogin: unavailable(UNSUPPORTED),
      secureKeyStorage: context.secureStorage.usable
        ? available()
        : unavailable(context.secureStorage.reason)
    })
  }
}

export interface PlatformSelection {
  /** Defaults to the running platform; injected in tests. */
  platform?: NodeJS.Platform
  hook?: HookModule | null
}

export async function createPlatformAdapter(
  services: DesktopServices,
  selection: PlatformSelection = {}
): Promise<PlatformAdapter> {
  const platform = selection.platform ?? process.platform
  const hook = selection.hook !== undefined ? selection.hook : await loadHookModule()

  switch (platform) {
    case 'win32':
      return createWindowsAdapter(hook, services)
    case 'darwin':
      return createMacAdapter(hook, services)
    case 'linux':
      return createLinuxAdapter(hook, services)
    default:
      return createFallbackAdapter()
  }
}

/** Names the platform for documentation and the About page. */
export function platformIdFor(platform: NodeJS.Platform): PlatformId {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  if (platform === 'linux') return 'linux'
  return 'unknown'
}
