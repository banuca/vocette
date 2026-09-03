import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions
} from 'electron'
import {
  DictationController,
  type SoundKind,
  type TranscriptionPayload,
  type WorkflowSettings
} from './dictation-controller'
import { ForegroundTracker } from './foreground'
import { HistoryStore } from './history-store'
import { SettingsStore } from './settings-store'
import { ShortcutController } from './shortcut-controller'
import { TranscriptionService } from './transcription-service'
import { formatDuration } from '../shared/format'
import { chordLabel } from '../shared/keycodes'
import type {
  Page,
  RecorderAudioPayload,
  RecorderErrorPayload,
  RecorderStartedPayload,
  SettingsUpdate,
  WorkflowStatus
} from '../shared/types'

/** Long enough for the overlay's exit animation to finish. */
const OVERLAY_HIDE_MS = 220
/** Shortcut capture gives up on its own so the hook can never stay hijacked. */
const CAPTURE_TIMEOUT_MS = 10_000
/** Upper bound for waiting on the final history flush before quitting. */
const QUIT_FLUSH_TIMEOUT_MS = 3000

let mainWindow: BrowserWindow | null = null
let recorderWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let tray: Tray | null = null

let settingsStore: SettingsStore
let historyStore: HistoryStore
let shortcutController: ShortcutController
let dictation: DictationController
let foreground: ForegroundTracker

const transcriber = new TranscriptionService()

let isQuitting = false
let mainWindowReady = false
let pendingNavigation: Page | null = null

let overlayHideTimer: NodeJS.Timeout | null = null
let captureTimeout: NodeJS.Timeout | null = null
let overlayVisible = false
let quitFlushed = false

function clearTimer(timer: NodeJS.Timeout | null): null {
  if (timer) clearTimeout(timer)
  return null
}

function resourcePath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', name)
    : join(app.getAppPath(), 'resources', name)
}

async function loadWindow(
  window: BrowserWindow,
  page: string,
  query: Record<string, string> = {}
): Promise<void> {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  const search = new URLSearchParams(query).toString()
  if (developmentUrl) {
    const base = developmentUrl.replace(/\/$/u, '')
    await window.loadURL(`${base}/${page}${search ? `?${search}` : ''}`)
    return
  }
  const file = join(__dirname, '../renderer', page)
  // `loadFile` rejects an empty query object, so only pass one when set.
  await (search ? window.loadFile(file, { query }) : window.loadFile(file))
}

function positionOverlay(): void {
  if (!overlayWindow) return
  const point = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(point)
  const { width, height } = overlayWindow.getBounds()
  overlayWindow.setPosition(
    Math.round(workArea.x + (workArea.width - width) / 2),
    Math.round(workArea.y + workArea.height - height - 36),
    false
  )
}

function broadcastStatus(status: WorkflowStatus): void {
  mainWindow?.webContents.send('workflow:status', status)
  overlayWindow?.webContents.send('workflow:status', status)

  // The tray tooltip mirrors the workflow so the state is visible even with
  // the overlay off-screen.
  const tooltipByPhase: Record<WorkflowStatus['phase'], string> = {
    idle: 'Voice Hotkey',
    starting: 'Voice Hotkey — starting microphone…',
    recording: 'Voice Hotkey — listening…',
    processing: 'Voice Hotkey — transcribing…',
    success: 'Voice Hotkey — copied to clipboard',
    error: `Voice Hotkey — ${status.detail ?? 'dictation failed'}`
  }
  tray?.setToolTip(tooltipByPhase[status.phase])

  if (status.phase === 'idle') {
    // Let the overlay play its exit animation before the window disappears.
    overlayHideTimer = clearTimer(overlayHideTimer)
    if (overlayVisible) {
      overlayHideTimer = setTimeout(() => {
        overlayHideTimer = null
        overlayVisible = false
        overlayWindow?.hide()
      }, OVERLAY_HIDE_MS)
    }
    return
  }

  overlayHideTimer = clearTimer(overlayHideTimer)
  if (overlayWindow && !overlayVisible) {
    positionOverlay()
    overlayWindow.showInactive()
    overlayVisible = true
  }
}

function shortcutLabel(): string {
  return chordLabel(settingsStore.getInternal().shortcut.keys)
}

