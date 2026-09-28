import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/main/settings-store'
import type { EngineStatus } from '../src/shared/engine'
import type {
  HistorySaveStatus,
  LicenceActivation,
  LicenceRelease,
  LicenceStatus,
  TranscriptionTestResult
} from '../src/shared/types'

/**
 * Covers `bootstrap()` through its real calling path — `app.whenReady()` and
 * the fatal startup handler — with Electron and both stores mocked.
 *
 * The startup retention pass used to be awaited before any window existed, so
 * a storage failure reached the fatal handler and the app quit: no windows, no
 * tray, no way to dictate, over history that could not be tidied.
 */

type StoredModelState = 'missing' | 'partial' | 'installed'
type TranscribeLocally = (
  samples: Float32Array,
  sampleRate: number,
  signal?: AbortSignal
) => Promise<string>

/** The model store and engine as the app sees them, driven by the test. */
interface EngineHarness {
  setModelState: (state: StoredModelState) => void
  transcribe: Mock<TranscribeLocally>
  prewarm: Mock<() => void>
  unload: Mock<() => void>
  dispose: Mock<() => void>
  downloads: () => number
  /** The signal the running download was given. */
  downloadSignal: () => AbortSignal | null
  progress: (receivedBytes: number) => void
  finishDownload: () => void
  failDownload: (error: Error) => void
  removals: () => number
}

