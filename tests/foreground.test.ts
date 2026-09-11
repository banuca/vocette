import { beforeEach, describe, expect, it } from 'vitest'
import { ForegroundTracker } from '../src/main/foreground'

/**
 * The Win32 calls come from koffi, which cannot load outside the app. The
 * tracker takes an injectable loader, so tests feed it a fake library and
 * still exercise every branch — including graceful degradation.
 *
 * The fake returns **opaque pointer objects**, as koffi 2.16.3 really does.
 * The previous fake returned bigints, which hid a defect that made auto-paste
 * impossible on every machine: the tracker accepted only bigint/number
 * handles, so every real pointer was discarded and focus was always "unknown".
 */

/**
 * Stands in for a koffi external pointer: opaque, and it throws on any attempt
 * to coerce it to a primitive, exactly as the real one does.
 */
class FakePointer {
  constructor(readonly at: bigint) {}
  [Symbol.toPrimitive](): never {
    throw new TypeError('Cannot convert object to primitive value')
  }
}

interface FakeState {
  /** Address of the focused window, or null for "no foreground window". */
  foreground: bigint | null
  elevated: boolean
  openProcessFails: boolean
  openTokenFails: boolean
  tokenInfoFails: boolean
  threadIdFails: boolean
  /** Makes koffi.address() throw, as it does for a non-pointer argument. */
  addressThrows: boolean
  /** Hands back plain numbers instead of pointers, for the numeric path. */
  numericHandles: boolean
  /** A number too large to survive as a double, which must be rejected. */
  lossyNumericHandles: boolean
  closed: bigint[]
  declarations: string[]
}

let state: FakeState

function handleFor(address: bigint): unknown {
  if (state.lossyNumericHandles) return Number.MAX_SAFE_INTEGER + 2
  if (state.numericHandles) return Number(address)
  // A fresh wrapper every call, like the real binding.
  return new FakePointer(address)
}

const PROCESS_HANDLE = 111n
const TOKEN_HANDLE = 222n

function fakeLoader(): typeof import('koffi') {
  const record = (definition: string) => state.declarations.push(definition)

  const makeLib = (name: string) => {
    if (name === 'user32.dll') {
      return {
        func: (definition: string) => {
          record(definition)
          if (definition.includes('GetForegroundWindow')) {
            return () => (state.foreground === null ? null : handleFor(state.foreground))
          }
          return (hwnd: unknown, out: [number]) => {
            if (!hwnd || state.threadIdFails) return 0
            out[0] = 4242
            return 1
          }
        }
      }
    }
    if (name === 'kernel32.dll') {
      return {
        func: (definition: string) => {
          record(definition)
          if (definition.includes('OpenProcess')) {
            return () => (state.openProcessFails ? null : handleFor(PROCESS_HANDLE))
          }
          return (handle: unknown) => {
            state.closed.push(addressOf(handle))
            return 1
          }
        }
      }
    }
    return {
      func: (definition: string) => {
        record(definition)
        if (definition.includes('OpenProcessToken')) {
          return (_process: unknown, _access: number, out: [unknown]) => {
            if (state.openTokenFails) return 0
            out[0] = handleFor(TOKEN_HANDLE)
            return 1
          }
        }
        return (_token: unknown, _cls: number, out: [number]) => {
          if (state.tokenInfoFails) return 0
          out[0] = state.elevated ? 1 : 0
          return 1
        }
      }
    }
  }

  const address = (pointer: unknown): bigint => {
    if (state.addressThrows) throw new TypeError('not a pointer')
    if (pointer instanceof FakePointer) return pointer.at
    throw new TypeError('not a pointer')
  }

  return { load: makeLib, address } as unknown as typeof import('koffi')
}

/** Test-side helper for asserting which handles were closed. */
function addressOf(handle: unknown): bigint {
  if (handle instanceof FakePointer) return handle.at
  if (typeof handle === 'number') return BigInt(handle)
  if (typeof handle === 'bigint') return handle
  return -1n
}