function showMain(page: Page = 'history'): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  if (mainWindowReady) {
    mainWindow.webContents.send('app:navigate', page)
  } else {
    // The renderer announces itself with `app:ready`; queue until then so a
    // cold start cannot drop the navigation.
    pendingNavigation = page
  }
}

function workflowSettings(): WorkflowSettings {
  const settings = settingsStore.getInternal()
  return {
    autoPaste: settings.autoPaste,
    removeFillers: settings.removeFillers,
    playSounds: settings.playSounds,
    model: settings.model,
    language: settings.language,
    microphoneId: settings.microphoneId,
    apiKeyConfigured: settingsStore.getPublic().apiKeyConfigured
  }
}

function playSound(kind: SoundKind): void {
  if (!settingsStore.getInternal().playSounds) return
  const beeps = kind === 'start' ? 1 : 2
  for (let index = 0; index < beeps; index += 1) shell.beep()
}

function recordHistory(text: string, durationMs: number, model: string): void {
  historyStore.add({ text, durationMs, model })
  historyStore.prune(settingsStore.getInternal().historyRetentionDays)
  mainWindow?.webContents.send('history:changed')
}

function transcribe(payload: TranscriptionPayload): Promise<string> {
  return transcriber.transcribe({
    audio: payload.audio,
    mimeType: payload.mimeType,
    apiKey: settingsStore.getApiKey(),
    model: payload.model,
    language: payload.language,
    endpoint: settingsStore.getInternal().apiEndpoint
  })
}

function createDictationController(): DictationController {
  return new DictationController({
    sendToRecorder: (channel, payload) => recorderWindow?.webContents.send(channel, payload),
    getSettings: workflowSettings,
    transcribe,
    writeClipboard: (text) => clipboard.writeText(text),
    paste: () => shortcutController.paste(),
    playSound,
    broadcastStatus,
    showMain,
    recordHistory,
    captureForeground: () => foreground.capture(),
    getForegroundState: () => foreground.check(),
    shortcutLabel,
    onRetryChanged: () => rebuildTrayMenu()
  })
}

function hardenWebContents(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
}

async function createWindows(): Promise<void> {
  const icon = resourcePath('icon.png')
  const sharedPreferences = {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  } as const
  const preload = join(__dirname, '../preload/index.js')

  mainWindow = new BrowserWindow({
    width: 1060,
    height: 720,
    minWidth: 860,
    minHeight: 620,
    show: false,
    title: 'Voice Hotkey',
    backgroundColor: '#f4f6fb',
    icon,
    webPreferences: { ...sharedPreferences, preload }
  })
  mainWindow.setMenuBarVisibility(false)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('hide', () => {
    // Never leave the keyboard hook in capture mode behind a hidden window.
    if (shortcutController?.isCapturing()) endCapture()
  })
  hardenWebContents(mainWindow)

  recorderWindow = new BrowserWindow({
    width: 2,
    height: 2,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      ...sharedPreferences,
      backgroundThrottling: false,
      preload: join(__dirname, '../preload/recorder.js')
    }
  })
  hardenWebContents(recorderWindow)

  overlayWindow = new BrowserWindow({
    width: 480,
    height: 96,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: { ...sharedPreferences, backgroundThrottling: false, preload }
  })
  overlayWindow.setIgnoreMouseEvents(true)
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  hardenWebContents(overlayWindow)

  await Promise.all([
    loadWindow(mainWindow, 'index.html'),
    loadWindow(recorderWindow, 'recorder.html'),
    loadWindow(overlayWindow, 'overlay.html')
  ])
}

function applyLaunchAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--background'] })
}