interface StartupHarness {
  timeline: string[]
  windowOptions: Array<Record<string, unknown>>
  trayCount: () => number
  messageBoxes: Array<{ title?: string; message?: string; detail?: string }>
  errorBoxes: Array<{ title: string; content: string }>
  quitCalls: () => number
  pruneCalls: number[]
  loginItems: Array<{ openAtLogin: boolean; args?: string[] }>
  hookStarted: () => boolean
  /** How often the keyboard hook has been started, and stopped. */
  hookStarts: () => number
  hookStops: () => number
  /** Fires one of Electron's power events, as Windows would. */
  powerEvent: (event: 'suspend' | 'resume' | 'lock-screen' | 'unlock-screen') => void
  invoke: (channel: string, fromMainWindow: boolean, ...args: unknown[]) => unknown
  /** Delivers a message from the hidden recorder window. */
  emitFromRecorder: (channel: string, payload: unknown) => void
  /** Delivers a message on a recorder channel, but from the main window. */
  emitFromMainWindow: (channel: string, payload: unknown) => void
  sentToRecorder: () => Array<{ channel: string; payload: unknown }>
  sentToOverlay: () => Array<{ channel: string; payload: unknown }>
  pressShortcut: () => void
  /** The chord has been held on its own for a moment, inside its hold delay. */
  armShortcut: () => void
  /** The armed chord turns out to be another shortcut. */
  disarmShortcut: () => void
  /** Esc pressed on its own, as the keyboard hook reports it. */
  pressEscape: () => void
  setCapabilities: (patch: Record<string, unknown>) => void
  sentToMain: () => Array<{ channel: string; payload: unknown }>
  trayLabels: () => string[]
  /** An item of the tray menu as last built, found by its label. */
  trayItem: (label: string) => { label?: string; enabled?: boolean } | undefined
  setSaveStatus: (status: HistorySaveStatus) => void
  historyAdds: () => Array<{ text: string; durationMs: number; model: string }>
  engine: EngineHarness
  /** Lets pending promise chains run to the end. */
  settle: () => Promise<void>
  /** Fires the app's `before-quit` handler, as quitting from the tray does. */
  quit: () => void
  /** Makes the next settings save report a stored key. */
  keySavedOnNextSave: () => void
  registeredAccelerators: () => string[]
  /** What the main process asked Polar, through the fake `net.fetch`. */
  polarRequests: () => Array<{ url: string; init: RequestInit }>
  /** What the update check asked GitHub. */
  githubRequests: () => Array<{ url: string; init: RequestInit }>
  /** The update switch as the fake store holds it. */
  storedUpdateCheck: () => boolean
  /** What the store was asked to keep after an activation. */
  savedLicences: () => Array<Record<string, unknown>>
  licenceCleared: () => number
  openedExternally: () => string[]
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 25; tick += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

async function startApp(options: {
  pruneRejection?: Error
  settingsConstructorError?: Error
  engine?: 'local' | 'cloud'
  apiKeySource?: 'none' | 'stored' | 'session'
  /** The saved API endpoint; empty, as by default, is OpenAI. */
  apiEndpoint?: string
  modelState?: StoredModelState
  /** Another application already owns every system shortcut Murmur asks for. */
  acceleratorTaken?: boolean
  /** When the stored trial began; null is a profile the store has not yet dated. */
  trialStartedAt?: string | null
  /** A licence is already active on this PC. */
  licensed?: boolean
  /** Polar's answer to whatever the main process sends it. */
  polarReply?: (url: string, init: RequestInit) => Response | Promise<Response>
  /** GitHub's answer to an update check; without one, GitHub cannot be reached. */
  githubReply?: () => Response
  /** The saved transcription key, as the store would decrypt it. */
  apiKey?: string
  /** The saved polish key, likewise. */
  polishKey?: string
  /** Polish settings as saved. */
  polish?: Partial<Pick<typeof DEFAULT_SETTINGS, 'polishEndpoint' | 'polishModel' | 'polishEnabled'>>
} = {}): Promise<StartupHarness> {
  vi.resetModules()

  const engineChoice = options.engine ?? 'local'
  let apiKeySource = options.apiKeySource ?? 'stored'
  let saveStoresKey = false
  let modelState: StoredModelState = options.modelState ?? 'installed'
  let downloads = 0
  let removals = 0
  let downloadSignal: AbortSignal | null = null
  let downloadProgress: ((progress: { phase: string; receivedBytes: number; totalBytes: number }) => void) | null =
    null
  let settleDownload: { resolve: () => void; reject: (error: Error) => void } | null = null
  const transcribeLocally = vi.fn<TranscribeLocally>(async () => 'Hello from this PC.')
  const prewarmEngine = vi.fn<() => void>()
  const unloadEngine = vi.fn<() => void>()
  const disposeEngine = vi.fn<() => void>()
  const historyAdds: Array<{ text: string; durationMs: number; model: string }> = []
  const ipcListeners = new Map<string, (event: unknown, payload: unknown) => void>()
  const appListeners = new Map<string, (event: unknown) => void>()

  const windowOptions: Array<Record<string, unknown>> = []
  const messageBoxes: Array<{ title?: string; message?: string; detail?: string }> = []
  const errorBoxes: Array<{ title: string; content: string }> = []
  const loginItems: Array<{ openAtLogin: boolean; args?: string[] }> = []
  const pruneCalls: number[] = []
  const timeline: string[] = []
  const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const trayTemplates: Array<Array<{ label?: string; enabled?: boolean }>> = []
  const windows: FakeBrowserWindow[] = []
  const saveStatusListeners: Array<(status: HistorySaveStatus) => void> = []
  let saveStatus: HistorySaveStatus = { saveFailed: false }
  let trays = 0
  let quits = 0
  let hookStarted = false
  let hookStarts = 0
  let hookStops = 0
  const powerListeners = new Map<string, Array<() => void>>()
  let shortcutPress: (() => void) | null = null
  let shortcutArm: (() => void) | null = null
  let shortcutDisarm: (() => void) | null = null
  let shortcutEscape: (() => void) | null = null
  const accelerators = new Set<string>()
  // Saved settings are remembered, so a save can be seen to take effect.
  let storedSettings: typeof DEFAULT_SETTINGS = {
    ...DEFAULT_SETTINGS,
    historyRetentionDays: 30,
    trialStartedAt: options.trialStartedAt ?? null,
    deviceTag: '7F3A',
    apiEndpoint: options.apiEndpoint ?? DEFAULT_SETTINGS.apiEndpoint,
    ...options.polish
  }
  let licence: Record<string, string> | null = options.licensed
    ? {
        activationId: 'b6724bc8-7ad9-4ca0-b143-7c896fcbb6fe',
        benefitId: 'benefit-under-test',
        displayKey: '****-E304DA',
        activatedAt: '2026-09-25T13:48:13.251Z'
      }
    : null
  const savedLicences: Array<Record<string, unknown>> = []
  let licenceClears = 0
  const polarRequests: Array<{ url: string; init: RequestInit }> = []
  const githubRequests: Array<{ url: string; init: RequestInit }> = []
  const openedExternally: string[] = []
  const fullyCapable = {
    globalHold: { state: 'available', reason: '', pane: null },
    globalToggle: { state: 'available', reason: '', pane: null },
    targetVerification: { state: 'available', reason: '', pane: null },
    autoPaste: { state: 'available', reason: '', pane: null },
    launchAtLogin: { state: 'available', reason: '', pane: null },
    secureKeyStorage: { state: 'available', reason: '', pane: null }
  }
  let currentCapabilities: Record<string, unknown> = { ...fullyCapable }

  class FakeWebContents {
    setWindowOpenHandler = vi.fn()
    on = vi.fn()
    send = vi.fn()
    getURL = vi.fn(() => 'file:///index.html')
  }

  class FakeBrowserWindow {
    readonly webContents = new FakeWebContents()
    constructor(constructorOptions: Record<string, unknown>) {
      timeline.push('window')
      windowOptions.push(constructorOptions)
      windows.push(this)
    }
    setMenuBarVisibility = vi.fn()
    setIgnoreMouseEvents = vi.fn()
    setAlwaysOnTop = vi.fn()
    setPosition = vi.fn()
    getBounds = vi.fn(() => ({ x: 0, y: 0, width: 480, height: 96 }))
    isMinimized = vi.fn(() => false)
    restore = vi.fn()
    show = vi.fn()
    showInactive = vi.fn()
    focus = vi.fn()
    hide = vi.fn()
    on = vi.fn()
    loadFile = vi.fn(() => Promise.resolve())
    loadURL = vi.fn(() => Promise.resolve())
  }

  class FakeTray {
    constructor() {
      timeline.push('tray')
      trays += 1
    }
    setToolTip = vi.fn()
    setContextMenu = vi.fn()
    on = vi.fn()
  }

  vi.doMock('electron', () => ({
    app: {
      isPackaged: false,
      getAppPath: () => 'C:/app',
      getPath: () => 'C:/userData',
      getVersion: () => '0.3.2',
      // Pinned by the app so a development run and a packaged run share one
      // profile folder; the fake only has to accept it.
      setName: vi.fn(),
      setDesktopName: vi.fn(),
      requestSingleInstanceLock: () => true,
      whenReady: () => Promise.resolve(),
      setLoginItemSettings: (value: { openAtLogin: boolean; args?: string[] }) => loginItems.push(value),
      on: vi.fn((name: string, listener: (event: unknown) => void) => {
        appListeners.set(name, listener)
      }),
      quit: () => {
        quits += 1
      },
      exit: vi.fn()
    },
    BrowserWindow: FakeBrowserWindow,
    Tray: FakeTray,
    Menu: {
      buildFromTemplate: vi.fn((template: Array<{ label?: string; enabled?: boolean }>) => {
        trayTemplates.push(template)
        return {}
      })
    },
    nativeImage: { createFromPath: vi.fn(() => ({})) },
    dialog: {
      showMessageBox: vi.fn((box: { title?: string; message?: string; detail?: string }) => {
        timeline.push('dialog')
        messageBoxes.push(box)
        return Promise.resolve({ response: 0 })
      }),
      showErrorBox: vi.fn((title: string, content: string) => {
        errorBoxes.push({ title, content })
      }),
      showSaveDialog: vi.fn(() => Promise.resolve({ canceled: true, filePath: undefined }))
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
        ipcHandlers.set(channel, handler)
      }),
      on: vi.fn((channel: string, listener: (event: unknown, payload: unknown) => void) => {
        ipcListeners.set(channel, listener)
      })
    },
    clipboard: { writeText: vi.fn() },
    shell: {
      beep: vi.fn(),
      openExternal: vi.fn((url: string) => {
        openedExternally.push(url)
        return Promise.resolve()
      })
    },
    // Only the licence client reaches this: the model store is faked below.
    net: {
      fetch: vi.fn(async (url: string, init: RequestInit) => {
        if (url.startsWith('https://api.github.com/')) {
          githubRequests.push({ url, init })
          if (!options.githubReply) throw new TypeError('fetch failed')
          return options.githubReply()
        }
        polarRequests.push({ url, init })
        if (!options.polarReply) throw new TypeError('fetch failed')
        return options.polarReply(url, init)
      })
    },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })
    },
    session: {
      defaultSession: {
        setPermissionCheckHandler: vi.fn(),
        setPermissionRequestHandler: vi.fn()
      }
    },
    safeStorage: { isEncryptionAvailable: () => false },
    powerMonitor: {
      on: vi.fn((event: string, listener: () => void) => {
        powerListeners.set(event, [...(powerListeners.get(event) ?? []), listener])
      })
    },
    globalShortcut: {
      register: vi.fn((accelerator: string) => {
        if (options.acceleratorTaken) return false
        accelerators.add(accelerator)
        return true
      }),
      unregister: vi.fn((accelerator: string) => {
        accelerators.delete(accelerator)
      }),
      isRegistered: vi.fn((accelerator: string) => accelerators.has(accelerator)),
      unregisterAll: vi.fn(() => accelerators.clear())
    }
  }))

  vi.doMock('../src/main/settings-store', () => ({
    SettingsStore: class {
      constructor() {
        if (options.settingsConstructorError) throw options.settingsConstructorError
      }
      // Saved settings are remembered, so a save can be seen to take effect;
      // the engine is the one the test chose.
      getInternal = (): typeof DEFAULT_SETTINGS => ({ ...storedSettings, engine: engineChoice })
      getPublic = () => ({
        apiKeySource,
        // Readiness reads it: an endpoint of the user's own may need no key.
        apiEndpoint: storedSettings.apiEndpoint,
        engine: engineChoice,
        launchAtLogin: false,
        recordingMode: 'hold'
      })
      getApiKey = () => options.apiKey ?? ''
      getPolishKey = () => options.polishKey ?? ''
      clearPolishKey = vi.fn(() => ({}))
      keyStorage = () => ({ usable: true, reason: '', backend: 'os' })
      update = vi.fn((patch: Partial<typeof DEFAULT_SETTINGS>) => {
        storedSettings = { ...storedSettings, ...patch }
        if (saveStoresKey) apiKeySource = 'stored'
        return {}
      })
      clearApiKey = vi.fn()
      clearSessionApiKey = vi.fn()
      takeWarning = () => null
      licenceRecord = () => licence
      getLicenceKey = (): string => {
        if (!licence) throw new Error('No licence is active on this PC.')
        return 'MURMUR-1C285B2D-6CE6-4BC7-B8BE-ADB6A7E304DA'
      }
      saveLicence = (input: Record<string, string>): void => {
        savedLicences.push(input)
        const { key: _key, ...record } = input
        licence = record
      }
      clearLicence = (): void => {
        licenceClears += 1
        licence = null
        storedSettings = { ...storedSettings, trialEndNoticeDismissed: true }
      }
      setUpdateCheck = (enabled: boolean): void => {
        storedSettings = { ...storedSettings, updateCheck: enabled }
      }
      setLastUpdateCheck = (iso: string): void => {
        storedSettings = { ...storedSettings, lastUpdateCheckAt: iso }
      }
    }
  }))

  vi.doMock('../src/main/history-store', () => ({
    HistoryStore: class {
      prune = (days: number): Promise<boolean> => {
        pruneCalls.push(days)
        return options.pruneRejection
          ? Promise.reject(options.pruneRejection)
          : Promise.resolve(false)
      }
      list = () => []
      add = vi.fn((input: { text: string; durationMs: number; model: string }) => {
        historyAdds.push(input)
        return { ...input, id: 'entry-1', createdAt: new Date(0).toISOString() }
      })
      delete = vi.fn(() => Promise.resolve([]))
      clear = vi.fn(() => Promise.resolve())
      flush = vi.fn(() => Promise.resolve())
      takeWarning = () => null
      getSaveStatus = (): HistorySaveStatus => saveStatus
      onSaveStatusChanged = (listener: (status: HistorySaveStatus) => void): (() => void) => {
        saveStatusListeners.push(listener)
        return () => undefined
      }
    }
  }))

  // Keeps the native keyboard hook and the Win32 bindings out of the test.
  vi.doMock('../src/main/shortcut-controller', () => ({ SYNTHETIC_ECHO_MS: 180 }))

  // The model store and the speech engine are exercised on their own; here
  // they stand in for a disk and a worker process the test controls.
  vi.doMock('../src/main/engine/model-store', () => {
    class ModelStoreError extends Error {}
    return {
      ModelStoreError,
      modelsRoot: () => 'C:/models',
      ModelStore: class {
        path = (id: string) => `C:/models/${id}`
        state = () => modelState
        download = (
          _id: string,
          onProgress: (progress: { phase: string; receivedBytes: number; totalBytes: number }) => void,
          signal: AbortSignal
        ): Promise<void> => {
          downloads += 1
          downloadSignal = signal
          downloadProgress = onProgress
          return new Promise<void>((resolve, reject) => {
            settleDownload = { resolve, reject }
            signal.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            )
          })
        }
        remove = async (): Promise<void> => {
          removals += 1
          modelState = 'missing'
        }
      }
    }
  })
  vi.doMock('../src/main/engine/local-engine', () => ({
    LocalEngine: class {
      transcribe = transcribeLocally
      unload = unloadEngine
      dispose = disposeEngine
      prewarm = prewarmEngine
    }
  }))

  // The platform boundary is exercised on its own in `platform-adapters`; here
  // it stands in for whichever desktop the app happens to be running on.
  vi.doMock('../src/main/platform', () => ({
    createPlatformAdapter: async () => ({
      id: 'windows',
      session: null,
      pasteLabel: 'Ctrl + V',
      primaryModifierLabel: 'Ctrl',
      createShortcutBackend: (backendOptions: {
        onPress: () => void
        onArm?: () => void
        onDisarm?: () => void
        onEscape?: () => void
      }) => {
        shortcutPress = backendOptions.onPress
        shortcutArm = backendOptions.onArm ?? null
        shortcutDisarm = backendOptions.onDisarm ?? null
        shortcutEscape = backendOptions.onEscape ?? null
        return {
          supportsHold: true,
          supportsCapture: true,
          supportsEscape: true,
          setEnabled: vi.fn(),
          setChord: vi.fn(),
          setHoldDelay: vi.fn(),
          setTapToFire: vi.fn(),
          isEnabled: () => true,
          isCapturing: () => false,
          beginCapture: vi.fn(),
          cancelCapture: vi.fn(),
          resetKeyState: vi.fn(),
          suppressSyntheticInput: vi.fn(),
          registrationError: () => null,
          stop: (): void => {
            hookStops += 1
          },
          start: (): void => {
            hookStarted = true
            hookStarts += 1
          }
        }
      },
      createTargetTracker: () => ({
        isAvailable: () => true,
        capture: vi.fn(),
        clear: vi.fn(),
        check: () => ({ sameWindow: true, elevated: false })
      }),
      paste: vi.fn(),
      canPaste: () => true,
      setLaunchAtLogin: (enabled: boolean) => loginItems.push({ openAtLogin: enabled }),
      openSettingsPane: vi.fn(() => Promise.resolve()),
      capabilities: () => currentCapabilities
    })
  }))

  await import('../src/main/index')
  // `whenReady().then(bootstrap)` and bootstrap's own awaits each need a turn.
  await settle()

  const mainWindow = windows[0]
  const recorderWindow = windows[1]
  const overlayWindow = windows[2]

  return {
    emitFromRecorder: (channel: string, payload: unknown): void => {
      const listener = ipcListeners.get(channel)
      if (!listener) throw new Error(`No listener registered for ${channel}.`)
      listener({ sender: recorderWindow?.webContents }, payload)
    },
    emitFromMainWindow: (channel: string, payload: unknown): void => {
      const listener = ipcListeners.get(channel)
      if (!listener) throw new Error(`No listener registered for ${channel}.`)
      listener({ sender: mainWindow?.webContents }, payload)
    },
    sentToRecorder: () =>
      (recorderWindow?.webContents.send.mock.calls ?? []).map(([channel, payload]) => ({
        channel,
        payload
      })),
    sentToOverlay: () =>
      (overlayWindow?.webContents.send.mock.calls ?? []).map(([channel, payload]) => ({
        channel,
        payload
      })),
    historyAdds: () => historyAdds,
    settle,
    quit: () => appListeners.get('before-quit')?.({ preventDefault: vi.fn() }),
    keySavedOnNextSave: () => {
      saveStoresKey = true
    },
    engine: {
      setModelState: (state) => {
        modelState = state
      },
      transcribe: transcribeLocally,
      prewarm: prewarmEngine,
      unload: unloadEngine,
      dispose: disposeEngine,
      downloads: () => downloads,
      downloadSignal: () => downloadSignal,
      progress: (receivedBytes) =>
        downloadProgress?.({ phase: 'downloading', receivedBytes, totalBytes: 670_478_772 }),
      finishDownload: () => {
        modelState = 'installed'
        settleDownload?.resolve()
      },
      failDownload: (error) => settleDownload?.reject(error),
      removals: () => removals
    },
    windowOptions,
    timeline,
    trayCount: () => trays,
    messageBoxes,
    errorBoxes,
    quitCalls: () => quits,
    pruneCalls,
    loginItems,
    hookStarted: () => hookStarted,
    hookStarts: () => hookStarts,
    hookStops: () => hookStops,
    powerEvent: (event) => {
      for (const listener of powerListeners.get(event) ?? []) listener()
    },
    invoke: (channel: string, fromMainWindow: boolean, ...args: unknown[]): unknown => {
      const handler = ipcHandlers.get(channel)
      if (!handler) throw new Error(`No handler registered for ${channel}.`)
      const sender = fromMainWindow ? mainWindow?.webContents : windows[1]?.webContents
      return handler({ sender }, ...args)
    },
    pressShortcut: () => shortcutPress?.(),
    armShortcut: () => {
      if (!shortcutArm) throw new Error('The shortcut backend was given no onArm.')
      shortcutArm()
    },
    disarmShortcut: () => {
      if (!shortcutDisarm) throw new Error('The shortcut backend was given no onDisarm.')
      shortcutDisarm()
    },
    pressEscape: () => {
      if (!shortcutEscape) throw new Error('The shortcut backend was given no onEscape.')
      shortcutEscape()
    },
    setCapabilities: (patch: Record<string, unknown>) => {
      currentCapabilities = { ...fullyCapable, ...patch }
    },
    sentToMain: () =>
      (mainWindow?.webContents.send.mock.calls ?? []).map(([channel, payload]) => ({
        channel,
        payload
      })),
    trayLabels: () =>
      (trayTemplates.at(-1) ?? []).map((item) => item.label ?? '').filter((label) => label !== ''),
    trayItem: (label: string) => (trayTemplates.at(-1) ?? []).find((item) => item.label === label),
    setSaveStatus: (status: HistorySaveStatus) => {
      saveStatus = status
      saveStatusListeners.forEach((listener) => listener(status))
    },
    registeredAccelerators: () => [...accelerators],
    polarRequests: () => polarRequests,
    githubRequests: () => githubRequests,
    storedUpdateCheck: () => storedSettings.updateCheck,
    savedLicences: () => savedLicences,
    licenceCleared: () => licenceClears,
    openedExternally: () => openedExternally
  }
}

