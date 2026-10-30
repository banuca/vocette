import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REFRESH_INTERVAL_MS,
  StartupTaskSwitch,
  createStartupTask,
  hresultText,
  startupTaskState,
  type StartupTaskApi,
  type StartupTaskState
} from '../src/main/platform/startup-task'

/**
 * The Store build's "Start with Windows" goes through Windows' StartupTask
 * API. The real calls only work inside an installed package, which CI proves
 * (scripts/store-smoke.ps1); here a fake koffi stands in for COM so that the
 * call order, the polling and the releasing are all checked, and the switch
 * is checked against a fake API.
 */

describe('startupTaskState', () => {
  it("names Windows' values in their documented order", () => {
    expect([0, 1, 2, 3, 4].map(startupTaskState)).toEqual([
      'disabled',
      'disabled-by-user',
      'enabled',
      'disabled-by-policy',
      'enabled-by-policy'
    ])
  })

  it('refuses anything Windows does not define', () => {
    expect(startupTaskState(5)).toBeNull()
    expect(startupTaskState(-1)).toBeNull()
    expect(startupTaskState(1.5)).toBeNull()
  })
})

describe('hresultText', () => {
  it('prints an HRESULT the way Windows documents it', () => {
    expect(hresultText(0x80073d54 | 0)).toBe('0x80073D54')
    expect(hresultText(0)).toBe('0x00000000')
  })
})

// ---------------------------------------------------------------------------
// A fake koffi that plays the part of COM.
// ---------------------------------------------------------------------------

type Method = (self: FakeObject, ...args: unknown[]) => number

interface FakeObject {
  name: string
  refs: number
  vtable: Method[]
}

const S_OK = 0
const E_NOT_FOUND = 0x80070490 | 0
const CO_E_NOTINITIALIZED = 0x800401f0 | 0
const ASYNC = { started: 0, completed: 1, error: 3 }

interface Scenario {
  /** HRESULTs RoGetActivationFactory answers with, in turn; S_OK after. */
  activation: number[]
  /** GetAsync's own HRESULT. */
  getAsync: number
  /** Polls before an async operation reports its final status. */
  pollsBeforeDone: number
  /** The final status of GetAsync's operation, and its error code. */
  getAsyncStatus: number
  getAsyncError: number
  /** Whether GetAsync's results include a task. */
  taskFound: boolean
  /** The task's state, as Windows numbers it. */
  taskState: number
  /** The state RequestEnableAsync ends in. */
  enableResult: number
}

let scenario: Scenario
let objects: FakeObject[]
let calls: string[]
let strings: { created: string[]; deleted: string[] }
let initialized: number[]

function object(name: string, methods: Record<number, Method>): FakeObject {
  const vtable: Method[] = []
  vtable[0] = (self, iid, out) => {
    calls.push(`${self.name}.QueryInterface`)
    const data1 = (iid as { Data1: number }).Data1
    if (data1 !== 0x00000036) return 0x80004002 | 0 // E_NOINTERFACE
    ;(out as unknown[])[0] = asyncInfo(self)
    return S_OK
  }
  vtable[1] = (self) => ++self.refs
  vtable[2] = (self) => {
    calls.push(`${self.name}.Release`)
    return --self.refs
  }
  for (const [slot, method] of Object.entries(methods)) vtable[Number(slot)] = method
  const created = { name, refs: 1, vtable }
  objects.push(created)
  return created
}

/** IAsyncInfo for an operation: Started for a few polls, then its final status. */
function asyncInfo(operation: FakeObject): FakeObject {
  const final = operation.name === 'GetAsyncOperation' ? scenario.getAsyncStatus : ASYNC.completed
  let polls = 0
  return object(`${operation.name}.Info`, {
    7: (self, out) => {
      polls += 1
      ;(out as number[])[0] = polls > scenario.pollsBeforeDone ? final : ASYNC.started
      return S_OK
    },
    8: (self, out) => {
      ;(out as number[])[0] = scenario.getAsyncError
      return S_OK
    },
    9: () => S_OK
  })
}

