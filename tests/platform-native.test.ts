import { describe, expect, it } from 'vitest'
import { MacTargetTracker, loadMacBindings } from '../src/main/platform/macos-native'
import { X11TargetTracker, loadX11Bindings } from '../src/main/platform/linux-native'
import { addressOf, handleOf } from '../src/main/platform/native-address'

/**
 * The native trackers cannot be loaded off their own platform, so the koffi
 * library is faked — but faked the way koffi really behaves: pointers come
 * back as opaque objects that throw when coerced. A fake that returned plain
 * numbers is precisely what hid the Windows defect that silently disabled
 * automatic paste for a whole release, so it is not repeated here.
 */
class FakePointer {
  constructor(readonly at: bigint) {}
  [Symbol.toPrimitive](): never {
    throw new TypeError('Cannot convert object to primitive value')
  }
}

const address = (pointer: unknown): bigint => {
  if (pointer instanceof FakePointer) return pointer.at
  throw new TypeError('not a pointer')
}

describe('addressOf', () => {
  it('reads the address out of an opaque pointer', () => {
    expect(addressOf({ address }, new FakePointer(0x2a0n))).toBe(0x2a0n)
  })

  it('treats a null pointer, a zero and a missing value as unknown', () => {
    expect(addressOf({ address }, new FakePointer(0n))).toBeNull()
    expect(addressOf({ address }, 0)).toBeNull()
    expect(addressOf({ address }, 0n)).toBeNull()
    expect(addressOf({ address }, null)).toBeNull()
    expect(addressOf({ address }, undefined)).toBeNull()
  })

  it('keeps an exact numeric handle but refuses a lossy one', () => {
    expect(addressOf({ address }, 4242)).toBe(4242n)
    expect(addressOf({ address }, Number.MAX_SAFE_INTEGER + 2)).toBeNull()
  })

  it('treats a failed conversion as unknown rather than guessing', () => {
    const throwing = {
      address: (): never => {
        throw new TypeError('not a pointer')
      }
    }
    expect(addressOf(throwing, new FakePointer(1n))).toBeNull()
  })

  it('keeps the original value alongside the address', () => {
    const pointer = new FakePointer(9n)
    expect(handleOf({ address }, pointer)).toEqual({ value: pointer, address: 9n })
    expect(handleOf({ address }, null)).toBeNull()
  })
})

// --- macOS ----------------------------------------------------------------

interface MacFakeState {
  classMissing: boolean
  workspaceNil: boolean
  frontmostNil: boolean
  pid: number
  secureInput: number
  accessibility: number
  inputMonitoring: number
  missingSymbols: string[]
  requests: number
  loaded: string[]
}

function macKoffi(state: MacFakeState): typeof import('koffi') {
  const selectors = new Map<string, FakePointer>()
  const selectorFor = (name: string): FakePointer => {
    const existing = selectors.get(name)
    if (existing) return existing
    const pointer = new FakePointer(BigInt(selectors.size + 100))
    selectors.set(name, pointer)
    return pointer
  }
  const nameOf = (pointer: unknown): string => {
    for (const [name, value] of selectors) if (value === pointer) return name
    return ''
  }

  const flagValue = (signature: string): number | null => {
    if (signature.includes('IsSecureEventInputEnabled')) return state.secureInput
    if (signature.includes('AXIsProcessTrusted')) return state.accessibility
    if (signature.includes('CGPreflightListenEventAccess')) return state.inputMonitoring
    return null
  }

  const makeLibrary = (path: string) => {
    state.loaded.push(path)
    return {
      func: (first: string, result?: string, args?: string[]) => {
        // koffi's alternative syntax, used for objc_msgSend so each return
        // shape gets its own exact prototype.
        if (result !== undefined && args !== undefined) {
          if (result === 'void *') {
            return (self: unknown, selector: unknown): unknown => {
              const name = nameOf(selector)
              if (name === 'sharedWorkspace') {
                return state.workspaceNil ? null : new FakePointer(0x10n)
              }
              if (name === 'frontmostApplication') {
                return state.frontmostNil ? null : new FakePointer(0x20n)
              }
              void self
              return null
            }
          }
          return (): number => state.pid
        }

        if (state.missingSymbols.some((symbol) => first.includes(symbol))) {
          throw new Error(`symbol not found: ${first}`)
        }
        if (first.includes('objc_getClass')) {
          return (name: string): unknown =>
            state.classMissing || name !== 'NSWorkspace' ? null : new FakePointer(0x1n)
        }
        if (first.includes('sel_registerName')) return (name: string): unknown => selectorFor(name)
        if (first.includes('CGRequestListenEventAccess')) {
          return (): number => {
            state.requests += 1
            return 1
          }
        }
        const flag = flagValue(first)
        if (flag !== null) return (): number => flag
        throw new Error(`unexpected prototype: ${first}`)
      }
    }
  }

  return { load: makeLibrary, address } as unknown as typeof import('koffi')
}

