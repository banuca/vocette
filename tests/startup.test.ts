import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/main/settings-store'
import type { EngineStatus } from '../src/shared/engine'
import type { HistorySaveStatus } from '../src/shared/types'

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
  invoke: (channel: string, fromMainWindow: boolean, ...args: unknown[]) => unknown
  /** Delivers a message from the hidden recorder window. */
  emitFromRecorder: (channel: string, payload: unknown) => void
  sentToRecorder: () => Array<{ channel: string; payload: unknown }>
  pressShortcut: () => void
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
  modelState?: StoredModelState
  /** Another application already owns every system shortcut Murmur asks for. */
  acceleratorTaken?: boolean
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
  let shortcutPress: (() => void) | null = null
  const accelerators = new Set<string>()
  // Saved settings are remembered, so a save can be seen to take effect.
  let storedSettings: typeof DEFAULT_SETTINGS = { ...DEFAULT_SETTINGS, historyRetentionDays: 30 }
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
    shell: { beep: vi.fn(), openExternal: vi.fn(() => Promise.resolve()) },
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
        engine: engineChoice,
        launchAtLogin: false,
        recordingMode: 'hold'
      })
      getApiKey = () => ''
      keyStorage = () => ({ usable: true, reason: '', backend: 'os' })
      update = vi.fn((patch: Partial<typeof DEFAULT_SETTINGS>) => {
        storedSettings = { ...storedSettings, ...patch }
        if (saveStoresKey) apiKeySource = 'stored'
        return {}
      })
      clearApiKey = vi.fn()
      clearSessionApiKey = vi.fn()
      takeWarning = () => null
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
      prewarm = vi.fn()
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
      createShortcutBackend: (backendOptions: { onPress: () => void }) => {
        shortcutPress = backendOptions.onPress
        return {
          supportsHold: true,
          supportsCapture: true,
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
          stop: vi.fn(),
          start: (): void => {
            hookStarted = true
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

  return {
    emitFromRecorder: (channel: string, payload: unknown): void => {
      const listener = ipcListeners.get(channel)
      if (!listener) throw new Error(`No listener registered for ${channel}.`)
      listener({ sender: recorderWindow?.webContents }, payload)
    },
    sentToRecorder: () =>
      (recorderWindow?.webContents.send.mock.calls ?? []).map(([channel, payload]) => ({
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
    invoke: (channel: string, fromMainWindow: boolean, ...args: unknown[]): unknown => {
      const handler = ipcHandlers.get(channel)
      if (!handler) throw new Error(`No handler registered for ${channel}.`)
      const sender = fromMainWindow ? mainWindow?.webContents : windows[1]?.webContents
      return handler({ sender }, ...args)
    },
    pressShortcut: () => shortcutPress?.(),
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
    registeredAccelerators: () => [...accelerators]
  }
}

afterEach(() => {
  vi.doUnmock('electron')
  vi.resetModules()
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

/** Records one take from the window's Record button and hands over `audio`. */
async function dictateFromWindow(
  app: StartupHarness,
  audio: Uint8Array,
  mimeType = 'audio/wav'
): Promise<void> {
  app.invoke('dictation:start', true)
  const start = app.sentToRecorder().find((message) => message.channel === 'recorder:start')
  const { requestId } = start?.payload as { requestId: string }
  app.emitFromRecorder('recorder:started', { requestId })
  app.invoke('dictation:stop', true)
  app.emitFromRecorder('recorder:audio', { requestId, audio, mimeType, durationMs: 100 })
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
      { text: 'Hello from this PC.', durationMs: 100, model: 'parakeet-tdt-0.6b-v3-int8' }
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