function rebuildTrayMenu(): void {
  if (!tray || !dictation) return
  const settings = settingsStore.getPublic()
  const template: MenuItemConstructorOptions[] = [
    { label: `Hold ${shortcutLabel()} to talk`, enabled: false },
    { type: 'separator' },
    { label: 'Open history', click: () => showMain('history') },
    { label: 'Settings', click: () => showMain('settings') },
    {
      label: 'Retry last dictation',
      enabled: dictation.canRetry(),
      click: () => void dictation.retryLast()
    },
    { type: 'separator' },
    {
      label: 'Enable hold-to-talk',
      type: 'checkbox',
      checked: shortcutController.isEnabled(),
      click: (item) => {
        shortcutController.setEnabled(item.checked)
        settingsStore.update({ hotkeyEnabled: item.checked })
        mainWindow?.webContents.send('settings:changed', settingsStore.getPublic())
        rebuildTrayMenu()
      }
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: settings.launchAtLogin,
      click: (item) => {
        settingsStore.update({ launchAtLogin: item.checked })
        applyLaunchAtLogin(item.checked)
        mainWindow?.webContents.send('settings:changed', settingsStore.getPublic())
        rebuildTrayMenu()
      }
    },
    { type: 'separator' },
    {
      // Recovery for a missed keyup, which happens when the chord is released
      // while an elevated window has focus. Also cancels a stuck take, which
      // used to wedge the recorder until the app was restarted.
      label: 'Reset shortcut state',
      click: () => {
        shortcutController.resetKeyState()
        dictation.resetKeyState()
      }
    },
    {
      label: 'Quit Voice Hotkey',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(resourcePath('tray.png')))
  tray.setToolTip('Voice Hotkey')
  tray.on('click', () => showMain('history'))
  rebuildTrayMenu()
}

function endCapture(): void {
  captureTimeout = clearTimer(captureTimeout)
  shortcutController.cancelCapture()
  // A settings page mid-capture must reset its UI, even when the capture was
  // torn down from the main side (window hidden, timeout).
  mainWindow?.webContents.send('shortcut:capture', { keys: [], done: true })
}

/** Only the window that owns a channel may use it; everything else is denied. */
function fromWindow(event: IpcMainEvent | IpcMainInvokeEvent, window: BrowserWindow | null): boolean {
  return window !== null && event.sender === window.webContents
}

function registerIpc(): void {
  const fromMain = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    fromWindow(event, mainWindow)

  ipcMain.handle('settings:get', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    return settingsStore.getPublic()
  })

  ipcMain.handle('settings:save', (event, update: SettingsUpdate) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    const before = settingsStore.getInternal()
    const result = settingsStore.update(update ?? {})
    const after = settingsStore.getInternal()

    if (chordLabel(before.shortcut.keys) !== chordLabel(after.shortcut.keys)) {
      shortcutController.setChord(after.shortcut)
    }
    if (before.holdDelayMs !== after.holdDelayMs) {
      shortcutController.setHoldDelay(after.holdDelayMs)
    }
    if (before.hotkeyEnabled !== after.hotkeyEnabled) {
      shortcutController.setEnabled(after.hotkeyEnabled)
    }
    if (before.launchAtLogin !== after.launchAtLogin) applyLaunchAtLogin(after.launchAtLogin)

    if (historyStore.prune(after.historyRetentionDays)) {
      mainWindow?.webContents.send('history:changed')
    }
    rebuildTrayMenu()
    return result
  })

  ipcMain.handle('settings:clear-api-key', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    return settingsStore.clearApiKey()
  })

  ipcMain.handle('history:list', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    return historyStore.list()
  })
  ipcMain.handle('history:delete', (event, id: unknown) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid history entry.')
    return historyStore.delete(id)
  })
  ipcMain.handle('history:clear', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    historyStore.clear()
    mainWindow?.webContents.send('history:changed')
  })
  ipcMain.handle('history:export', async (event, format: unknown) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    if (format !== 'json' && format !== 'txt') throw new Error('Invalid export format.')
    if (!mainWindow) return { saved: false, path: null }
    const entries = historyStore.list()
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export transcript history',
      defaultPath: `voice-hotkey-history-${new Date().toISOString().slice(0, 10)}.${format}`,
      filters: [{ name: format === 'json' ? 'JSON document' : 'Text document', extensions: [format] }]
    })
    if (result.canceled || !result.filePath) return { saved: false, path: null }
    const content =
      format === 'json'
        ? `${JSON.stringify(entries, null, 2)}\n`
        : `${entries
            .map((entry) => `${entry.createdAt}  [${formatDuration(entry.durationMs)}]  ${entry.text}`)
            .join('\n\n')}\n`
    await writeFile(result.filePath, content, 'utf8')
    return { saved: true, path: result.filePath }
  })

  ipcMain.handle('clipboard:write', (event, text: unknown) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    if (typeof text !== 'string' || text.length > 250_000) throw new Error('Invalid clipboard text.')
    clipboard.writeText(text)
  })

  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }))
  ipcMain.handle('app:hide-window', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    mainWindow?.hide()
  })
  ipcMain.handle('app:ready', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    mainWindowReady = true
    if (pendingNavigation) {
      mainWindow?.webContents.send('app:navigate', pendingNavigation)
      pendingNavigation = null
    }
  })
  ipcMain.handle('app:open-external', async (event, target: unknown) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    const targets: Record<string, string> = {
      'api-keys': 'https://platform.openai.com/api-keys',
      'transcription-docs': 'https://developers.openai.com/api/docs/guides/speech-to-text'
    }
    const url = typeof target === 'string' ? targets[target] : undefined
    if (!url) return
    await shell.openExternal(url)
  })

  ipcMain.handle('shortcut:begin-capture', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    shortcutController.beginCapture()
    captureTimeout = clearTimer(captureTimeout)
    captureTimeout = setTimeout(endCapture, CAPTURE_TIMEOUT_MS)
  })
  ipcMain.handle('shortcut:cancel-capture', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    endCapture()
  })

  const fromRecorder = (event: IpcMainEvent): boolean => fromWindow(event, recorderWindow)

  ipcMain.on('recorder:started', (event, payload: RecorderStartedPayload) => {
    if (!fromRecorder(event)) return
    if (payload && typeof payload.requestId === 'string') dictation.onRecorderStarted(payload)
  })
  ipcMain.on('recorder:audio', (event, payload: RecorderAudioPayload) => {
    if (!fromRecorder(event)) return
    if (payload && typeof payload.requestId === 'string') void dictation.onRecorderAudio(payload)
  })
  ipcMain.on('recorder:error', (event, payload: RecorderErrorPayload) => {
    if (!fromRecorder(event)) return
    if (payload && typeof payload.requestId === 'string' && typeof payload.message === 'string') {
      dictation.onRecorderError(payload)
    }
  })
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData')
  settingsStore = new SettingsStore(join(userData, 'settings.json'))
  historyStore = new HistoryStore(join(userData, 'history.json'))
  historyStore.prune(settingsStore.getInternal().historyRetentionDays)

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => permission === 'media'
  )
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) =>
    callback(permission === 'media')
  )

  const initial = settingsStore.getInternal()
  foreground = new ForegroundTracker()
  shortcutController = new ShortcutController({
    chord: initial.shortcut,
    holdDelayMs: initial.holdDelayMs,
    onPress: () => dictation.onShortcutPressed(),
    onRelease: () => dictation.onShortcutReleased(),
    onError: (message) => dictation.reportError(message),
    onCapture: (keys, done) => {
      if (done) captureTimeout = clearTimer(captureTimeout)
      mainWindow?.webContents.send('shortcut:capture', { keys, done })
    }
  })
  shortcutController.setEnabled(initial.hotkeyEnabled)
  dictation = createDictationController()

  registerIpc()
  await createWindows()
  createTray()
  applyLaunchAtLogin(initial.launchAtLogin)
  shortcutController.start()

  const startsInBackground = process.argv.includes('--background')
  if (!startsInBackground) {
    showMain(settingsStore.getPublic().apiKeyConfigured ? 'history' : 'settings')
  }

  // A recovered or damaged data file is worth telling the user about — the old
  // build reset silently.
  const warnings = [settingsStore.takeWarning(), historyStore.takeWarning()].filter(Boolean)
  if (warnings.length) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Voice Hotkey recovered your data',
      message: 'Some saved data could not be read.',
      detail: warnings.join('\n\n')
    })
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMain('history'))
  app.whenReady().then(bootstrap).catch((error: unknown) => {
    dialog.showErrorBox(
      'Voice Hotkey could not start',
      error instanceof Error ? error.message : 'An unexpected startup error occurred.'
    )
    app.quit()
  })
}

app.on('before-quit', (event) => {
  isQuitting = true
  dictation?.shutdown()
  shortcutController?.stop()
  captureTimeout = clearTimer(captureTimeout)
  overlayHideTimer = clearTimer(overlayHideTimer)

  if (quitFlushed || !historyStore) return
  // History writes are async and coalesced; quitting must wait for the last
  // one or the newest transcript can be lost between fsync and rename.
  event.preventDefault()
  quitFlushed = true
  const forceQuit = setTimeout(() => app.exit(0), QUIT_FLUSH_TIMEOUT_MS)
  void historyStore.flush().finally(() => {
    clearTimeout(forceQuit)
    app.quit()
  })
})

// Voice Hotkey lives in the tray; closing the window must not quit it.
app.on('window-all-closed', () => {})
