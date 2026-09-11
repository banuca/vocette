import { ForegroundTracker } from '../foreground'
import { available, unavailable, type CapabilityMap } from '../../shared/capabilities'
import type { DesktopServices } from './desktop'
import type { HookModule } from './hook-backend'
import {
  NullShortcutBackend,
  NullTargetTracker,
  type CapabilityContext,
  type PlatformAdapter
} from './types'

const NO_HOOK =
  'The keyboard hook could not start, so system-wide shortcuts are off. ' +
  'You can still record from the Murmur window.'

const NO_TARGET_CHECK =
  'Murmur could not check which window has focus, so it copies the ' +
  'transcript instead of pasting it.'

/**
 * Windows. This is the platform the app was built on and the behaviour here is
 * unchanged: the corrected Win32 pointer and BOOL bindings, the finally-based
 * handle cleanup, the elevation refusal and both target checks before a paste
 * are all exactly as verified.
 */
export function createWindowsAdapter(
  hook: HookModule | null,
  services: DesktopServices
): PlatformAdapter {
  return {
    id: 'windows',
    session: null,
    pasteLabel: 'Ctrl + V',
    primaryModifierLabel: 'Ctrl',

    createShortcutBackend(options) {
      if (!hook) return new NullShortcutBackend(NO_HOOK).withOptions(options)
      return hook.createBackend(options)
    },

    createTargetTracker() {
      return hook ? new ForegroundTracker() : new NullTargetTracker()
    },

    paste() {
      hook?.paste('ctrl')
    },

    canPaste() {
      return hook !== null
    },

    setLaunchAtLogin(enabled) {
      services.setLoginItemSettings({ openAtLogin: enabled, args: ['--background'] })
    },

    async openSettingsPane(pane) {
      // Windows has a microphone privacy page; the other panes do not exist.
      if (pane === 'microphone') await services.openExternal('ms-settings:privacy-microphone')
    },

    capabilities(context: CapabilityContext): CapabilityMap {
      const hookProblem = hook ? context.shortcuts?.registrationError() ?? null : NO_HOOK
      const shortcuts = hookProblem ? unavailable(hookProblem) : available()
      const targetOk = context.target?.isAvailable() ?? false
      return {
        globalHold: shortcuts,
        globalToggle: shortcuts,
        targetVerification: targetOk ? available() : unavailable(NO_TARGET_CHECK),
        autoPaste: hook ? available() : unavailable(NO_HOOK),
        launchAtLogin: available(),
        secureKeyStorage: context.secureStorage.usable
          ? available()
          : unavailable(context.secureStorage.reason)
      }
    }
  }
}
