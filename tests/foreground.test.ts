import { beforeEach, describe, expect, it } from 'vitest'
import { ForegroundTracker } from '../src/main/foreground'

/**
 * The Win32 calls come from koffi, which cannot load outside the app. The
 * tracker takes an injectable loader, so tests feed it a fake library and
 * still exercise every branch — including graceful degradation.
 */
const state = {
  foreground: 100n,
  elevated: false,
  failForeground: false,
  failElevation: false
}

function fakeLoader(): typeof import('koffi') {
  const makeLib = (name: string) => {
    if (name === 'user32.dll') {
      return {
        func: (definition: string) => {
          if (definition.startsWith('void * GetForegroundWindow')) {
            return () => (state.failForeground ? 0n : state.foreground)
          }
          return (hwnd: bigint, out: [number]) => {
            if (!hwnd) return 0
            out[0] = 4242
            return 1
          }
        }
      }
    }
    if (name === 'kernel32.dll') {
      return {
        func: (definition: string) =>
          definition.startsWith('void * OpenProcess')
            ? () => (state.failElevation ? 0n : 111n)
            : () => true // CloseHandle
      }
    }
    return {
      func: (definition: string) => {
        if (definition.startsWith('bool OpenProcessToken')) {
          return (_process: bigint, _access: number, out: [bigint | null]) => {
            out[0] = 222n
            return true
          }
        }
        return (_token: bigint, _cls: number, out: [number]) => {
          out[0] = state.elevated ? 1 : 0
          return true
        }
      }
    }
  }
  return { load: makeLib } as unknown as typeof import('koffi')
}

beforeEach(() => {
  state.foreground = 100n
  state.elevated = false
  state.failForeground = false
  state.failElevation = false
})

describe('ForegroundTracker', () => {
  it('reports the same window and non-elevated state after capture', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    expect(tracker.isAvailable()).toBe(true)
    tracker.capture()
    expect(tracker.check()).toEqual({ sameWindow: true, elevated: false })
  })

  it('detects that focus moved to another window', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    state.foreground = 777n
    expect(tracker.check()).toEqual({ sameWindow: false, elevated: false })
  })

  it('detects an elevated foreground window', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    state.elevated = true
    expect(tracker.check()).toEqual({ sameWindow: true, elevated: true })
  })

  it('degrades to null when the foreground query fails', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    state.failForeground = true
    expect(tracker.check()).toBeNull()
  })

  it('treats a failed elevation lookup as unknown', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    state.failElevation = true
    expect(tracker.check()).toBeNull()
  })

  it('clears the target on clear()', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    tracker.clear()
    expect(tracker.check()).toEqual({ sameWindow: false, elevated: false })
  })

  it('degrades gracefully when the loader fails entirely', () => {
    const tracker = new ForegroundTracker(() => null)
    expect(tracker.isAvailable()).toBe(false)
    tracker.capture()
    expect(tracker.check()).toBeNull()
  })

  it('degrades gracefully when the loader throws', () => {
    const tracker = new ForegroundTracker(() => {
      throw new Error('cannot load')
    })
    expect(tracker.isAvailable()).toBe(false)
    expect(tracker.check()).toBeNull()
  })
})
