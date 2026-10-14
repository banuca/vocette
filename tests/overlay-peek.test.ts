import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PEEK_POLL_MS, createOverlayPeek, type PeekPoint } from '../src/main/overlay-peek'

const BOUNDS = { x: 720, y: 948, width: 480, height: 96 }

function harness(start: PeekPoint = { x: 0, y: 0 }) {
  let cursor = start
  let bounds: typeof BOUNDS | null = BOUNDS
  const send = vi.fn<(point: PeekPoint | null) => void>()
  const peek = createOverlayPeek({
    cursor: () => cursor,
    bounds: () => bounds,
    send
  })
  return {
    peek,
    send,
    moveTo: (point: PeekPoint) => {
      cursor = point
    },
    hide: () => {
      bounds = null
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the pill fading under the pointer', () => {
  it('sends nothing while the pointer is elsewhere', () => {
    const { peek, send } = harness({ x: 10, y: 10 })
    peek.start()
    vi.advanceTimersByTime(PEEK_POLL_MS * 5)
    expect(send).not.toHaveBeenCalled()
    peek.stop()
  })

  it('sends the pointer relative to the window on every reading inside it', () => {
    const { peek, send, moveTo } = harness({ x: 960, y: 1000 })
    peek.start()
    expect(send).toHaveBeenLastCalledWith({ x: 240, y: 52 })
    // Still, it keeps coming: the pill may spring open under a pointer that has not moved.
    vi.advanceTimersByTime(PEEK_POLL_MS * 3)
    expect(send).toHaveBeenCalledTimes(4)
    moveTo({ x: 721, y: 949 })
    vi.advanceTimersByTime(PEEK_POLL_MS)
    expect(send).toHaveBeenLastCalledWith({ x: 1, y: 1 })
    peek.stop()
  })

  it('says once that the pointer left, then goes quiet', () => {
    const { peek, send, moveTo } = harness({ x: 960, y: 1000 })
    peek.start()
    moveTo({ x: 960, y: 900 })
    vi.advanceTimersByTime(PEEK_POLL_MS * 4)
    expect(send).toHaveBeenLastCalledWith(null)
    expect(send.mock.calls.filter(([point]) => point === null)).toHaveLength(1)
    peek.stop()
  })

  it('treats the far edges as outside', () => {
    const { peek, send } = harness({ x: BOUNDS.x + BOUNDS.width, y: BOUNDS.y + BOUNDS.height })
    peek.start()
    expect(send).not.toHaveBeenCalled()
    peek.stop()
  })

  it('lets the pill back to full strength when it stops', () => {
    const { peek, send } = harness({ x: 960, y: 1000 })
    peek.start()
    peek.stop()
    expect(send).toHaveBeenLastCalledWith(null)
    send.mockClear()
    vi.advanceTimersByTime(PEEK_POLL_MS * 5)
    expect(send).not.toHaveBeenCalled()
  })

  it('reads nothing inside a window that is gone', () => {
    const { peek, send, hide } = harness({ x: 960, y: 1000 })
    peek.start()
    hide()
    vi.advanceTimersByTime(PEEK_POLL_MS)
    expect(send).toHaveBeenLastCalledWith(null)
    peek.stop()
  })

  it('starts once, however often it is asked', () => {
    const { peek, send } = harness({ x: 960, y: 1000 })
    peek.start()
    peek.start()
    send.mockClear()
    vi.advanceTimersByTime(PEEK_POLL_MS)
    expect(send).toHaveBeenCalledTimes(1)
    peek.stop()
  })

  it('survives a reading that throws', () => {
    const send = vi.fn()
    const peek = createOverlayPeek({
      cursor: () => {
        throw new Error('gone')
      },
      bounds: () => BOUNDS,
      send
    })
    expect(() => {
      peek.start()
      vi.advanceTimersByTime(PEEK_POLL_MS * 2)
      peek.stop()
    }).not.toThrow()
  })
})