beforeEach(() => {
  state = {
    foreground: 100n,
    elevated: false,
    openProcessFails: false,
    openTokenFails: false,
    tokenInfoFails: false,
    threadIdFails: false,
    addressThrows: false,
    numericHandles: false,
    lossyNumericHandles: false,
    closed: [],
    declarations: []
  }
})

describe('ForegroundTracker', () => {
  it('reports the same window and non-elevated state after capture', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    expect(tracker.isAvailable()).toBe(true)
    tracker.capture()
    expect(tracker.check()).toEqual({ sameWindow: true, elevated: false })
  })

  it('treats two different pointer objects for one window as the same window', () => {
    // The regression that broke auto-paste: koffi returns a new wrapper each
    // call, so comparing the objects themselves always says "focus moved".
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    const first = handleFor(100n)
    const second = handleFor(100n)
    expect(first).not.toBe(second)

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

  it('still accepts plain numeric handles without truncating them', () => {
    state.numericHandles = true
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    expect(tracker.check()).toEqual({ sameWindow: true, elevated: false })
  })

  it('refuses a numeric handle that cannot be represented exactly', () => {
    // Silently truncating would hand Win32 a different window.
    state.lossyNumericHandles = true
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    expect(tracker.check()).toBeNull()
  })

  it('treats a missing foreground window as unknown', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    state.foreground = null
    expect(tracker.check()).toBeNull()
  })

  it('treats a failed address conversion as unknown', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    state.addressThrows = true
    expect(tracker.check()).toBeNull()
  })

  it('treats a failed process-id lookup as unknown', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    state.threadIdFails = true
    expect(tracker.check()).toBeNull()
  })

  it('treats a failed OpenProcess as unknown', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    state.openProcessFails = true
    expect(tracker.check()).toBeNull()
  })

  it('treats a failed OpenProcessToken as unknown', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    state.openTokenFails = true
    expect(tracker.check()).toBeNull()
  })

  it('treats a failed GetTokenInformation as unknown', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    state.tokenInfoFails = true
    expect(tracker.check()).toBeNull()
  })

  it('closes the process and token handles on success', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    state.closed = []
    tracker.check()
    expect(state.closed).toEqual([TOKEN_HANDLE, PROCESS_HANDLE])
  })

  it('closes both handles when the elevation query fails', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    state.tokenInfoFails = true
    state.closed = []
    expect(tracker.check()).toBeNull()
    expect(state.closed).toEqual([TOKEN_HANDLE, PROCESS_HANDLE])
  })

  it('closes the process handle when the token cannot be opened', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    state.openTokenFails = true
    state.closed = []
    expect(tracker.check()).toBeNull()
    expect(state.closed).toEqual([PROCESS_HANDLE])
  })

  it('closes nothing when the process cannot be opened', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    state.openProcessFails = true
    state.closed = []
    expect(tracker.check()).toBeNull()
    expect(state.closed).toEqual([])
  })

  it('declares the Win32 call chain with the right ABI', () => {
    // The original defect was a marshalling mismatch, not logic: BOOL is a
    // 32-bit int and PHANDLE is a pointer to a handle.
    new ForegroundTracker(fakeLoader)
    const declarations = state.declarations.join('\n')
    expect(declarations).toContain(
      'int OpenProcessToken(void *ProcessHandle, uint32 DesiredAccess, _Out_ void **TokenHandle)'
    )
    expect(declarations).toContain('int CloseHandle(void *hObject)')
    expect(declarations).toContain('int bInheritHandle')
    expect(declarations).toContain('int GetTokenInformation(')
    // `bool` would marshal a single byte where Win32 returns four.
    expect(declarations).not.toMatch(/\bbool\b/u)
  })

  it('clears the target on clear()', () => {
    const tracker = new ForegroundTracker(fakeLoader)
    tracker.capture()
    tracker.clear()
    expect(tracker.check()).toEqual({ sameWindow: false, elevated: false })
  })

  it('reports focus as moved when nothing was captured', () => {
    const tracker = new ForegroundTracker(fakeLoader)
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
