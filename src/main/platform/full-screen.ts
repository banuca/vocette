/**
 * Whether something full-screen is in front, on Windows: a video, a game, a
 * slideshow. The resting pill steps aside for it rather than sit on a film.
 *
 * Read through `SHQueryUserNotificationState`, the shell's own answer to
 * "may an app show a notification now?", which already knows about
 * full-screen apps, presentation mode and a locked screen. Loaded lazily
 * through koffi like the rest of the Win32 code; anything that fails makes
 * the answer "no", and the pill simply stays where it rests.
 */
import type { KoffiLoader } from '../foreground'

/**
 * The QUERY_USER_NOTIFICATION_STATE values that mean "do not draw over this":
 * not present (locked, a screen saver, another user's session), busy (a
 * full-screen app, or presentation settings), a Direct3D full-screen app,
 * presentation mode, and a full-screen Store app. Accepting notifications (5)
 * and quiet time (6) leave the pill where it is.
 */
const STEP_ASIDE: ReadonlySet<number> = new Set([1, 2, 3, 4, 7])

function defaultKoffiLoader(): typeof import('koffi') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('koffi') as typeof import('koffi') | null
  } catch {
    return null
  }
}

export function createFullScreenProbe(loadKoffi: KoffiLoader = defaultKoffiLoader): () => boolean {
  let query: ((state: number[]) => number) | null = null
  try {
    const koffi = loadKoffi()
    if (koffi) {
      const shell32 = koffi.load('shell32.dll')
      // HRESULT SHQueryUserNotificationState(QUERY_USER_NOTIFICATION_STATE *pquns)
      query = shell32.func(
        'int32 SHQueryUserNotificationState(_Out_ int32 *pquns)'
      ) as (state: number[]) => number
    }
  } catch {
    query = null
  }

  return () => {
    if (!query) return false
    try {
      const state = [0]
      // S_OK is 0; any other result says nothing about the screen.
      return query(state) === 0 && STEP_ASIDE.has(state[0] ?? 0)
    } catch {
      return false
    }
  }
}