function macState(overrides: Partial<MacFakeState> = {}): MacFakeState {
  return {
    classMissing: false,
    workspaceNil: false,
    frontmostNil: false,
    pid: 501,
    secureInput: 0,
    accessibility: 1,
    inputMonitoring: 1,
    missingSymbols: [],
    requests: 0,
    loaded: [],
    ...overrides
  }
}

describe('macOS bindings', () => {
  it('walks NSWorkspace to the frontmost application id', () => {
    const state = macState()
    const bindings = loadMacBindings(() => macKoffi(state))
    expect(bindings?.frontmostPid()).toBe(501)
    expect(state.loaded).toContain('/usr/lib/libobjc.A.dylib')
  })

  it('reads the permission and secure-input flags as single bytes', () => {
    const bindings = loadMacBindings(() =>
      macKoffi(macState({ secureInput: 1, accessibility: 0, inputMonitoring: 0 }))
    )
    expect(bindings?.secureInputEnabled()).toBe(true)
    expect(bindings?.accessibilityTrusted()).toBe(false)
    expect(bindings?.inputMonitoringGranted()).toBe(false)
  })

  it('reports unknown for a symbol this macOS version does not have', () => {
    const bindings = loadMacBindings(() =>
      macKoffi(macState({ missingSymbols: ['CGPreflightListenEventAccess'] }))
    )
    expect(bindings?.inputMonitoringGranted()).toBeNull()
    // The rest of the adapter must survive the missing symbol.
    expect(bindings?.frontmostPid()).toBe(501)
  })

  it('reports no frontmost application rather than a bogus process id', () => {
    expect(loadMacBindings(() => macKoffi(macState({ frontmostNil: true })))?.frontmostPid()).toBeNull()
    expect(loadMacBindings(() => macKoffi(macState({ workspaceNil: true })))?.frontmostPid()).toBeNull()
    expect(loadMacBindings(() => macKoffi(macState({ classMissing: true })))?.frontmostPid()).toBeNull()
    expect(loadMacBindings(() => macKoffi(macState({ pid: 0 })))?.frontmostPid()).toBeNull()
  })

  it('gives up entirely when koffi itself is unavailable', () => {
    expect(loadMacBindings(() => null)).toBeNull()
    expect(
      loadMacBindings(() => {
        throw new Error('no koffi')
      })
    ).toBeNull()
  })

  it('asks macOS for the Input Monitoring prompt at most as often as told', () => {
    const state = macState()
    loadMacBindings(() => macKoffi(state))?.requestInputMonitoring()
    expect(state.requests).toBe(1)
  })
})

describe('MacTargetTracker', () => {
  it('is unavailable, and unknown, without bindings', () => {
    const tracker = new MacTargetTracker(null)
    expect(tracker.isAvailable()).toBe(false)
    tracker.capture()
    expect(tracker.check()).toBeNull()
  })

  it('notices the frontmost application changing', () => {
    const front = { pid: 501 as number | null }
    const tracker = new MacTargetTracker({
      frontmostPid: () => front.pid,
      secureInputEnabled: () => false,
      accessibilityTrusted: () => true,
      inputMonitoringGranted: () => true,
      requestInputMonitoring: () => {}
    })
    tracker.capture()
    expect(tracker.check()?.sameWindow).toBe(true)
    front.pid = 777
    expect(tracker.check()?.sameWindow).toBe(false)
  })

  it('reports unknown when either half of the answer is missing', () => {
    const missingPid = new MacTargetTracker({
      frontmostPid: () => null,
      secureInputEnabled: () => false,
      accessibilityTrusted: () => true,
      inputMonitoringGranted: () => true,
      requestInputMonitoring: () => {}
    })
    missingPid.capture()
    expect(missingPid.check()).toBeNull()

    const missingSecure = new MacTargetTracker({
      frontmostPid: () => 501,
      secureInputEnabled: () => null,
      accessibilityTrusted: () => true,
      inputMonitoringGranted: () => true,
      requestInputMonitoring: () => {}
    })
    missingSecure.capture()
    expect(missingSecure.check()).toBeNull()
  })

  it('says focus moved after clear(), without losing the barrier answer', () => {
    const tracker = new MacTargetTracker({
      frontmostPid: () => 501,
      secureInputEnabled: () => false,
      accessibilityTrusted: () => true,
      inputMonitoringGranted: () => true,
      requestInputMonitoring: () => {}
    })
    tracker.capture()
    tracker.clear()
    expect(tracker.check()).toEqual({
      sameWindow: false,
      elevated: false,
      blockedReason: 'macOS secure input is active'
    })
  })
})

