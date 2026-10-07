import {
  available,
  needsPermission,
  unavailable,
  type CapabilityMap
} from '../../shared/capabilities'
import type { DesktopServices } from './desktop'
import type { HookModule } from './hook-backend'
import { MacTargetTracker, loadMacBindings, type MacBindings } from './macos-native'
import {
  NullShortcutBackend,
  NullTargetTracker,
  type CapabilityContext,
  type PlatformAdapter
} from './types'

const PRIVACY = 'x-apple.systempreferences:com.apple.preference.security?Privacy_'

const NO_HOOK =
  'The keyboard hook could not start, so system-wide shortcuts are off. ' +
  'You can still record from the Vocette window.'

const NEEDS_INPUT_MONITORING =
  'macOS needs to grant Vocette Input Monitoring before it can see your ' +
  'shortcut. Until then, record from the Vocette window.'

const NEEDS_ACCESSIBILITY =
  'macOS needs to grant Vocette Accessibility before it can paste for ' +
  'you. Until then, the transcript is copied to your clipboard.'

const NO_TARGET_CHECK =
  'Vocette could not check which application is in front, so it copies ' +
  'the transcript instead of pasting it.'

/**
 * macOS.
 *
 * Both of the capabilities that matter are permission-gated and both can be
 * revoked while the app is running, so capability is re-read rather than
 * cached: Input Monitoring for observing the shortcut, Accessibility for
 * posting the paste keystroke. Each unavailable capability carries the pane
 * that grants it, so the UI can offer a button rather than an instruction.
 *
 * Target verification is application-level (see `macos-native.ts`), which is
 * weaker than the Windows window check. That difference is stated, not
 * smoothed over, and it never relaxes the Windows behaviour.
 */
export function createMacAdapter(
  hook: HookModule | null,
  services: DesktopServices,
  bindings: MacBindings | null = loadMacBindings()
): PlatformAdapter {
  return {
    id: 'macos',
    session: null,
    pasteLabel: 'Command + V',
    primaryModifierLabel: 'Command',

    createShortcutBackend(options) {
      if (!hook) return new NullShortcutBackend(NO_HOOK).withOptions(options)
      return hook.createBackend(options)
    },

    createTargetTracker() {
      return bindings ? new MacTargetTracker(bindings) : new NullTargetTracker()
    },

    paste() {
      hook?.paste('meta')
    },

    canPaste() {
      return hook !== null
    },

    setLaunchAtLogin(enabled) {
      services.setLoginItemSettings({ openAtLogin: enabled, args: ['--background'] })
    },

    async openSettingsPane(pane) {
      const panes: Record<typeof pane, string> = {
        accessibility: `${PRIVACY}Accessibility`,
        'input-monitoring': `${PRIVACY}ListenEvent`,
        microphone: `${PRIVACY}Microphone`
      }
      await services.openExternal(panes[pane])
    },

    capabilities(context: CapabilityContext): CapabilityMap {
      const listening = bindings?.inputMonitoringGranted() ?? null
      const trusted = bindings?.accessibilityTrusted() ?? null
      const hookProblem = hook ? context.shortcuts?.registrationError() ?? null : NO_HOOK

      // Permission first: "not granted" is actionable, "hook did not start" is
      // usually just its consequence.
      const shortcuts =
        listening === false
          ? needsPermission(NEEDS_INPUT_MONITORING, 'input-monitoring')
          : hookProblem
            ? unavailable(hookProblem)
            : available()

      const paste = !hook
        ? unavailable(NO_HOOK)
        : trusted === false
          ? needsPermission(NEEDS_ACCESSIBILITY, 'accessibility')
          : available()

      const targetOk = context.target?.isAvailable() ?? false
      return {
        globalHold: shortcuts,
        globalToggle: shortcuts,
        targetVerification: targetOk ? available() : unavailable(NO_TARGET_CHECK),
        autoPaste: paste,
        launchAtLogin: available(),
        secureKeyStorage: context.secureStorage.usable
          ? available()
          : unavailable(context.secureStorage.reason)
      }
    }
  }
}
