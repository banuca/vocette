/**
 * Point at the pill and it fades, so what is behind it can be read. Clicks
 * already pass through the overlay; this is for the eyes.
 *
 * While the overlay is on screen, the pointer is read about ten times a
 * second. Inside the overlay's window it is sent there, relative to the
 * window, on every reading — the pill may spring open under a still pointer,
 * so the page hit-tests afresh each time. Leaving the window sends one
 * `null`. Nothing is sent while the pointer is elsewhere.
 *
 * Not Electron's `setIgnoreMouseEvents(true, { forward: true })`: on Windows
 * that installs a low-level mouse hook on the main thread, and a busy main
 * thread would then make the mouse lag across the whole desktop.
 */

export const PEEK_POLL_MS = 100

export interface PeekPoint {
  x: number
  y: number
}

interface Bounds extends PeekPoint {
  width: number
  height: number
}

export interface OverlayPeekDeps {
  /** The pointer, in screen coordinates (DIPs). */
  cursor(): PeekPoint
  /** The overlay window's bounds, in the same coordinates. */
  bounds(): Bounds | null
  /** Sends the pointer, relative to the window, or `null` once it has left. */
  send(point: PeekPoint | null): void
}

export interface OverlayPeek {
  /** Starts watching; calling it again while watching does nothing. */
  start(): void
  /** Stops watching, and lets the pill go back to full strength. */
  stop(): void
}

export function createOverlayPeek(deps: OverlayPeekDeps, intervalMs = PEEK_POLL_MS): OverlayPeek {
  let poll: ReturnType<typeof setInterval> | null = null
  let inside = false

  const leave = (): void => {
    if (!inside) return
    inside = false
    deps.send(null)
  }

  const read = (): void => {
    try {
      const bounds = deps.bounds()
      const cursor = deps.cursor()
      const x = cursor.x - (bounds?.x ?? 0)
      const y = cursor.y - (bounds?.y ?? 0)
      if (bounds && x >= 0 && y >= 0 && x < bounds.width && y < bounds.height) {
        inside = true
        deps.send({ x, y })
      } else {
        leave()
      }
    } catch {
      // A window closing under the reading: the next one, or stop, settles it.
    }
  }

  return {
    start() {
      if (poll) return
      poll = setInterval(read, intervalMs)
      // Never the reason the app stays running.
      poll.unref?.()
      read()
    },
    stop() {
      if (poll) clearInterval(poll)
      poll = null
      leave()
    }
  }
}