// --- X11 ------------------------------------------------------------------

interface X11FakeState {
  displayOpens: boolean
  focus: unknown
  throwOnFocus: boolean
  libraryMissing: boolean
}

function x11Koffi(state: X11FakeState): typeof import('koffi') {
  return {
    load: (name: string) => {
      if (state.libraryMissing) throw new Error(`cannot open ${name}`)
      return {
        func: (signature: string) => {
          if (signature.includes('XOpenDisplay')) {
            return (): unknown => (state.displayOpens ? new FakePointer(0x99n) : null)
          }
          return (_display: unknown, focus: unknown[], revert: number[]): number => {
            if (state.throwOnFocus) throw new Error('X error')
            focus[0] = state.focus
            revert[0] = 1
            return 1
          }
        }
      }
    },
    address
  } as unknown as typeof import('koffi')
}

function x11State(overrides: Partial<X11FakeState> = {}): X11FakeState {
  return { displayOpens: true, focus: 0x4200, throwOnFocus: false, libraryMissing: false, ...overrides }
}

describe('X11 bindings', () => {
  it('reads the focused window id', () => {
    expect(loadX11Bindings(() => x11Koffi(x11State()))?.focusedWindow()).toBe(0x4200n)
  })

  it('accepts a 64-bit window id returned as a bigint', () => {
    const state = x11State({ focus: 0x7fff0000n })
    expect(loadX11Bindings(() => x11Koffi(state))?.focusedWindow()).toBe(0x7fff0000n)
  })

  it('treats None and PointerRoot as no window at all', () => {
    expect(loadX11Bindings(() => x11Koffi(x11State({ focus: 0 })))?.focusedWindow()).toBeNull()
    expect(loadX11Bindings(() => x11Koffi(x11State({ focus: 1 })))?.focusedWindow()).toBeNull()
  })

  it('reports unknown when the X call fails', () => {
    const bindings = loadX11Bindings(() => x11Koffi(x11State({ throwOnFocus: true })))
    expect(bindings?.focusedWindow()).toBeNull()
  })

  it('gives up when there is no display or no libX11', () => {
    expect(loadX11Bindings(() => x11Koffi(x11State({ displayOpens: false })))).toBeNull()
    expect(loadX11Bindings(() => x11Koffi(x11State({ libraryMissing: true })))).toBeNull()
    expect(loadX11Bindings(() => null)).toBeNull()
  })
})

describe('X11TargetTracker', () => {
  it('compares window ids, and never claims an elevation barrier X11 does not have', () => {
    const focus = { id: 0x4200n as bigint | null }
    const tracker = new X11TargetTracker({ focusedWindow: () => focus.id })
    tracker.capture()
    expect(tracker.check()).toEqual({ sameWindow: true, elevated: false })
    focus.id = 0x4300n
    expect(tracker.check()).toEqual({ sameWindow: false, elevated: false })
  })

  it('is unknown when the focused window cannot be named', () => {
    const tracker = new X11TargetTracker({ focusedWindow: () => null })
    tracker.capture()
    expect(tracker.check()).toBeNull()
  })

  it('is unavailable without bindings', () => {
    const tracker = new X11TargetTracker(null)
    expect(tracker.isAvailable()).toBe(false)
    tracker.capture()
    tracker.clear()
    expect(tracker.check()).toBeNull()
  })
})