afterEach(() => {
  vi.doUnmock('electron')
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  // The cloud cases stand in for the network with a fake fetch.
  vi.unstubAllGlobals()
})

describe('bootstrap', () => {
  it('creates every window and the tray when startup retention succeeds', async () => {
    const app = await startApp()

    expect(app.pruneCalls).toEqual([30])
    expect(app.windowOptions).toHaveLength(3)
    expect(app.trayCount()).toBe(1)
    expect(app.hookStarted()).toBe(true)
    expect(app.messageBoxes).toEqual([])
    expect(app.errorBoxes).toEqual([])
    expect(app.quitCalls()).toBe(0)
  })

  it('still starts, and warns, when startup retention fails', async () => {
    const app = await startApp({ pruneRejection: new Error('ENOSPC: no space left on device') })

    // Startup completed: the user can dictate despite the storage problem.
    expect(app.windowOptions).toHaveLength(3)
    expect(app.trayCount()).toBe(1)
    expect(app.hookStarted()).toBe(true)
    // The platform adapter owns how launch-at-login is expressed; what
    // matters here is that startup applied the stored preference at all.
    expect(app.loginItems).toEqual([{ openAtLogin: false }])
    expect(app.errorBoxes).toEqual([])
    expect(app.quitCalls()).toBe(0)

    // And the warning reached the UI, naming the real cause and the retry.
    expect(app.messageBoxes).toHaveLength(1)
    const warning = app.messageBoxes[0]
    expect(warning?.message).toContain('Murmur started')
    expect(warning?.detail).toContain('ENOSPC: no space left on device')
    expect(warning?.detail).toContain('may still be on disk')
    expect(warning?.detail).toContain('save your retention setting again')
    // It must not imply the cleanup finished or that memory is safely stored.
    expect(warning?.detail).not.toMatch(/removed successfully|has been deleted|saved successfully/iu)
  })

  it('raises the warning only after the windows and tray exist', async () => {
    // A dialog raised before `createWindows()` would be the old ordering: the
    // user acknowledges a storage problem with no app behind it.
    const app = await startApp({ pruneRejection: new Error('EPERM: operation not permitted') })

    expect(app.timeline.filter((event) => event === 'window')).toHaveLength(3)
    expect(app.timeline.indexOf('dialog')).toBeGreaterThan(app.timeline.lastIndexOf('window'))
    expect(app.timeline.indexOf('dialog')).toBeGreaterThan(app.timeline.indexOf('tray'))
    expect(app.timeline.filter((event) => event === 'dialog')).toHaveLength(1)
  })

  it('serves the history save status only to the main window', async () => {
    const app = await startApp()

    expect(app.invoke('history:save-status', true)).toEqual({ saveFailed: false })
    expect(() => app.invoke('history:save-status', false)).toThrow('Forbidden.')
  })

  it('pushes a failed save to the window and the tray without a dialog', async () => {
    const app = await startApp()
    expect(app.trayLabels()).not.toContain(
      'History could not be saved — recent entries may be lost when you quit'
    )

    app.setSaveStatus({ saveFailed: true })

    expect(app.sentToMain()).toContainEqual({
      channel: 'history:save-status',
      payload: { saveFailed: true }
    })
    expect(app.trayLabels()).toContain(
      'History could not be saved — recent entries may be lost when you quit'
    )
    // A reloading renderer reads the same already-failed state back.
    expect(app.invoke('history:save-status', true)).toEqual({ saveFailed: true })
    // Nothing modal, and no window was raised over the user's work.
    expect(app.messageBoxes).toEqual([])

    app.setSaveStatus({ saveFailed: false })
    expect(app.trayLabels()).not.toContain(
      'History could not be saved — recent entries may be lost when you quit'
    )
  })

  it('still treats an unrelated startup failure as fatal', async () => {
    const app = await startApp({ settingsConstructorError: new Error('settings.json is a directory') })

    expect(app.errorBoxes).toEqual([
      { title: 'Murmur could not start', content: 'settings.json is a directory' }
    ])
    expect(app.quitCalls()).toBe(1)
    expect(app.windowOptions).toEqual([])
    expect(app.trayCount()).toBe(0)
  })
})

describe('recording entry points', () => {
  it('starts, stops and cancels through one controller', async () => {
    const app = await startApp()
    // No throw means each channel is registered and reached the controller.
    expect(() => app.invoke('dictation:start', true)).not.toThrow()
    expect(() => app.invoke('dictation:stop', true)).not.toThrow()
    expect(() => app.invoke('dictation:cancel', true)).not.toThrow()
    expect(() => app.invoke('dictation:retry', true)).not.toThrow()
  })

  it('refuses recording commands from any other window', async () => {
    const app = await startApp()
    for (const channel of ['dictation:start', 'dictation:stop', 'dictation:cancel']) {
      expect(() => app.invoke(channel, false)).toThrow('Forbidden.')
    }
  })

  it('offers Start recording in the tray, and Cancel only while busy', async () => {
    const app = await startApp()
    const labels = app.trayLabels()
    expect(labels).toContain('Start recording')
    expect(labels).toContain('Cancel dictation')
  })

  it('shows the shortcut hint that matches the mode in force', async () => {
    const app = await startApp()
    expect(app.trayLabels()[0]).toBe('Hold Left Ctrl + Left Shift to talk')
  })
})

