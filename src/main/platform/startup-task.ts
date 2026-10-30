import { available, unavailable, type Capability } from '../../shared/capabilities'

/**
 * Starting with Windows, in the Microsoft Store build.
 *
 * The installer build writes the usual Run key. A packaged (MSIX) app can't:
 * Windows keeps everything a packaged app writes under HKEY_CURRENT_USER in a
 * private copy, which sign-in never reads. So the Store package declares a
 * startup task in its manifest (resources/appx-manifest.xml, off until asked
 * for), and the app switches it with Windows' StartupTask API, reached through
 * koffi like the other Win32 calls.
 *
 * The user has the last word: a task they turn off in Settings → Apps →
 * Startup can't be turned back on by the app, so the switch says so instead.
 */

/** Must match the TaskId in resources/appx-manifest.xml. */
export const STARTUP_TASK_ID = 'VocetteStartup'

export type StartupTaskState =
  | 'disabled'
  | 'disabled-by-user'
  | 'enabled'
  | 'disabled-by-policy'
  | 'enabled-by-policy'

/** Windows.ApplicationModel.StartupTaskState, in its numeric order. */
const STATES: readonly StartupTaskState[] = [
  'disabled',
  'disabled-by-user',
  'enabled',
  'disabled-by-policy',
  'enabled-by-policy'
]

/** The state for Windows' number; null for anything it doesn't define. */
export function startupTaskState(value: number): StartupTaskState | null {
  return Number.isInteger(value) ? (STATES[value] ?? null) : null
}

