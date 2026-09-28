/**
 * Whether a modifier key is physically held down right now, on Windows.
 *
 * A synthetic Ctrl + V sent while the user is still holding Alt and Shift —
 * as they are for a split second after pressing Alt + Shift + V — reaches the
 * target as Ctrl + Alt + Shift + V, which pastes nothing. Before injecting a
 * paste the controller waits for this to turn false.
 *
 * Read through `GetAsyncKeyState`, which reports the physical state of a key
 * regardless of which window has focus. Loaded lazily through koffi like the
 * rest of the Win32 code; anything that fails makes the answer "unknown"
 * (null), and an unknown answer never delays a paste.
 */
import type { KoffiLoader } from '../foreground'

/** Shift, Ctrl, Alt, and both Windows keys. */
const MODIFIER_KEYS = [0x10, 0x11, 0x12, 0x5b, 0x5c] as const

function defaultKoffiLoader(): typeof import('koffi') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('koffi') as typeof import('koffi') | null
  } catch {
    return null
  }
}

export function createModifierProbe(loadKoffi: KoffiLoader = defaultKoffiLoader): () => boolean | null {
  let getAsyncKeyState: ((key: number) => number) | null = null
  try {
    const koffi = loadKoffi()
    if (koffi) {
      const user32 = koffi.load('user32.dll')
      // SHORT GetAsyncKeyState(int vKey): the high bit is set while the key is down.
      getAsyncKeyState = user32.func('int16 GetAsyncKeyState(int vKey)') as (key: number) => number
    }
  } catch {
    getAsyncKeyState = null
  }

  return () => {
    if (!getAsyncKeyState) return null
    try {
      return MODIFIER_KEYS.some((key) => ((getAsyncKeyState?.(key) ?? 0) & 0x8000) !== 0)
    } catch {
      return null
    }
  }
}