describe('platform capabilities over IPC', () => {
  it('serves the platform status only to the main window', async () => {
    const app = await startApp()
    const status = app.invoke('platform:status', true) as {
      platform: string
      capabilities: Record<string, { state: string }>
    }
    expect(status.platform).toBe('windows')
    expect(status.capabilities.autoPaste?.state).toBe('available')
    expect(() => app.invoke('platform:status', false)).toThrow('Forbidden.')
  })

  it('tells the window when a capability changes', async () => {
    const app = await startApp()
    app.setCapabilities({
      autoPaste: { state: 'needs-permission', reason: 'Grant Accessibility.', pane: 'accessibility' }
    })
    app.invoke('platform:status', true)
    expect(app.sentToMain()).toContainEqual(
      expect.objectContaining({ channel: 'platform:status' })
    )
  })

  it('rejects a settings pane it does not know', async () => {
    const app = await startApp()
    await expect(app.invoke('platform:open-settings', true, 'registry-editor')).rejects.toThrow(
      'Unknown settings page.'
    )
    await expect(app.invoke('platform:open-settings', true, 'microphone')).resolves.toBeUndefined()
  })

  it('reports the platform in app info, for the About page', async () => {
    const app = await startApp()
    const info = app.invoke('app:info', true) as { platformStatus: { pasteLabel: string } }
    expect(info.platformStatus.pasteLabel).toBe('Ctrl + V')
  })

  it('serves app info only to the main window', async () => {
    const app = await startApp()
    expect(() => app.invoke('app:info', false)).toThrow('Forbidden.')
  })
})

describe('paste last dictation', () => {
  it('registers Alt + Shift + V on Windows, and reports it only to the main window', async () => {
    const app = await startApp()
    expect(app.registeredAccelerators()).toEqual(['Alt+Shift+V'])
    expect(app.invoke('shortcut:paste-last-status', true)).toEqual({ pasteLastRegistered: true })
    expect(() => app.invoke('shortcut:paste-last-status', false)).toThrow('Forbidden.')
  })

  it('reports it as not in force when another app owns the combination', async () => {
    const app = await startApp({ acceleratorTaken: true })
    expect(app.registeredAccelerators()).toEqual([])
    expect(app.invoke('shortcut:paste-last-status', true)).toEqual({ pasteLastRegistered: false })
  })

  it('releases and registers it again as the setting is saved', async () => {
    const app = await startApp()

    await app.invoke('settings:save', true, { pasteLastShortcut: false })
    expect(app.registeredAccelerators()).toEqual([])
    expect(app.invoke('shortcut:paste-last-status', true)).toEqual({ pasteLastRegistered: false })

    await app.invoke('settings:save', true, { pasteLastShortcut: true })
    expect(app.registeredAccelerators()).toEqual(['Alt+Shift+V'])
    expect(app.invoke('shortcut:paste-last-status', true)).toEqual({ pasteLastRegistered: true })
  })
})

describe('the tray keeps up with the workflow', () => {
  it('offers Stop once a take has started from the shortcut', async () => {
    const app = await startApp()
    expect(app.trayLabels()).toContain('Start recording')

    app.pressShortcut()

    // The tray rebuilds from the phase change, not only from the click that
    // caused it — a take can also end on its own, with nobody to rebuild it.
    expect(app.trayLabels()).toContain('Stop recording')
    expect(app.trayLabels()).toContain('Cancel dictation')

    app.invoke('dictation:cancel', true)
    expect(app.trayLabels()).toContain('Start recording')
  })

  it('cancels a take started from the window when Esc is pressed on its own', async () => {
    const app = await startApp()
    app.invoke('dictation:start', true)
    expect(app.trayLabels()).toContain('Stop recording')
    const starting = app
      .sentToMain()
      .filter(({ channel }) => channel === 'workflow:status')
      .at(-1)?.payload as { detail?: string } | undefined
    // The keyboard is watched and the shortcut is on, so Esc is offered.
    expect(starting?.detail).toBe('Press Stop when you have finished · Esc to cancel')

    app.pressEscape()
    expect(app.trayLabels()).toContain('Start recording')
    const last = app
      .sentToMain()
      .filter(({ channel }) => channel === 'workflow:status')
      .at(-1)?.payload as { phase?: string } | undefined
    expect(last?.phase).toBe('cancelled')
  })

  it('leaves a take held to talk alone when Esc is pressed', async () => {
    const app = await startApp()
    app.pressShortcut()
    app.pressEscape()
    expect(app.trayLabels()).toContain('Stop recording')
  })
})

describe('the live level meter', () => {
  /** Starts a take from the window and returns the id the recorder was given. */
  const startTake = (app: StartupHarness): string => {
    app.invoke('dictation:start', true)
    const start = app
      .sentToRecorder()
      .filter((message) => message.channel === 'recorder:start')
      .at(-1)
    return (start?.payload as { requestId: string }).requestId
  }

  const levelsShown = (app: StartupHarness): unknown[] =>
    app
      .sentToOverlay()
      .filter((message) => message.channel === 'workflow:level')
      .map((message) => message.payload)

  it('shows the level of the take being recorded, in the overlay and nowhere else', async () => {
    const app = await startApp()
    const requestId = startTake(app)

    // The microphone is still opening: there is nothing being recorded yet.
    app.emitFromRecorder('recorder:level', { requestId, level: 0.3 })
    expect(levelsShown(app)).toEqual([])

    app.emitFromRecorder('recorder:started', { requestId })
    app.emitFromRecorder('recorder:level', { requestId, level: 0.42 })
    app.emitFromRecorder('recorder:level', { requestId, level: 0 })
    app.emitFromRecorder('recorder:level', { requestId, level: 3 })
    expect(levelsShown(app)).toEqual([0.42, 0, 1])

    // The main window shares the overlay's preload, so it must not be sent it.
    expect(app.sentToMain().filter((message) => message.channel === 'workflow:level')).toEqual([])
    expect(
      app.sentToRecorder().filter((message) => message.channel === 'workflow:level')
    ).toEqual([])
  })

  it('drops a reading from another take, another window, or of the wrong shape', async () => {
    const app = await startApp()
    const requestId = startTake(app)
    app.emitFromRecorder('recorder:started', { requestId })

    app.emitFromRecorder('recorder:level', { requestId: 'an-older-take', level: 0.9 })
    app.emitFromRecorder('recorder:level', { requestId, level: Number.NaN })
    app.emitFromRecorder('recorder:level', { requestId, level: '0.5' })
    app.emitFromRecorder('recorder:level', { level: 0.5 })
    app.emitFromRecorder('recorder:level', null)
    app.emitFromMainWindow('recorder:level', { requestId, level: 0.5 })

    expect(levelsShown(app)).toEqual([])
  })

  it('stops the moment the take is no longer recording', async () => {
    const app = await startApp()
    const requestId = startTake(app)
    app.emitFromRecorder('recorder:started', { requestId })
    app.emitFromRecorder('recorder:level', { requestId, level: 0.2 })

    app.invoke('dictation:cancel', true)
    app.emitFromRecorder('recorder:level', { requestId, level: 0.6 })

    expect(levelsShown(app)).toEqual([0.2])
  })
})

/** A 16 kHz mono PCM16 WAV, shaped like the recorder's own. */
function wavBytes(frames: number, sampleRate = 16000): Uint8Array {
  const buffer = new ArrayBuffer(44 + frames * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + frames * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, frames * 2, true)
  for (let frame = 0; frame < frames; frame += 1) view.setInt16(44 + frame * 2, 1000, true)
  return new Uint8Array(buffer)
}

/**
 * Records one take from the window's Record button and hands over `audio`,
 * with anything else in `extra` that the recorder window adds to its reply.
 */
async function dictateFromWindow(
  app: StartupHarness,
  audio: Uint8Array,
  mimeType = 'audio/wav',
  extra: Record<string, unknown> = {}
): Promise<void> {
  app.invoke('dictation:start', true)
  const start = app.sentToRecorder().find((message) => message.channel === 'recorder:start')
  const { requestId } = start?.payload as { requestId: string }
  app.emitFromRecorder('recorder:started', { requestId })
  app.invoke('dictation:stop', true)
  app.emitFromRecorder('recorder:audio', { requestId, audio, mimeType, durationMs: 100, ...extra })
  await app.settle()
}

const engineBroadcasts = (app: StartupHarness): EngineStatus[] =>
  app
    .sentToMain()
    .filter((message) => message.channel === 'engine:status')
    .map((message) => message.payload as EngineStatus)

const lastEngineBroadcast = (app: StartupHarness): EngineStatus | undefined =>
  engineBroadcasts(app).at(-1)

const workflowErrors = (app: StartupHarness): string[] =>
  app
    .sentToMain()
    .filter((message) => message.channel === 'workflow:status')
    .map((message) => message.payload as { phase: string; detail?: string })
    .filter((status) => status.phase === 'error')
    .map((status) => status.detail ?? '')