/** An HRESULT the way Windows documents it, e.g. 0x80073D54. */
export function hresultText(code: number): string {
  return `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
}

/** Windows' StartupTask API for one task, behind an interface so the switch can be tested. */
export interface StartupTaskApi {
  state(): Promise<StartupTaskState>
  /** Asks for the task to be on, and says what Windows allowed. */
  enable(): Promise<StartupTaskState>
  disable(): Promise<StartupTaskState>
}

// ---------------------------------------------------------------------------
// The native binding: WinRT through raw COM calls.
// ---------------------------------------------------------------------------

type Koffi = typeof import('koffi')
type KoffiType = ReturnType<Koffi['proto']>
export type KoffiLoader = () => Koffi | null

function defaultKoffiLoader(): Koffi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('koffi') as Koffi
  } catch {
    return null
  }
}

const STARTUP_TASK_CLASS = 'Windows.ApplicationModel.StartupTask'
const IID_STARTUP_TASK_STATICS = 'ee5b60bd-a148-41a7-b26e-e8b88a1e62f8'
const IID_ASYNC_INFO = '00000036-0000-0000-c000-000000000046'

/**
 * Vtable slots. IUnknown takes 0–2 and IInspectable 3–5, so every WinRT
 * interface's own methods start at 6, in the order its metadata lists them
 * (checked against Windows.ApplicationModel.winmd and Windows.Foundation.winmd).
 */
const SLOT = {
  queryInterface: 0,
  release: 2,
  /** IStartupTaskStatics: GetForCurrentPackageAsync is 6. */
  getAsync: 7,
  /** IStartupTask. */
  requestEnableAsync: 6,
  disable: 7,
  getState: 8,
  /** IAsyncInfo: get_Id is 6. */
  getStatus: 7,
  getErrorCode: 8,
  cancel: 9,
  /** IAsyncOperation<T>: put_Completed is 6, get_Completed 7. */
  getResults: 8
} as const

/** Windows.Foundation.AsyncStatus. */
const ASYNC_COMPLETED = 1
const ASYNC_CANCELED = 2
const ASYNC_ERROR = 3

const S_OK = 0
const CO_E_NOTINITIALIZED = 0x800401f0 | 0
const RO_INIT_SINGLETHREADED = 0
/** Windows answers in milliseconds; this only stops a wedged call holding the switch forever. */
const OPERATION_TIMEOUT_MS = 10_000
const POLL_MS = 10

class WinRtError extends Error {
  constructor(step: string, readonly code: number) {
    super(`${step} failed with ${hresultText(code)}`)
    this.name = 'WinRtError'
  }
}

interface Bindings {
  koffi: Koffi
  pointerBytes: number
  createString(text: string): unknown
  deleteString(handle: unknown): void
  getActivationFactory(name: unknown, iid: Record<string, unknown>, out: unknown[]): number
  initialize(type: number): number
  proto: {
    release: KoffiType
    queryInterface: KoffiType
    noArgs: KoffiType
    outPointer: KoffiType
    outInt: KoffiType
    getAsync: KoffiType
  }
}

/** One set of declarations per koffi instance: koffi refuses a type name twice. */
const bound = new WeakMap<Koffi, Bindings>()

function bind(koffi: Koffi): Bindings {
  const existing = bound.get(koffi)
  if (existing) return existing
  const combase = koffi.load('combase.dll')
  koffi.struct('VocetteGuid', {
    Data1: 'uint32',
    Data2: 'uint16',
    Data3: 'uint16',
    Data4: koffi.array('uint8', 8)
  })
  // HRESULT is a signed 32-bit int; failures are negative.
  const WindowsCreateString = combase.func(
    'int32 __stdcall WindowsCreateString(const char16_t *sourceString, uint32 length, _Out_ void **string)'
  )
  const WindowsDeleteString = combase.func('int32 __stdcall WindowsDeleteString(void *string)')
  const RoGetActivationFactory = combase.func(
    'int32 __stdcall RoGetActivationFactory(void *activatableClassId, VocetteGuid *iid, _Out_ void **factory)'
  )
  const RoInitialize = combase.func('int32 __stdcall RoInitialize(int32 initType)')
  const bindings: Bindings = {
    koffi,
    pointerBytes: koffi.sizeof('void *'),
    createString: (text) => {
      const out: unknown[] = [null]
      check('WindowsCreateString', WindowsCreateString(text, text.length, out) as number)
      return out[0]
    },
    deleteString: (handle) => {
      if (handle) WindowsDeleteString(handle)
    },
    getActivationFactory: (name, iid, out) => RoGetActivationFactory(name, iid, out) as number,
    initialize: (type) => RoInitialize(type) as number,
    proto: {
      release: koffi.proto('uint32 __stdcall VocetteComRelease(void *self)'),
      queryInterface: koffi.proto(
        'int32 __stdcall VocetteComQueryInterface(void *self, VocetteGuid *iid, _Out_ void **object)'
      ),
      noArgs: koffi.proto('int32 __stdcall VocetteComNoArgs(void *self)'),
      outPointer: koffi.proto('int32 __stdcall VocetteComOutPointer(void *self, _Out_ void **value)'),
      outInt: koffi.proto('int32 __stdcall VocetteComOutInt(void *self, _Out_ int32 *value)'),
      getAsync: koffi.proto(
        'int32 __stdcall VocetteStartupGetAsync(void *self, void *taskId, _Out_ void **operation)'
      )
    }
  }
  bound.set(koffi, bindings)
  return bindings
}

function check(step: string, hresult: number): void {
  if (hresult < S_OK) throw new WinRtError(step, hresult)
}

function guid(text: string): Record<string, unknown> {
  const hex = text.replace(/-/gu, '')
  return {
    Data1: Number.parseInt(hex.slice(0, 8), 16),
    Data2: Number.parseInt(hex.slice(8, 12), 16),
    Data3: Number.parseInt(hex.slice(12, 16), 16),
    Data4: Array.from({ length: 8 }, (_, index) =>
      Number.parseInt(hex.slice(16 + index * 2, 18 + index * 2), 16)
    )
  }
}

/** Calls a method through the object's vtable. */
function invoke(b: Bindings, object: unknown, slot: number, proto: KoffiType, ...args: unknown[]): number {
  const table: unknown = b.koffi.decode(object, 'void *')
  const method: unknown = b.koffi.decode(table, slot * b.pointerBytes, 'void *')
  return b.koffi.call(method, proto, object, ...args) as number
}

function release(b: Bindings, object: unknown): void {
  if (object) invoke(b, object, SLOT.release, b.proto.release)
}

function queryInterface(b: Bindings, object: unknown, iid: string): unknown {
  const out: unknown[] = [null]
  check('QueryInterface', invoke(b, object, SLOT.queryInterface, b.proto.queryInterface, guid(iid), out))
  return out[0]
}

function activationFactory(b: Bindings, runtimeClass: string, iid: string): unknown {
  const name = b.createString(runtimeClass)
  try {
    let out: unknown[] = [null]
    let hresult = b.getActivationFactory(name, guid(iid), out)
    if (hresult === CO_E_NOTINITIALIZED) {
      // Electron's main thread already is; a bare Node process (the local
      // probe) is not. Any answer leaves the thread usable for WinRT.
      b.initialize(RO_INIT_SINGLETHREADED)
      out = [null]
      hresult = b.getActivationFactory(name, guid(iid), out)
    }
    check(`RoGetActivationFactory(${runtimeClass})`, hresult)
    return out[0]
  } finally {
    b.deleteString(name)
  }
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Waits for a WinRT async operation by polling its status: a completion
 * handler would be a native callback into JavaScript from a Windows thread,
 * which koffi only allows on the main thread.
 */
async function finished(b: Bindings, operation: unknown, step: string): Promise<void> {
  const info = queryInterface(b, operation, IID_ASYNC_INFO)
  try {
    const startedAt = Date.now()
    for (;;) {
      const status = [0]
      check(`${step} status`, invoke(b, info, SLOT.getStatus, b.proto.outInt, status))
      if (status[0] === ASYNC_COMPLETED) return
      if (status[0] === ASYNC_ERROR || status[0] === ASYNC_CANCELED) {
        const code = [0]
        invoke(b, info, SLOT.getErrorCode, b.proto.outInt, code)
        throw new WinRtError(step, code[0] ?? -1)
      }
      if (Date.now() - startedAt > OPERATION_TIMEOUT_MS) {
        invoke(b, info, SLOT.cancel, b.proto.noArgs)
        throw new Error(`${step} did not finish within ${OPERATION_TIMEOUT_MS / 1000} seconds`)
      }
      await pause(POLL_MS)
    }
  } finally {
    release(b, info)
  }
}

function stateOf(b: Bindings, task: unknown): StartupTaskState {
  const value = [0]
  check('StartupTask.State', invoke(b, task, SLOT.getState, b.proto.outInt, value))
  const state = startupTaskState(value[0] ?? -1)
  if (!state) throw new Error(`StartupTask.State returned an unknown value, ${value[0]}`)
  return state
}

/** Finds the task by its id, hands it to `use`, and releases everything after. */
async function withTask<T>(
  b: Bindings,
  taskId: string,
  use: (task: unknown) => Promise<T> | T
): Promise<T> {
  let statics: unknown = null
  let operation: unknown = null
  let task: unknown = null
  try {
    statics = activationFactory(b, STARTUP_TASK_CLASS, IID_STARTUP_TASK_STATICS)
    const id = b.createString(taskId)
    try {
      const out: unknown[] = [null]
      check('StartupTask.GetAsync', invoke(b, statics, SLOT.getAsync, b.proto.getAsync, id, out))
      operation = out[0]
    } finally {
      b.deleteString(id)
    }
    await finished(b, operation, 'StartupTask.GetAsync')
    const result: unknown[] = [null]
    check('StartupTask.GetAsync results', invoke(b, operation, SLOT.getResults, b.proto.outPointer, result))
    task = result[0]
    if (!task) throw new Error(`The package declares no startup task called ${taskId}`)
    return await use(task)
  } finally {
    release(b, task)
    release(b, operation)
    release(b, statics)
  }
}

/**
 * The real StartupTask API for `taskId`, or null where it can't exist: not
 * Windows, or koffi didn't load. It only works with package identity: in an
 * unpackaged run every call rejects (with 0x80070490, element not found, on
 * Windows 11 24H2).
 */
export function createStartupTask(
  taskId: string = STARTUP_TASK_ID,
  loadKoffi: KoffiLoader = defaultKoffiLoader
): StartupTaskApi | null {
  let b: Bindings
  try {
    const koffi = loadKoffi()
    if (!koffi) return null
    b = bind(koffi)
  } catch {
    return null
  }
  return {
    state: () => withTask(b, taskId, (task) => stateOf(b, task)),
    enable: () =>
      withTask(b, taskId, async (task) => {
        const out: unknown[] = [null]
        check('StartupTask.RequestEnableAsync', invoke(b, task, SLOT.requestEnableAsync, b.proto.outPointer, out))
        const request = out[0]
        try {
          await finished(b, request, 'StartupTask.RequestEnableAsync')
          const value = [0]
          check(
            'StartupTask.RequestEnableAsync results',
            invoke(b, request, SLOT.getResults, b.proto.outInt, value)
          )
          return startupTaskState(value[0] ?? -1) ?? stateOf(b, task)
        } finally {
          release(b, request)
        }
      }),
    disable: () =>
      withTask(b, taskId, (task) => {
        check('StartupTask.Disable', invoke(b, task, SLOT.disable, b.proto.noArgs))
        return stateOf(b, task)
      })
  }
}

// ---------------------------------------------------------------------------
// The switch the app uses.
// ---------------------------------------------------------------------------

const UNREACHABLE =
  "Vocette can't reach Windows' startup settings. Turn it on or off in Settings → Apps → Startup."
const CHANGE_FAILED =
  "Windows didn't accept the change. Turn Vocette on or off in Settings → Apps → Startup."
const READ_FAILED =
  "Vocette couldn't read its startup setting from Windows. Check it in Settings → Apps → Startup."
const TURNED_OFF_BY_USER =
  'Turned off in Settings → Apps → Startup. Turn Vocette on there to start it with Windows.'
const OFF_BY_POLICY = "Your organisation doesn't allow apps to start with Windows."
const ON_BY_POLICY = 'Your organisation starts Vocette with Windows.'

/** How often the switch asks Windows again on its own, at most. */
export const REFRESH_INTERVAL_MS = 5_000

export interface StartupTaskSwitchOptions {
  /** Whenever what Windows reports changes, so the window and tray can follow. */
  onChange(): void
  log?: (message: string) => void
  now?: () => number
}

/**
 * Applies the user's "Start with Windows" choice to the startup task, one
 * request at a time with the newest choice winning, and says what the toggle
 * can honestly promise.
 */
export class StartupTaskSwitch {
  private known: StartupTaskState | null = null
  /** The sentence for the last call that failed; cleared by the next answer. */
  private failure: string | null = null
  private wanted: boolean | null = null
  private queue: Promise<void> = Promise.resolve()
  private refreshing = false
  private refreshedAt = Number.NEGATIVE_INFINITY

  constructor(
    private readonly api: StartupTaskApi | null,
    private readonly options: StartupTaskSwitchOptions
  ) {}

  /** The last state Windows reported; null before its first answer. */
  current(): StartupTaskState | null {
    return this.known
  }

  set(enabled: boolean): Promise<void> {
    this.wanted = enabled
    this.queue = this.queue.then(() => this.applyWanted())
    return this.queue
  }

  /**
   * Asks Windows for the state again, because the user can change it in
   * Settings while Vocette runs. Throttled; never overlaps a change.
   */
  refresh(): void {
    if (!this.api || this.refreshing || this.wanted !== null) return
    const now = this.now()
    if (now - this.refreshedAt < REFRESH_INTERVAL_MS) return
    this.refreshedAt = now
    this.refreshing = true
    const api = this.api
    this.queue = this.queue
      .then(async () => {
        try {
          this.record(await api.state())
        } catch (error) {
          this.report('read', READ_FAILED, error)
        }
      })
      .finally(() => {
        this.refreshing = false
      })
  }

  capability(): Capability {
    if (!this.api) return unavailable(UNREACHABLE)
    if (this.failure) return unavailable(this.failure)
    switch (this.known) {
      case 'disabled-by-user':
        return unavailable(TURNED_OFF_BY_USER)
      case 'disabled-by-policy':
        return unavailable(OFF_BY_POLICY)
      case 'enabled-by-policy':
        return unavailable(ON_BY_POLICY)
      default:
        return available()
    }
  }

  private async applyWanted(): Promise<void> {
    const wanted = this.wanted
    // A later call already applied the newest choice.
    if (wanted === null || !this.api) return
    this.wanted = null
    try {
      this.record(wanted ? await this.api.enable() : await this.api.disable())
    } catch (error) {
      this.report(wanted ? 'turn on' : 'turn off', CHANGE_FAILED, error)
    }
  }

  private record(state: StartupTaskState): void {
    const changed = state !== this.known || this.failure !== null
    this.known = state
    this.failure = null
    this.refreshedAt = this.now()
    if (changed) this.options.onChange()
  }

  private report(action: string, sentence: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    ;(this.options.log ?? console.error)(`Vocette could not ${action} its startup task: ${message}`)
    const changed = this.failure !== sentence
    this.failure = sentence
    if (changed) this.options.onChange()
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}
