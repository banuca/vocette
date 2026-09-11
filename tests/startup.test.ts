import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/main/settings-store'
import type { HistorySaveStatus } from '../src/shared/types'

/**
 * Covers `bootstrap()` through its real calling path — `app.whenReady()` and
 * the fatal startup handler — with Electron and both stores mocked.
 *
 * The startup retention pass used to be awaited before any window existed, so
 * a storage failure reached the fatal handler and the app quit: no windows, no
 * tray, no way to dictate, over history that could not be tidied.
 */

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
  pressShortcut: () => void
  setCapabilities: (patch: Record<string, unknown>) => void
  sentToMain: () => Array<{ channel: string; payload: unknown }>
  trayLabels: () => string[]
  setSaveStatus: (status: HistorySaveStatus) => void
}

async function startApp(options: {
  pruneRejection?: Error
  settingsConstructorError?: Error
} = {}): Promise<StartupHarness> {
  vi.resetModules()

  const windowOptions: Array<Record<string, unknown>> = []
  const messageBoxes: Array<{ title?: string; message?: string; detail?: string }> = []
  const errorBoxes: Array<{ title: string; content: string }> = []
  const loginItems: Array<{ openAtLogin: boolean; args?: string[] }> = []
  const pruneCalls: number[] = []
  const timeline: string[] = []
  const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const trayTemplates: Array<Array<{ label?: string }>> = []
  const windows: FakeBrowserWindow[] = []
  const saveStatusListeners: Array<(status: HistorySaveStatus) => void> = []
  let saveStatus: HistorySaveStatus = { saveFailed: false }
  let trays = 0
  let quits = 0
  let hookStarted = false
  let shortcutPress: (() => void) | null = null
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
      on: vi.fn(),
      quit: () => {
        quits += 1
      },
      exit: vi.fn()
    },
    BrowserWindow: FakeBrowserWindow,
    Tray: FakeTray,
    Menu: {
      buildFromTemplate: vi.fn((template: Array<{ label?: string }>) => {
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
      on: vi.fn()
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
      register: vi.fn(() => true),
      unregister: vi.fn(),
      isRegistered: vi.fn(() => true),
      unregisterAll: vi.fn()
    }
  }))

  vi.doMock('../src/main/settings-store', () => ({
    SettingsStore: class {
      constructor() {
        if (options.settingsConstructorError) throw options.settingsConstructorError
      }
      getInternal = (): typeof DEFAULT_SETTINGS => ({ ...DEFAULT_SETTINGS, historyRetentionDays: 30 })
      getPublic = () => ({ apiKeySource: 'stored', launchAtLogin: false, recordingMode: 'hold' })
      getApiKey = () => ''
      keyStorage = () => ({ usable: true, reason: '', backend: 'os' })
      update = vi.fn(() => ({}))
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
      add = vi.fn()
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
  for (let tick = 0; tick < 25; tick += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }

  const mainWindow = windows[0]

  return {
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
    setSaveStatus: (status: HistorySaveStatus) => {
      saveStatus = status
      saveStatusListeners.forEach((listener) => listener(status))
    }
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