describe('the on-device engine', () => {
  it('sends a take to the engine on this PC, and History names its model', async () => {
    const app = await startApp({ engine: 'local', modelState: 'installed' })
    await dictateFromWindow(app, wavBytes(1600))

    expect(app.engine.transcribe).toHaveBeenCalledTimes(1)
    const [samples, sampleRate] = app.engine.transcribe.mock.calls[0] ?? []
    expect(sampleRate).toBe(16000)
    expect(samples?.length).toBe(1600)
    expect(app.historyAdds()).toEqual([
      {
        text: 'Hello from this PC.',
        durationMs: 100,
        model: 'parakeet-tdt-0.6b-v3-int8',
        waitMs: expect.any(Number)
      }
    ])
    expect(workflowErrors(app)).toEqual([])
  })

  it('says plainly when a recording is not one it can read', async () => {
    // The renderer falls back to the original container when it cannot
    // prepare a WAV; the on-device engine has no use for that.
    const app = await startApp({ engine: 'local', modelState: 'installed' })
    await dictateFromWindow(app, new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]), 'audio/webm')

    expect(app.engine.transcribe).not.toHaveBeenCalled()
    expect(workflowErrors(app)).toEqual([
      'This recording could not be read for on-device transcription. Try again.'
    ])
    expect(app.historyAdds()).toEqual([])
  })

  it('keeps a cloud take on the cloud path', async () => {
    const app = await startApp({ engine: 'cloud', apiKeySource: 'stored' })
    await dictateFromWindow(app, wavBytes(1600))

    expect(app.engine.transcribe).not.toHaveBeenCalled()
    // The stubbed store hands the cloud service no key, so it stops there —
    // before any request is made.
    expect(workflowErrors(app)).toEqual(['Add an API key in Settings before recording.'])
  })

  it('will not start a take on this PC until the model is there, and says so', async () => {
    const app = await startApp({ engine: 'local', modelState: 'missing' })
    app.pressShortcut()

    expect(app.sentToRecorder().filter((message) => message.channel === 'recorder:start')).toEqual([])
    expect(workflowErrors(app)).toEqual(['Download the speech model first.'])
  })

  it('serves its status, and takes its commands, only from the main window', async () => {
    const app = await startApp({ engine: 'local', modelState: 'missing' })
    expect(app.invoke('engine:get-status', true)).toEqual({
      engine: 'local',
      model: {
        id: 'parakeet-tdt-0.6b-v3-int8',
        state: 'missing',
        receivedBytes: 0,
        totalBytes: 670_478_772,
        error: null
      },
      ready: false,
      notReadyReason: 'Download the speech model first.'
    })
    for (const channel of [
      'engine:get-status',
      'engine:download',
      'engine:cancel-download',
      'engine:remove-model'
    ]) {
      await expect(Promise.resolve().then(() => app.invoke(channel, false))).rejects.toThrow(
        'Forbidden.'
      )
    }
    expect(app.engine.downloads()).toBe(0)
    expect(app.engine.removals()).toBe(0)
  })

  it('asks a cloud user for a key, not for the model', async () => {
    const app = await startApp({ engine: 'cloud', apiKeySource: 'none', modelState: 'missing' })
    expect(app.invoke('engine:get-status', true)).toMatchObject({
      engine: 'cloud',
      ready: false,
      notReadyReason: 'Add your API key in Settings before recording.'
    })
  })

  it('downloads the model once, broadcasting progress and then readiness', async () => {
    const app = await startApp({ engine: 'local', modelState: 'missing' })
    const started = app.invoke('engine:download', true) as EngineStatus
    expect(started.model.state).toBe('downloading')
    // A second request while one runs does not start another.
    app.invoke('engine:download', true)
    expect(app.engine.downloads()).toBe(1)

    app.engine.progress(412_000_000)
    expect(lastEngineBroadcast(app)).toMatchObject({
      model: { state: 'downloading', receivedBytes: 412_000_000 },
      ready: false
    })

    app.engine.finishDownload()
    await app.settle()
    expect(lastEngineBroadcast(app)).toMatchObject({
      model: { state: 'installed', receivedBytes: 670_478_772, error: null },
      ready: true,
      notReadyReason: null
    })
  })

  it('does not download a model that is already installed', async () => {
    const app = await startApp({ engine: 'local', modelState: 'installed' })
    const status = app.invoke('engine:download', true) as EngineStatus
    expect(app.engine.downloads()).toBe(0)
    expect(status).toMatchObject({ model: { state: 'installed' }, ready: true })
  })

  it('reports a failed download in its own words, and a cancelled one as no failure', async () => {
    const app = await startApp({ engine: 'local', modelState: 'missing' })
    const { ModelStoreError } = await import('../src/main/engine/model-store')

    app.invoke('engine:download', true)
    app.engine.failDownload(
      new ModelStoreError('Not enough free disk space — about 700 MB is needed.')
    )
    await app.settle()
    expect(lastEngineBroadcast(app)).toMatchObject({
      model: { state: 'failed', error: 'Not enough free disk space — about 700 MB is needed.' },
      ready: false
    })

    // Trying again clears the failure; cancelling leaves the parts on disk,
    // which is where the state then comes from.
    app.invoke('engine:download', true)
    expect(lastEngineBroadcast(app)?.model).toMatchObject({ state: 'downloading', error: null })
    app.engine.setModelState('partial')
    const cancelled = (await app.invoke('engine:cancel-download', true)) as EngineStatus
    expect(app.engine.downloadSignal()?.aborted).toBe(true)
    expect(cancelled.model).toMatchObject({ state: 'partial', error: null })
    expect(lastEngineBroadcast(app)?.model).toMatchObject({ state: 'partial', error: null })
  })

  it('removes the model after stopping the engine, but never mid-dictation', async () => {
    const app = await startApp({ engine: 'local', modelState: 'installed' })
    app.pressShortcut()
    await expect(app.invoke('engine:remove-model', true)).rejects.toThrow(
      'Wait for the current dictation to finish before removing the speech model.'
    )
    expect(app.engine.removals()).toBe(0)

    app.invoke('dictation:cancel', true)
    const status = (await app.invoke('engine:remove-model', true)) as EngineStatus
    expect(app.engine.unload).toHaveBeenCalledTimes(1)
    expect(app.engine.removals()).toBe(1)
    expect(status).toMatchObject({ model: { state: 'missing' }, ready: false })
    expect(lastEngineBroadcast(app)).toMatchObject({ model: { state: 'missing' } })
  })

  it('tells the window when a saved key makes the cloud ready', async () => {
    const app = await startApp({ engine: 'cloud', apiKeySource: 'none' })
    app.keySavedOnNextSave()
    await app.invoke('settings:save', true, { apiKey: 'sk-test' })
    expect(lastEngineBroadcast(app)).toMatchObject({ engine: 'cloud', ready: true })
  })

  it('opens History on a first run, and Settings only for a cloud user with no key', async () => {
    const cases: Array<[Parameters<typeof startApp>[0], string]> = [
      [{ engine: 'local', modelState: 'missing' }, 'history'],
      [{ engine: 'local', modelState: 'installed' }, 'history'],
      [{ engine: 'cloud', apiKeySource: 'none' }, 'settings'],
      [{ engine: 'cloud', apiKeySource: 'stored' }, 'history']
    ]
    for (const [options, page] of cases) {
      const app = await startApp(options)
      app.invoke('app:ready', true)
      expect(app.sentToMain()).toContainEqual({ channel: 'app:navigate', payload: page })
    }
  })

  it('offers Start recording in the tray only once a take could be transcribed', async () => {
    const app = await startApp({ engine: 'local', modelState: 'missing' })
    expect(app.trayItem('Start recording')?.enabled).toBe(false)
    // The shortcut hint would promise a dictation that cannot happen, so the
    // reason stands in its place.
    expect(app.trayLabels()[0]).toBe('Download the speech model first.')

    app.invoke('engine:download', true)
    app.engine.progress(412_000_000)
    expect(app.trayItem('Start recording')?.enabled).toBe(false)
    app.engine.finishDownload()
    await app.settle()
    expect(app.trayItem('Start recording')?.enabled).toBe(true)
    expect(app.trayLabels()[0]).toBe('Hold Left Ctrl + Left Shift to talk')
  })

  it('names the missing key in the tray for a cloud user without one', async () => {
    const app = await startApp({ engine: 'cloud', apiKeySource: 'none' })
    expect(app.trayItem('Start recording')?.enabled).toBe(false)
    expect(app.trayLabels()[0]).toBe('Add your API key in Settings before recording.')
  })

  it('stops the engine when Murmur quits', async () => {
    const app = await startApp({ engine: 'local', modelState: 'installed' })
    app.quit()
    expect(app.engine.dispose).toHaveBeenCalled()
  })
})

/** Every phase the window has been shown, in order. */
const workflowPhases = (app: StartupHarness): string[] =>
  app
    .sentToMain()
    .filter((message) => message.channel === 'workflow:status')
    .map((message) => (message.payload as { phase: string }).phase)

/** The request ids sent to the recorder on one channel, in order. */
const recorderIds = (app: StartupHarness, channel: string): string[] =>
  app
    .sentToRecorder()
    .filter((message) => message.channel === channel)
    .map((message) => (message.payload as { requestId: string }).requestId)

