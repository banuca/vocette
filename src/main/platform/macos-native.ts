import type { ForegroundState } from '../dictation-controller'
import { addressOf } from './native-address'
import type { TargetTracker } from './types'

/**
 * macOS target verification and permission state.
 *
 * Two OS facts shape this:
 *
 *  - There is no public, permission-free way to identify an arbitrary
 *    *window*. There is one for the frontmost *application*, through
 *    `NSWorkspace`, so verification here is application-level. That is weaker
 *    than the Windows window-handle check and is said so in the UI rather than
 *    quietly presented as the same guarantee.
 *  - macOS blocks synthetic keystrokes while secure input is active — a
 *    password field, a lock screen, some terminals. That is the true analogue
 *    of the Windows elevation refusal: keystrokes silently go nowhere.
 *
 * Everything is reached through the Objective-C runtime and a few plain C
 * functions, so no native build step or extra dependency is needed. Any
 * failure degrades to "unknown", which leaves the transcript on the clipboard.
 */
export type KoffiLoader = () => typeof import('koffi') | null

function defaultKoffiLoader(): typeof import('koffi') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('koffi') as typeof import('koffi') | null
  } catch {
    return null
  }
}

export interface MacBindings {
  /** Process id of the frontmost application, or null when unknown. */
  frontmostPid(): number | null
  /** True while macOS is blocking synthetic keystrokes. Null when unknown. */
  secureInputEnabled(): boolean | null
  /** Accessibility permission, needed to post synthetic events. */
  accessibilityTrusted(): boolean | null
  /** Input Monitoring permission, needed to observe the keyboard (10.15+). */
  inputMonitoringGranted(): boolean | null
  /** Asks macOS to show its Input Monitoring prompt. Safe to call repeatedly. */
  requestInputMonitoring(): void
}

const APPKIT = '/System/Library/Frameworks/AppKit.framework/AppKit'
const APP_SERVICES =
  '/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices'
const CORE_GRAPHICS = '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics'
const CARBON = '/System/Library/Frameworks/Carbon.framework/Carbon'

/**
 * Binds the runtime lazily. Each group is wrapped separately: an older macOS
 * without `CGPreflightListenEventAccess` must still get frontmost-application
 * verification rather than losing the whole adapter.
 */
export function loadMacBindings(loadKoffi: KoffiLoader = defaultKoffiLoader): MacBindings | null {
  let koffi: typeof import('koffi') | null
  try {
    koffi = loadKoffi()
  } catch {
    return null
  }
  if (!koffi) return null
  const library = koffi

  let frontmostPid: MacBindings['frontmostPid']
  try {
    const objc = library.load('/usr/lib/libobjc.A.dylib')
    // NSWorkspace lives in AppKit; loading it registers the class.
    library.load(APPKIT)
    const objcGetClass = objc.func('void *objc_getClass(const char *name)')
    const selector = objc.func('void *sel_registerName(const char *name)')
    // objc_msgSend is declared once per return shape: the ABI needs the exact
    // signature, and a pointer return must never be read as an integer.
    const sendPointer = objc.func('objc_msgSend', 'void *', ['void *', 'void *'])
    const sendInt32 = objc.func('objc_msgSend', 'int32', ['void *', 'void *'])

    const sharedWorkspace = selector('sharedWorkspace')
    const frontmostApplication = selector('frontmostApplication')
    const processIdentifier = selector('processIdentifier')

    frontmostPid = (): number | null => {
      try {
        const workspaceClass = objcGetClass('NSWorkspace')
        if (addressOf(library, workspaceClass) === null) return null
        const workspace = sendPointer(workspaceClass, sharedWorkspace)
        if (addressOf(library, workspace) === null) return null
        // nil whenever no application is frontmost, e.g. at the login window.
        const application = sendPointer(workspace, frontmostApplication)
        if (addressOf(library, application) === null) return null
        const pid = sendInt32(application, processIdentifier)
        return typeof pid === 'number' && pid > 0 ? pid : null
      } catch {
        return null
      }
    }
  } catch {
    frontmostPid = () => null
  }

  const flag = (
    path: string,
    signature: string
  ): (() => boolean | null) => {
    try {
      // Carbon's Boolean and C99 bool are both a single byte; read the byte
      // rather than trusting a wider mapping.
      const fn = library.load(path).func(signature)
      return () => {
        try {
          const value: unknown = fn()
          return typeof value === 'number' ? value !== 0 : Boolean(value)
        } catch {
          return null
        }
      }
    } catch {
      return () => null
    }
  }

  const secureInputEnabled = flag(CARBON, 'uint8 IsSecureEventInputEnabled()')
  const accessibilityTrusted = flag(APP_SERVICES, 'uint8 AXIsProcessTrusted()')
  const inputMonitoringGranted = flag(CORE_GRAPHICS, 'uint8 CGPreflightListenEventAccess()')

  let requestInputMonitoring: () => void = () => {}
  try {
    const request = library.load(CORE_GRAPHICS).func('uint8 CGRequestListenEventAccess()')
    requestInputMonitoring = (): void => {
      try {
        request()
      } catch {
        // The prompt is best effort; the settings link is the reliable path.
      }
    }
  } catch {
    // Older macOS has no Input Monitoring pane at all.
  }

  return {
    frontmostPid,
    secureInputEnabled,
    accessibilityTrusted,
    inputMonitoringGranted,
    requestInputMonitoring
  }
}

/**
 * Application-level paste-target verification for macOS.
 *
 * `sameWindow` is true when the frontmost *application* is the one that was
 * frontmost when the take started. Moving between two windows of that same
 * application is not detected; moving to any other application is.
 */
export class MacTargetTracker implements TargetTracker {
  private target: number | null = null

  constructor(private readonly bindings: MacBindings | null) {}

  isAvailable(): boolean {
    return this.bindings !== null
  }

  capture(): void {
    this.target = this.bindings?.frontmostPid() ?? null
  }

  clear(): void {
    this.target = null
  }

  check(): ForegroundState | null {
    if (!this.bindings) return null
    const pid = this.bindings.frontmostPid()
    if (pid === null) return null
    const secure = this.bindings.secureInputEnabled()
    if (secure === null) return null
    return {
      sameWindow: this.target !== null && pid === this.target,
      elevated: secure,
      blockedReason: 'macOS secure input is active'
    }
  }
}