function task(): FakeObject {
  return object('StartupTask', {
    6: (self, out) => {
      calls.push('StartupTask.RequestEnableAsync')
      ;(out as unknown[])[0] = object('RequestEnableOperation', {
        8: (op, value) => {
          calls.push('RequestEnableOperation.GetResults')
          ;(value as number[])[0] = scenario.enableResult
          scenario.taskState = scenario.enableResult
          return S_OK
        }
      })
      return S_OK
    },
    7: () => {
      calls.push('StartupTask.Disable')
      scenario.taskState = 0
      return S_OK
    },
    8: (self, value) => {
      calls.push('StartupTask.get_State')
      ;(value as number[])[0] = scenario.taskState
      return S_OK
    }
  })
}

function statics(): FakeObject {
  return object('StartupTaskStatics', {
    7: (self, taskId, out) => {
      calls.push(`StartupTaskStatics.GetAsync(${(taskId as { text: string }).text})`)
      if (scenario.getAsync !== S_OK) return scenario.getAsync
      ;(out as unknown[])[0] = object('GetAsyncOperation', {
        8: (op, result) => {
          calls.push('GetAsyncOperation.GetResults')
          ;(result as unknown[])[0] = scenario.taskFound ? task() : null
          return S_OK
        }
      })
      return S_OK
    }
  })
}