describe('listening from the keypress', () => {
  it('opens the microphone when the chord is armed, unseen, and loads nothing yet', async () => {
    const app = await startApp({ engine: 'local', modelState: 'installed' })
    const shown = workflowPhases(app).length
    app.armShortcut()
    const opened = recorderIds(app, 'recorder:start')
    expect(opened).toHaveLength(1)
    // It may yet be another shortcut: the engine waits for a confirmed take.
    expect(app.engine.prewarm).not.toHaveBeenCalled()
    expect(workflowPhases(app)).toHaveLength(shown)

    // Another shortcut after all: closed again, and still nothing shown.
    app.disarmShortcut()
    expect(recorderIds(app, 'recorder:cancel')).toEqual(opened)
    expect(workflowPhases(app)).toHaveLength(shown)
  })

  it('makes the take opened at the keypress the dictation once the chord is held', async () => {
    const app = await startApp({ engine: 'local', modelState: 'installed' })
    app.armShortcut()
    const [requestId] = recorderIds(app, 'recorder:start')
    app.emitFromRecorder('recorder:started', { requestId })
    expect(workflowPhases(app)).not.toContain('recording')

    app.pressShortcut()
    expect(workflowPhases(app).at(-1)).toBe('recording')
    expect(recorderIds(app, 'recorder:start')).toEqual([requestId])
    expect(app.trayLabels()).toContain('Stop recording')
  })

  it('warms nothing on the cloud, and opens nothing on this PC before the model is there', async () => {
    const cloud = await startApp({ engine: 'cloud', apiKeySource: 'stored' })
    cloud.armShortcut()
    expect(recorderIds(cloud, 'recorder:start')).toHaveLength(1)
    expect(cloud.engine.prewarm).not.toHaveBeenCalled()

    const missing = await startApp({ engine: 'local', modelState: 'missing' })
    missing.armShortcut()
    // Nothing could be transcribed; the reason waits for a press that is held.
    expect(recorderIds(missing, 'recorder:start')).toEqual([])
    expect(missing.engine.prewarm).not.toHaveBeenCalled()
    expect(workflowErrors(missing)).toEqual([])
  })

  it('opens nothing at the keypress once the setting is switched off', async () => {
    const app = await startApp({ engine: 'local', modelState: 'installed' })
    await app.invoke('settings:save', true, { instantCapture: false })
    app.armShortcut()
    expect(recorderIds(app, 'recorder:start')).toEqual([])
    expect(app.engine.prewarm).not.toHaveBeenCalled()
  })

  it('warms the engine for a take started from the window, once its microphone is live', async () => {
    const app = await startApp({ engine: 'local', modelState: 'installed' })
    app.invoke('dictation:start', true)
    const [requestId] = recorderIds(app, 'recorder:start')
    expect(app.engine.prewarm).not.toHaveBeenCalled()
    app.emitFromRecorder('recorder:started', { requestId })
    expect(app.engine.prewarm).toHaveBeenCalledTimes(1)
  })
})

describe('a take the recorder heard no speech in', () => {
  const lastWorkflowStatus = (app: StartupHarness): unknown =>
    app
      .sentToMain()
      .filter((message) => message.channel === 'workflow:status')
      .map((message) => message.payload)
      .at(-1)

  it('reaches neither engine, and ends on the neutral note', async () => {
    const onDevice = await startApp({ engine: 'local', modelState: 'installed' })
    await dictateFromWindow(onDevice, wavBytes(1600), 'audio/wav', { speechDetected: false })
    expect(onDevice.engine.transcribe).not.toHaveBeenCalled()
    expect(onDevice.historyAdds()).toEqual([])
    expect(workflowErrors(onDevice)).toEqual([])
    expect(lastWorkflowStatus(onDevice)).toEqual({
      phase: 'cancelled',
      message: 'No speech heard — nothing was sent.',
      canRetry: false
    })

    // Had it reached the cloud service, the missing key would have failed it.
    const cloud = await startApp({ engine: 'cloud', apiKeySource: 'stored' })
    await dictateFromWindow(cloud, wavBytes(1600), 'audio/wav', { speechDetected: false })
    expect(workflowErrors(cloud)).toEqual([])
    expect(lastWorkflowStatus(cloud)).toMatchObject({ phase: 'cancelled' })
  })

  it('ignores a flag that is not a real boolean, and transcribes the take as before', async () => {
    for (const speechDetected of ['false', 0, null]) {
      const app = await startApp({ engine: 'local', modelState: 'installed' })
      await dictateFromWindow(app, wavBytes(1600), 'audio/wav', { speechDetected })
      expect(app.engine.transcribe).toHaveBeenCalledTimes(1)
      expect(app.historyAdds()).toHaveLength(1)
    }
  })
})

