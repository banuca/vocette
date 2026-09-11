import type { ForegroundState } from '../dictation-controller'
import { addressOf } from './native-address'
import type { TargetTracker } from './types'

/**
 * X11 paste-target verification.
 *
 * `XGetInputFocus` names the window the X server is delivering key events to,
 * which is exactly the window a synthetic paste would reach. That makes "did
 * focus move?" answerable on X11, and it is the one question X11 answers
 * usefully.
 *
 * There is deliberately no elevation check. X11 has no equivalent barrier: any
 * client that can connect to the display may send events to any window, so
 * there is no state in which a paste is silently swallowed the way the Windows
 * UIPI boundary swallows it. `elevated: false` here is a statement about X11,
 * not a permissive fallback — a target that cannot be named still comes back
 * as `null` and still blocks automatic paste.
 *
 * Wayland is the opposite case and gets no tracker at all: the compositor
 * exposes neither the focused surface nor a way to type into it, which is why
 * Wayland sessions are clipboard-only.
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

/** X11 focus values that name no usable window. */
const NONE = 0n
const POINTER_ROOT = 1n

export interface X11Bindings {
  /** Focused window id, or null when there is none this app can name. */
  focusedWindow(): bigint | null
}

/** X window ids are small, but the C type is 64-bit; accept either shape. */
function toWindowId(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : null
  return null
}

export function loadX11Bindings(loadKoffi: KoffiLoader = defaultKoffiLoader): X11Bindings | null {
  try {
    const koffi = loadKoffi()
    if (!koffi) return null

    const x11 = koffi.load('libX11.so.6')
    const XOpenDisplay = x11.func('void *XOpenDisplay(const char *display_name)')
    const XGetInputFocus = x11.func(
      'int XGetInputFocus(void *display, _Out_ unsigned long *focus_return, _Out_ int *revert_to_return)'
    )

    // One connection for the life of the process: opening a display per check
    // costs a round trip to the X server on every paste decision.
    const display: unknown = XOpenDisplay(null)
    if (addressOf(koffi, display) === null) return null

    return {
      focusedWindow(): bigint | null {
        try {
          const focus: unknown[] = [0]
          const revert: number[] = [0]
          XGetInputFocus(display, focus, revert)
          const window = toWindowId(focus[0])
          if (window === null || window === NONE || window === POINTER_ROOT) return null
          return window
        } catch {
          return null
        }
      }
    }
  } catch {
    return null
  }
}

export class X11TargetTracker implements TargetTracker {
  private target: bigint | null = null

  constructor(private readonly bindings: X11Bindings | null) {}

  isAvailable(): boolean {
    return this.bindings !== null
  }

  capture(): void {
    this.target = this.bindings?.focusedWindow() ?? null
  }

  clear(): void {
    this.target = null
  }

  check(): ForegroundState | null {
    if (!this.bindings) return null
    const window = this.bindings.focusedWindow()
    if (window === null) return null
    return {
      sameWindow: this.target !== null && window === this.target,
      // See the note above: X11 imposes no barrier on synthetic input.
      elevated: false
    }
  }
}