function nameOf(definition: string): string {
  return /(\w+)\s*\(/u.exec(definition)?.[1] ?? definition
}

function fakeKoffi(): typeof import('koffi') {
  const functions: Record<string, (...args: never[]) => number> = {
    WindowsCreateString: ((text: string, length: number, out: unknown[]) => {
      expect(length).toBe(text.length)
      strings.created.push(text)
      out[0] = { text }
      return S_OK
    }) as never,
    WindowsDeleteString: ((handle: { text: string }) => {
      strings.deleted.push(handle.text)
      return S_OK
    }) as never,
    RoGetActivationFactory: ((name: { text: string }, iid: { Data1: number }, out: unknown[]) => {
      calls.push(`RoGetActivationFactory(${name.text})`)
      expect(iid.Data1).toBe(0xee5b60bd)
      const answer = scenario.activation.shift() ?? S_OK
      if (answer !== S_OK) return answer
      out[0] = statics()
      return S_OK
    }) as never,
    RoInitialize: ((type: number) => {
      initialized.push(type)
      return S_OK
    }) as never
  }
  const fake = {
    load: () => ({
      func: (definition: string) => {
        const fn = functions[nameOf(definition)]
        if (!fn) throw new Error(`unexpected function ${definition}`)
        return fn
      }
    }),
    struct: () => ({}),
    array: () => ({}),
    sizeof: () => 8,
    proto: (definition: string) => ({ proto: nameOf(definition) }),
    decode: (value: unknown, offsetOrType: unknown) => {
      if (typeof offsetOrType === 'number') {
        const method = (value as Method[])[offsetOrType / 8]
        if (!method) throw new Error(`no method at slot ${offsetOrType / 8}`)
        return method
      }
      return (value as FakeObject).vtable
    },
    call: (method: Method, _proto: unknown, self: FakeObject, ...args: unknown[]) => method(self, ...args)
  }
  return fake as unknown as typeof import('koffi')
}

function leaked(): string[] {
  return objects.filter((entry) => entry.refs !== 0).map((entry) => `${entry.name} (${entry.refs})`)
}

describe('createStartupTask (the COM calls)', () => {
  beforeEach(() => {
    scenario = {
      activation: [],
      getAsync: S_OK,
      pollsBeforeDone: 2,
      getAsyncStatus: ASYNC.completed,
      getAsyncError: 0,
      taskFound: true,
      taskState: 0,
      enableResult: 2
    }
    objects = []
    calls = []
    strings = { created: [], deleted: [] }
    initialized = []
  })

  const api = (): StartupTaskApi => {
    const created = createStartupTask('VocetteStartup', fakeKoffi)
    if (!created) throw new Error('expected an API')
    return created
  }

  it('enables the task and reports the state Windows granted, releasing everything', async () => {
    await expect(api().enable()).resolves.toBe('enabled')
    expect(calls).toContain('StartupTaskStatics.GetAsync(VocetteStartup)')
    expect(calls).toContain('StartupTask.RequestEnableAsync')
    expect(leaked()).toEqual([])
    expect(strings.deleted.sort()).toEqual(strings.created.sort())
  })

  it('reports what Windows allowed, not what was asked for', async () => {
    scenario.enableResult = 1
    await expect(api().enable()).resolves.toBe('disabled-by-user')
  })

  it('disables the task and reads its state back', async () => {
    scenario.taskState = 2
    await expect(api().disable()).resolves.toBe('disabled')
    expect(calls.indexOf('StartupTask.Disable')).toBeLessThan(calls.indexOf('StartupTask.get_State'))
    expect(leaked()).toEqual([])
  })

  it('reads the state', async () => {
    scenario.taskState = 4
    await expect(api().state()).resolves.toBe('enabled-by-policy')
    expect(calls).not.toContain('StartupTask.RequestEnableAsync')
    expect(calls).not.toContain('StartupTask.Disable')
  })

  it('rejects with the HRESULT when Windows refuses outright, and leaks nothing', async () => {
    scenario.getAsync = E_NOT_FOUND
    await expect(api().state()).rejects.toThrow('StartupTask.GetAsync failed with 0x80070490')
    expect(leaked()).toEqual([])
    expect(strings.deleted.sort()).toEqual(strings.created.sort())
  })

  it('rejects with the error an operation finished with', async () => {
    scenario.getAsyncStatus = ASYNC.error
    scenario.getAsyncError = 0x80073d54 | 0
    await expect(api().enable()).rejects.toThrow('0x80073D54')
    expect(calls).not.toContain('StartupTask.RequestEnableAsync')
    expect(leaked()).toEqual([])
  })

  it('says so when the package declares no such task', async () => {
    scenario.taskFound = false
    await expect(api().state()).rejects.toThrow('declares no startup task called VocetteStartup')
    expect(leaked()).toEqual([])
  })

  it('initialises the thread for WinRT only when Windows says it is not', async () => {
    scenario.activation = [CO_E_NOTINITIALIZED]
    await expect(api().state()).resolves.toBe('disabled')
    expect(initialized).toEqual([0])
    await api().state()
    expect(initialized).toEqual([0])
  })

  it('is absent where koffi cannot load', () => {
    expect(createStartupTask('VocetteStartup', () => null)).toBeNull()
    expect(
      createStartupTask('VocetteStartup', () => {
        throw new Error('no koffi here')
      })
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The switch.
// ---------------------------------------------------------------------------

function fakeApi(initial: StartupTaskState = 'disabled') {
  let state = initial
  let gate: Promise<void> = Promise.resolve()
  const api = {
    calls: [] as string[],
    /** What enabling ends in; Windows may refuse. */
    enableTo: 'enabled' as StartupTaskState,
    fail: null as Error | null,
    hold(): () => void {
      let open!: () => void
      gate = new Promise((resolve) => (open = resolve))
      return open
    },
    setState(next: StartupTaskState) {
      state = next
    },
    async state() {
      api.calls.push('state')
      await gate
      if (api.fail) throw api.fail
      return state
    },
    async enable() {
      api.calls.push('enable')
      await gate
      if (api.fail) throw api.fail
      state = api.enableTo
      return state
    },
    async disable() {
      api.calls.push('disable')
      await gate
      if (api.fail) throw api.fail
      state = 'disabled'
      return state
    }
  }
  return api
}

describe('StartupTaskSwitch', () => {
  let changes: number
  let logged: string[]
  let now: number

  const make = (api: StartupTaskApi | null) =>
    new StartupTaskSwitch(api, {
      onChange: () => (changes += 1),
      log: (message) => logged.push(message),
      now: () => now
    })

  beforeEach(() => {
    changes = 0
    logged = []
    now = 1_000_000
  })

  it('applies the choice and keeps the toggle available', async () => {
    const api = fakeApi()
    const toggle = make(api)
    await toggle.set(true)
    expect(api.calls).toEqual(['enable'])
    expect(toggle.current()).toBe('enabled')
    expect(toggle.capability().state).toBe('available')
    expect(changes).toBe(1)
  })

  it('applies only the newest of choices made together', async () => {
    const api = fakeApi()
    const toggle = make(api)
    void toggle.set(true)
    await toggle.set(false)
    expect(api.calls).toEqual(['disable'])
    expect(toggle.current()).toBe('disabled')
  })

  it('applies a choice made during a change once that change is done', async () => {
    const api = fakeApi()
    const toggle = make(api)
    const open = api.hold()
    const first = toggle.set(true)
    await Promise.resolve()
    await Promise.resolve()
    const second = toggle.set(false)
    open()
    await Promise.all([first, second])
    expect(api.calls).toEqual(['enable', 'disable'])
    expect(toggle.current()).toBe('disabled')
  })

  it('says how to turn it back on when the user turned it off in Windows', async () => {
    const api = fakeApi('disabled-by-user')
    api.enableTo = 'disabled-by-user'
    const toggle = make(api)
    await toggle.set(true)
    const capability = toggle.capability()
    expect(capability.state).toBe('unavailable')
    expect(capability.reason).toContain('Settings → Apps → Startup')
  })

  it("names the organisation's policy either way", async () => {
    const off = fakeApi()
    off.enableTo = 'disabled-by-policy'
    const offToggle = make(off)
    await offToggle.set(true)
    expect(offToggle.capability().reason).toContain("organisation doesn't allow")

    const on = fakeApi('enabled-by-policy')
    const onToggle = make(on)
    onToggle.refresh()
    await vi.waitFor(() => expect(onToggle.current()).toBe('enabled-by-policy'))
    expect(onToggle.capability().reason).toContain('organisation starts Vocette')
  })

  it('reports a failure in words, logs it, and recovers on the next answer', async () => {
    const api = fakeApi()
    api.fail = new Error('StartupTask.GetAsync failed with 0x80070490')
    const toggle = make(api)
    await toggle.set(true)
    expect(toggle.capability()).toMatchObject({ state: 'unavailable' })
    expect(toggle.capability().reason).toContain("Windows didn't accept the change")
    expect(logged[0]).toContain('0x80070490')

    api.fail = null
    await toggle.set(true)
    expect(toggle.capability().state).toBe('available')
  })

  it('cannot do anything without the API, and says where to go instead', async () => {
    const toggle = make(null)
    await expect(toggle.set(true)).resolves.toBeUndefined()
    expect(toggle.capability().state).toBe('unavailable')
    expect(toggle.capability().reason).toContain('Settings → Apps → Startup')
  })

  it('asks Windows again at most every few seconds, and only says so on a change', async () => {
    const api = fakeApi()
    const toggle = make(api)
    await toggle.set(true)
    changes = 0
    api.calls.length = 0

    toggle.refresh()
    await vi.waitFor(() => expect(api.calls).toEqual([]))

    now += REFRESH_INTERVAL_MS
    toggle.refresh()
    toggle.refresh()
    await vi.waitFor(() => expect(api.calls).toEqual(['state']))
    expect(changes).toBe(0)

    // The user turns it off in Settings while Vocette runs.
    api.setState('disabled-by-user')
    now += REFRESH_INTERVAL_MS
    toggle.refresh()
    await vi.waitFor(() => expect(changes).toBe(1))
    expect(toggle.capability().state).toBe('unavailable')
  })

  it('does not read the state while a change is waiting to be applied', async () => {
    const api = fakeApi()
    const toggle = make(api)
    const pending = toggle.set(true)
    now += REFRESH_INTERVAL_MS
    toggle.refresh()
    await pending
    expect(api.calls).toEqual(['enable'])
  })
})