describe('Pro over IPC', () => {
  const DAY = 86_400_000
  /** Fifty terms, then Dataverse as the fifty-first. */
  const TERMS = [...Array.from({ length: 50 }, (_, index) => `Term${index}`), 'Dataverse'].join('\n')

  /** Polar's 200, cut down to what matters, with a buyer the app must ignore. */
  const granted = (): Response =>
    new Response(
      JSON.stringify({
        id: 'activation-under-test',
        license_key: {
          status: 'granted',
          benefit_id: 'benefit-under-test',
          display_key: '****-E304DA',
          expires_at: null,
          customer: { email: 'buyer@example.com', name: 'Ada Buyer' }
        }
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )

  /** Points the licence client at a sandbox that only the fake `net.fetch` answers. */
  const configure = (): void => {
    vi.stubEnv('MURMUR_POLAR_API_BASE', 'https://sandbox-api.polar.sh')
    vi.stubEnv('MURMUR_POLAR_ORG_ID', 'org-under-test')
    vi.stubEnv('MURMUR_POLAR_BENEFIT_ID', 'benefit-under-test')
  }

  const licenceBroadcasts = (app: StartupHarness): LicenceStatus[] =>
    app
      .sentToMain()
      .filter((message) => message.channel === 'licence:changed')
      .map((message) => message.payload as LicenceStatus)

  /**
   * One take from the window's Record button, however many came before it.
   * Waits for History, because a take with a vocabulary first loads the
   * common-word list, which takes longer than a few turns of the loop.
   */
  async function dictateAgain(app: StartupHarness): Promise<void> {
    const before = app.historyAdds().length
    app.invoke('dictation:start', true)
    const starts = app.sentToRecorder().filter((message) => message.channel === 'recorder:start')
    const { requestId } = starts.at(-1)?.payload as { requestId: string }
    app.emitFromRecorder('recorder:started', { requestId })
    app.invoke('dictation:stop', true)
    app.emitFromRecorder('recorder:audio', {
      requestId,
      audio: wavBytes(1600),
      mimeType: 'audio/wav',
      durationMs: 100
    })
    for (let wait = 0; wait < 400 && app.historyAdds().length === before; wait += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
    }
    await app.settle()
  }

  it('serves the status only to the main window, with no key or Polar identifier in it', async () => {
    configure()
    const app = await startApp({ trialStartedAt: new Date().toISOString() })
    const status = app.invoke('licence:status', true) as LicenceStatus
    expect(status).toMatchObject({
      plan: 'trial',
      trialDaysLeft: 30,
      licence: null,
      purchasesConfigured: true,
      trialEndNoticeDue: false,
      deviceLabel: 'Murmur on Windows · 7F3A'
    })
    const shown = JSON.stringify(status)
    for (const secret of ['org-under-test', 'benefit-under-test', 'sandbox']) {
      expect(shown).not.toContain(secret)
    }
    expect(() => app.invoke('licence:status', false)).toThrow('Forbidden.')
  })

  it('refuses every licence command from any other window', async () => {
    configure()
    const app = await startApp({ polarReply: granted })
    await expect(app.invoke('licence:activate', false, 'MURMUR-KEY')).rejects.toThrow('Forbidden.')
    await expect(app.invoke('licence:deactivate', false)).rejects.toThrow('Forbidden.')
    expect(() => app.invoke('licence:remove-local', false)).toThrow('Forbidden.')
    expect(app.polarRequests()).toEqual([])
  })

  it('asks Polar nothing while purchases are not configured', async () => {
    const app = await startApp({ polarReply: granted })
    const result = (await app.invoke('licence:activate', true, 'MURMUR-KEY')) as LicenceActivation
    expect(result).toMatchObject({
      ok: false,
      error: 'Pro purchases are not open yet in this version of Murmur.'
    })
    expect(app.polarRequests()).toEqual([])
    expect((app.invoke('licence:status', true) as LicenceStatus).purchasesConfigured).toBe(false)
  })

  it('activates with one request, keeps the licence, and tells the window', async () => {
    configure()
    const app = await startApp({ polarReply: granted })
    const result = (await app.invoke('licence:activate', true, '  MURMUR-KEY \n')) as LicenceActivation

    expect(result.ok).toBe(true)
    expect(result.status.plan).toBe('pro')
    expect(result.status.licence).toEqual({ displayKey: '****-E304DA', activatedAt: expect.any(String) })
    expect(app.polarRequests()).toHaveLength(1)
    const [request] = app.polarRequests()
    expect(request?.url).toBe('https://sandbox-api.polar.sh/v1/customer-portal/license-keys/activate')
    expect(JSON.parse(String(request?.init.body))).toEqual({
      key: 'MURMUR-KEY',
      organization_id: 'org-under-test',
      label: 'Murmur on Windows · 7F3A',
      meta: { app_version: '0.3.2' }
    })
    expect(request?.init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(app.savedLicences()).toEqual([
      {
        key: 'MURMUR-KEY',
        activationId: 'activation-under-test',
        benefitId: 'benefit-under-test',
        displayKey: '****-E304DA',
        activatedAt: expect.any(String)
      }
    ])
    expect(licenceBroadcasts(app).at(-1)?.plan).toBe('pro')
    // The key goes to Polar once and stays in the main process; the buyer
    // details Polar sent back go nowhere at all.
    expect(JSON.stringify(result)).not.toContain('MURMUR-KEY')
    expect(JSON.stringify(result)).not.toContain('buyer@example.com')

    // A second activation would take a second device slot, so none is sent.
    const again = (await app.invoke('licence:activate', true, 'MURMUR-KEY')) as LicenceActivation
    expect(again).toMatchObject({ ok: false, error: 'Pro is already active on this PC.' })
    expect(app.polarRequests()).toHaveLength(1)
  })

  it('sends one request however quickly Activate is pressed twice', async () => {
    configure()
    let answer: (response: Response) => void = () => undefined
    const app = await startApp({
      polarReply: () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        })
    })
    const first = app.invoke('licence:activate', true, 'MURMUR-KEY') as Promise<LicenceActivation>
    const second = (await app.invoke('licence:activate', true, 'MURMUR-KEY')) as LicenceActivation
    expect(second.ok).toBe(false)
    answer(granted())
    expect((await first).ok).toBe(true)
    expect(app.polarRequests()).toHaveLength(1)
  })

  it('says why an activation failed, and keeps nothing', async () => {
    configure()
    const app = await startApp({
      polarReply: () =>
        new Response(JSON.stringify({ error: 'ResourceNotFound', detail: 'Not found' }), { status: 404 })
    })
    const result = (await app.invoke('licence:activate', true, 'MURMUR-KEY')) as LicenceActivation
    expect(result).toMatchObject({
      ok: false,
      error: 'That licence key was not recognised. Check it and try again.'
    })
    expect(app.savedLicences()).toEqual([])
    expect(licenceBroadcasts(app)).toEqual([])
  })

  it('releases this PC, forgets the licence and tells the window', async () => {
    configure()
    const app = await startApp({ licensed: true, polarReply: () => new Response(null, { status: 204 }) })
    expect((app.invoke('licence:status', true) as LicenceStatus).plan).toBe('pro')

    const result = (await app.invoke('licence:deactivate', true)) as LicenceRelease
    expect(result.ok).toBe(true)
    expect(app.licenceCleared()).toBe(1)
    const [request] = app.polarRequests()
    expect(request?.url).toBe('https://sandbox-api.polar.sh/v1/customer-portal/license-keys/deactivate')
    expect(JSON.parse(String(request?.init.body))).toEqual({
      key: 'MURMUR-1C285B2D-6CE6-4BC7-B8BE-ADB6A7E304DA',
      organization_id: 'org-under-test',
      activation_id: 'b6724bc8-7ad9-4ca0-b143-7c896fcbb6fe'
    })
    expect(licenceBroadcasts(app).at(-1)?.licence).toBeNull()
  })

  it('offers to remove the licence here when Polar cannot be reached, and does so only when asked', async () => {
    configure()
    // No reply configured: the fake network fails every request.
    const app = await startApp({ licensed: true })
    const result = (await app.invoke('licence:deactivate', true)) as LicenceRelease
    expect(result).toMatchObject({
      ok: false,
      canRemoveLocally: true,
      error:
        'Could not reach Polar, so this PC was not released. Check your internet connection and try again.'
    })
    expect(app.licenceCleared()).toBe(0)
    expect(result.status.licence).not.toBeNull()

    const after = app.invoke('licence:remove-local', true) as LicenceStatus
    expect(app.licenceCleared()).toBe(1)
    expect(after.licence).toBeNull()
    expect(licenceBroadcasts(app).at(-1)?.licence).toBeNull()
  })

  it('tells the window when the trial notice is dismissed', async () => {
    const app = await startApp({ trialStartedAt: new Date(Date.now() - 40 * DAY).toISOString() })
    expect(app.invoke('licence:status', true)).toMatchObject({ plan: 'free', trialEndNoticeDue: true })
    await app.invoke('settings:save', true, { trialEndNoticeDismissed: true })
    expect(licenceBroadcasts(app).at(-1)?.trialEndNoticeDue).toBe(false)
  })

  it('opens the checkout and the portal only once they are configured', async () => {
    const app = await startApp()
    await app.invoke('app:open-external', true, 'checkout')
    await app.invoke('app:open-external', true, 'customer-portal')
    expect(app.openedExternally()).toEqual([])
    await app.invoke('app:open-external', true, 'api-keys')
    expect(app.openedExternally()).toEqual(['https://platform.openai.com/api-keys'])
  })

  it("applies Free's limits from the next take once the trial ends, with no restart", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.parse('2026-09-01T09:00:00.000Z')
    vi.setSystemTime(start)
    const app = await startApp({
      engine: 'local',
      modelState: 'installed',
      trialStartedAt: new Date(start).toISOString()
    })
    await app.invoke('settings:save', true, { vocabulary: TERMS })
    app.engine.transcribe.mockResolvedValue('Open data verse now.')

    // Day 29: the trial, so the fifty-first term corrects the take.
    vi.setSystemTime(start + 29 * DAY)
    await dictateAgain(app)
    expect(app.historyAdds().at(-1)?.text).toBe('Open Dataverse now.')

    // Day 31, same session: Free uses the first fifty, and the list is intact.
    vi.setSystemTime(start + 31 * DAY)
    await dictateAgain(app)
    expect(app.historyAdds()).toHaveLength(2)
    expect(app.historyAdds().at(-1)?.text).toBe('Open data verse now.')
    expect(app.invoke('licence:status', true)).toMatchObject({ plan: 'free', trialEndNoticeDue: true })
  })
})

/**
 * A server of the user's own — whisper.cpp, Speaches, a corporate deployment
 * — may need no key, so a saved endpoint alone makes the cloud ready: the
 * first-run page, the tray and Record all follow it. Test connection asks the
 * saved endpoint, once, and the stubbed store hands the service no key.
 */
describe('a server of the user’s own, with no key', () => {
  const LOCAL_SERVER = 'http://localhost:8080/v1'
  type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

  /** Stands in for the server, answering every request with a fresh `reply`. */
  const stubServer = (reply: () => Response): Mock<FetchFn> => {
    const fetchMock = vi.fn<FetchFn>(async () => reply())
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  const answer =
    (status: number, payload: unknown) =>
    (): Response =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' }
      })

  it('is ready with no key: History on a first run, and Start recording in the tray', async () => {
    const app = await startApp({ engine: 'cloud', apiKeySource: 'none', apiEndpoint: LOCAL_SERVER })
    expect(app.invoke('engine:get-status', true)).toMatchObject({
      engine: 'cloud',
      ready: true,
      notReadyReason: null
    })
    app.invoke('app:ready', true)
    expect(app.sentToMain()).toContainEqual({ channel: 'app:navigate', payload: 'history' })
    expect(app.trayItem('Start recording')?.enabled).toBe(true)
    expect(app.trayLabels()[0]).toBe('Hold Left Ctrl + Left Shift to talk')
  })

  it('tells the window the cloud is ready once an endpoint is saved', async () => {
    const app = await startApp({ engine: 'cloud', apiKeySource: 'none' })
    expect(app.invoke('engine:get-status', true)).toMatchObject({ ready: false })
    await app.invoke('settings:save', true, { apiEndpoint: LOCAL_SERVER })
    expect(lastEngineBroadcast(app)).toMatchObject({
      engine: 'cloud',
      ready: true,
      notReadyReason: null
    })
  })

  it('sends a take to it with no Authorization header at all', async () => {
    const server = stubServer(answer(200, { text: 'Hello from my own server.' }))
    const app = await startApp({ engine: 'cloud', apiKeySource: 'none', apiEndpoint: LOCAL_SERVER })

    await dictateFromWindow(app, wavBytes(1600))

    expect(server).toHaveBeenCalledTimes(1)
    const [url, init] = server.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:8080/v1/audio/transcriptions')
    expect(new Headers(init?.headers).has('authorization')).toBe(false)
    expect(workflowErrors(app)).toEqual([])
    expect(app.historyAdds()).toMatchObject([{ text: 'Hello from my own server.' }])
  })

  it('tests the saved endpoint with one second of silence, for the main window only', async () => {
    const server = stubServer(answer(200, { text: '' }))
    const app = await startApp({ engine: 'cloud', apiKeySource: 'none', apiEndpoint: LOCAL_SERVER })

    await expect(
      Promise.resolve().then(() => app.invoke('transcription:test', false))
    ).rejects.toThrow('Forbidden.')
    expect(server).not.toHaveBeenCalled()

    // An empty transcript of silence is the answer a working server gives.
    const result = (await app.invoke('transcription:test', true)) as TranscriptionTestResult
    expect(result).toEqual({ ok: true, ms: expect.any(Number), error: null })
    expect(server).toHaveBeenCalledTimes(1)
    const [url, init] = server.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:8080/v1/audio/transcriptions')
    expect(new Headers(init?.headers).has('authorization')).toBe(false)
    const file = (init?.body as FormData).get('file') as unknown as File
    expect(file.name).toBe('dictation.wav')
    // 16,000 samples of 16-bit mono after a 44-byte header.
    expect(file.size).toBe(32_044)
  })

  it('reports a busy server at once, without the quiet retry a dictation gets', async () => {
    const server = stubServer(answer(503, { error: { message: 'busy' } }))
    const app = await startApp({ engine: 'cloud', apiKeySource: 'none', apiEndpoint: LOCAL_SERVER })
    await expect(app.invoke('transcription:test', true)).resolves.toEqual({
      ok: false,
      ms: null,
      error: 'The transcription service is temporarily unavailable.'
    })
    expect(server).toHaveBeenCalledTimes(1)
  })

  it('names the server when it wants a key after all', async () => {
    stubServer(answer(401, { error: { message: 'Unauthorized' } }))
    const app = await startApp({ engine: 'cloud', apiKeySource: 'none', apiEndpoint: LOCAL_SERVER })
    await expect(app.invoke('transcription:test', true)).resolves.toEqual({
      ok: false,
      ms: null,
      error:
        'The server at localhost:8080 refused the request (HTTP 401). If it needs a key, add one in Settings.'
    })
  })

  it('sends OpenAI nothing without a key, and says what is missing', async () => {
    const server = stubServer(answer(200, { text: 'never sent' }))
    const app = await startApp({ engine: 'cloud', apiKeySource: 'none' })
    await expect(app.invoke('transcription:test', true)).resolves.toEqual({
      ok: false,
      ms: null,
      error: 'Add an API key in Settings before recording.'
    })
    expect(server).not.toHaveBeenCalled()
  })

  it('asks whether a local server is running when nothing answers, and blames the network elsewhere', async () => {
    // Nothing is listening: every connection is refused.
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchFn>(() => Promise.reject(new TypeError('fetch failed')))
    )
    const local = await startApp({ engine: 'cloud', apiKeySource: 'none', apiEndpoint: LOCAL_SERVER })
    await expect(local.invoke('transcription:test', true)).resolves.toEqual({
      ok: false,
      ms: null,
      error: 'Could not reach the transcription server at localhost:8080. Is it running?'
    })

    const remote = await startApp({
      engine: 'cloud',
      apiKeySource: 'none',
      apiEndpoint: 'https://transcribe.example.com/v1'
    })
    await expect(remote.invoke('transcription:test', true)).resolves.toEqual({
      ok: false,
      ms: null,
      error: 'Could not reach the transcription service. Check your internet connection.'
    })
  })
})

