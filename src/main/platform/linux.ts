import {
  available,
  unavailable,
  type CapabilityMap,
  type LinuxSession
} from '../../shared/capabilities'
import { AcceleratorShortcutBackend } from './accelerator-backend'
import type { DesktopServices } from './desktop'
import type { HookModule } from './hook-backend'
import { X11TargetTracker, loadX11Bindings, type X11Bindings } from './linux-native'
import {
  NullShortcutBackend,
  NullTargetTracker,
  type CapabilityContext,
  type PlatformAdapter
} from './types'

const NO_HOOK =
  'The keyboard hook could not start, so system-wide shortcuts are off. ' +
  'You can still record from the Vocette window.'

const NO_X11_TARGET_CHECK =
  'Vocette could not ask the X server which window has focus, so it ' +
  'copies the transcript instead of pasting it.'

const WAYLAND_NO_HOLD =
  'Wayland does not let an application watch the keyboard, so hold-to-talk is ' +
  'not possible here. The shortcut starts and stops recording instead.'

const WAYLAND_NO_TARGET =
  'Wayland does not tell applications which window has focus, so Vocette ' +
  'cannot check where a paste would land. The transcript is copied to your ' +
  'clipboard instead.'

const WAYLAND_NO_PASTE =
  'Wayland does not let an application type into another window. The ' +
  'transcript is copied to your clipboard, ready to paste yourself.'

/**
 * Which display server this session is actually using.
 *
 * `XDG_SESSION_TYPE` is the declared answer and is trusted first; the display
 * variables are the fallback for sessions that do not set it. An unknown
 * session is not guessed at — the X11 path is attempted and reports honestly
 * if the display cannot be opened.
 */
export function detectLinuxSession(env: NodeJS.ProcessEnv = process.env): LinuxSession {
  const declared = (env.XDG_SESSION_TYPE ?? '').trim().toLowerCase()
  if (declared === 'wayland') return 'wayland'
  if (declared === 'x11') return 'x11'
  if (env.WAYLAND_DISPLAY) return 'wayland'
  if (env.DISPLAY) return 'x11'
  return 'unknown'
}

/**
 * Linux, as two genuinely different platforms behind one adapter.
 *
 * **X11** behaves like Windows: the hook sees key-up so hold-to-talk works,
 * `XGetInputFocus` names the paste target, and a synthetic paste reaches it.
 *
 * **Wayland** is the case the product has to be honest about. The compositor
 * owns input: no application may watch the keyboard, learn which surface has
 * focus, or type into another window. So hold-to-talk is reported unavailable
 * rather than faked from a press-only callback, the shortcut becomes a
 * start/stop toggle registered with the desktop portal, and delivery is
 * clipboard-only with the reason shown in the interface.
 */
export function createLinuxAdapter(
  hook: HookModule | null,
  services: DesktopServices,
  session: LinuxSession = detectLinuxSession(),
  bindings: X11Bindings | null = session === 'wayland' ? null : loadX11Bindings()
): PlatformAdapter {
  const wayland = session === 'wayland'

  return {
    id: 'linux',
    session,
    pasteLabel: 'Ctrl + V',
    primaryModifierLabel: 'Ctrl',

    createShortcutBackend(options) {
      if (wayland) return new AcceleratorShortcutBackend(options, services.globalShortcut)
      if (!hook) return new NullShortcutBackend(NO_HOOK).withOptions(options)
      return hook.createBackend(options)
    },

    createTargetTracker() {
      if (wayland || !bindings) return new NullTargetTracker()
      return new X11TargetTracker(bindings)
    },

    paste() {
      if (wayland) return
      hook?.paste('ctrl')
    },

    canPaste() {
      return !wayland && hook !== null
    },

    setLaunchAtLogin(enabled) {
      // Inside an AppImage `process.execPath` points at a temporary mount that
      // will not exist next login, so the image path is used instead.
      const image = process.env.APPIMAGE
      services.setLoginItemSettings({
        openAtLogin: enabled,
        args: ['--background'],
        ...(image ? { path: image } : {})
      })
    },

    async openSettingsPane() {
      // Linux desktops have no common privacy panes to link to.
    },

    capabilities(context: CapabilityContext): CapabilityMap {
      const secureKeyStorage = context.secureStorage.usable
        ? available()
        : unavailable(context.secureStorage.reason)

      if (wayland) {
        const problem = context.shortcuts?.registrationError() ?? null
        return {
          globalHold: unavailable(WAYLAND_NO_HOLD),
          globalToggle: problem ? unavailable(problem) : available(),
          targetVerification: unavailable(WAYLAND_NO_TARGET),
          autoPaste: unavailable(WAYLAND_NO_PASTE),
          launchAtLogin: available(),
          secureKeyStorage
        }
      }

      const hookProblem = hook ? context.shortcuts?.registrationError() ?? null : NO_HOOK
      const shortcuts = hookProblem ? unavailable(hookProblem) : available()
      const targetOk = context.target?.isAvailable() ?? false
      return {
        globalHold: shortcuts,
        globalToggle: shortcuts,
        targetVerification: targetOk ? available() : unavailable(NO_X11_TARGET_CHECK),
        autoPaste: hook ? available() : unavailable(NO_HOOK),
        launchAtLogin: available(),
        secureKeyStorage
      }
    }
  }
}