describe('after a sleep or the lock screen', () => {
  const startTake = (app: StartupHarness): string => {
    app.invoke('dictation:start', true)
    const start = app
      .sentToRecorder()
      .filter((message) => message.channel === 'recorder:start')
      .at(-1)?.payload as { requestId: string }
    app.emitFromRecorder('recorder:started', { requestId: start.requestId })
    return start.requestId
  }
  const lastPhase = (app: StartupHarness): string | undefined =>
    (
      app
        .sentToMain()
        .filter(({ channel }) => channel === 'workflow:status')
        .at(-1)?.payload as { phase?: string } | undefined
    )?.phase

  it('puts the keyboard hook back when the user returns, once for a resume and unlock together', async () => {
    const app = await startApp()
    expect(app.hookStarts()).toBe(1)

    app.powerEvent('resume')
    expect(app.hookStops()).toBe(1)
    expect(app.hookStarts()).toBe(2)

    app.powerEvent('unlock-screen')
    expect(app.hookStarts()).toBe(2)
  })

  it('leaves the hook alone when the PC goes to sleep or is locked', async () => {
    const app = await startApp()
    app.powerEvent('suspend')
    app.powerEvent('lock-screen')
    expect(app.hookStops()).toBe(0)
    expect(app.hookStarts()).toBe(1)
  })

  it('finishes a take still recording when the PC is locked, so what was said is kept', async () => {
    const app = await startApp()
    const requestId = startTake(app)
    expect(lastPhase(app)).toBe('recording')

    app.powerEvent('lock-screen')
    expect(app.sentToRecorder().at(-1)).toEqual({
      channel: 'recorder:stop',
      payload: { requestId }
    })
  })

  it('finishes it too when the PC goes to sleep', async () => {
    const app = await startApp()
    const requestId = startTake(app)
    app.powerEvent('suspend')
    expect(app.sentToRecorder().at(-1)).toEqual({
      channel: 'recorder:stop',
      payload: { requestId }
    })
  })

  it('cancels a take found still recording when the user returns, then puts the hook back', async () => {
    const app = await startApp()
    startTake(app)
    app.powerEvent('unlock-screen')
    expect(lastPhase(app)).toBe('cancelled')
    expect(app.hookStarts()).toBe(2)
  })
})

describe('the update check', () => {
  const githubRelease = (): Response =>
    new Response(
      JSON.stringify({
        tag_name: 'v0.6.0',
        html_url: 'https://github.com/banuca/murmur/releases/tag/v0.6.0'
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  it('sends nothing at startup, and nothing to GitHub unless asked', async () => {
    const app = await startApp({ githubReply: githubRelease })
    await app.settle()
    expect(app.githubRequests()).toEqual([])
    expect(app.storedUpdateCheck()).toBe(false)
  })

  it('answers only the main window, and takes only a real switch position', async () => {
    const app = await startApp({ githubReply: githubRelease })
    for (const channel of ['update:status', 'update:check-now', 'update:set-enabled']) {
      expect(() => app.invoke(channel, false, true)).toThrow('Forbidden.')
    }
    expect(() => app.invoke('update:set-enabled', true, 'yes')).toThrow('Invalid update setting.')
    const status = app.invoke('update:set-enabled', true, true) as { enabled: boolean }
    expect(status.enabled).toBe(true)
    expect(app.storedUpdateCheck()).toBe(true)
    // Switching it on sends nothing there and then.
    expect(app.githubRequests()).toEqual([])
  })

  it('checks when asked, then offers the release page in the tray and the window', async () => {
    const app = await startApp({ githubReply: githubRelease })
    // Nothing on offer yet, so the release target opens nothing.
    await app.invoke('app:open-external', true, 'release')
    expect(app.openedExternally()).toEqual([])

    const status = (await app.invoke('update:check-now', true)) as { state: string; latest: string }
    expect(status).toMatchObject({ state: 'available', latest: 'v0.6.0' })
    expect(app.githubRequests()).toHaveLength(1)
    expect(app.githubRequests()[0]?.url).toBe(
      'https://api.github.com/repos/banuca/murmur/releases/latest'
    )
    expect(
      app.sentToMain().filter(({ channel }) => channel === 'update:status').at(-1)?.payload
    ).toMatchObject({ state: 'available' })
    expect(app.trayLabels()).toContain('Update available: 0.6.0 — open download page')

    await app.invoke('app:open-external', true, 'release')
    expect(app.openedExternally()).toEqual(['https://github.com/banuca/murmur/releases/tag/v0.6.0'])
  })

  it('shows no tray line when the check finds nothing newer or fails', async () => {
    const app = await startApp()
    const status = (await app.invoke('update:check-now', true)) as { state: string; error: string }
    expect(status).toMatchObject({
      state: 'error',
      error: 'Could not reach GitHub. Check your internet connection and try again.'
    })
    expect(app.trayLabels().some((label) => label.startsWith('Update available'))).toBe(false)
  })
})

describe('AI polish', () => {
  const polishReply = (): Response =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'This is a test of the polish.' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  const stubChat = () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return polishReply()
      })
    )
    return calls
  }

  it('answers Test and Remove key only from the main window', async () => {
    const app = await startApp()
    for (const channel of ['polish:test', 'settings:clear-polish-key']) {
      // One handler is async and rejects; the other throws. Either way, refused.
      await expect(Promise.resolve().then(() => app.invoke(channel, false))).rejects.toThrow(
        'Forbidden.'
      )
    }
  })

  it('tests with the saved provider, and reports what came back', async () => {
    const calls = stubChat()
    const app = await startApp({
      polishKey: 'sk-polish',
      polish: { polishEndpoint: 'https://llm.example.com/v1', polishModel: 'house-model' }
    })
    const result = (await app.invoke('polish:test', true)) as { ok: boolean; text: string; ms: number }
    expect(result).toMatchObject({ ok: true, text: 'This is a test of the polish.' })
    expect(result.ms).toBeGreaterThanOrEqual(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://llm.example.com/v1/chat/completions')
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-polish')
    const body = JSON.parse(String(calls[0]?.init.body)) as { model: string; messages: Array<{ content: string }> }
    expect(body.model).toBe('house-model')
    expect(body.messages[1]?.content).toBe('this is a test um of the polish')
  })

  it('borrows the transcription key only when both go to OpenAI', async () => {
    const both = stubChat()
    const openai = await startApp({ apiKey: 'sk-openai' })
    await openai.invoke('polish:test', true)
    expect((both[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-openai')
    vi.unstubAllGlobals()

    // Transcription goes to Groq: its key is Groq's, and never goes to OpenAI.
    const elsewhere = stubChat()
    const groq = await startApp({ apiKey: 'gsk-groq', apiEndpoint: 'https://api.groq.com/openai/v1' })
    await groq.invoke('polish:test', true)
    expect(elsewhere[0]?.init.headers).not.toHaveProperty('Authorization')
    vi.unstubAllGlobals()

    // Polish goes to a server of the user's own: the OpenAI key stays put.
    const local = stubChat()
    const ollama = await startApp({
      apiKey: 'sk-openai',
      polish: { polishEndpoint: 'http://localhost:11434/v1', polishModel: 'llama3.2:3b' }
    })
    await ollama.invoke('polish:test', true)
    expect(local[0]?.url).toBe('http://localhost:11434/v1/chat/completions')
    expect(local[0]?.init.headers).not.toHaveProperty('Authorization')
  })

  it('says why a test failed, in a sentence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )
    const app = await startApp({
      polish: { polishEndpoint: 'http://localhost:11434/v1', polishModel: 'llama3.2:3b' }
    })
    await expect(app.invoke('polish:test', true)).resolves.toEqual({
      ok: false,
      text: null,
      ms: null,
      error: 'Could not reach localhost:11434. Is it running?'
    })
  })
})
