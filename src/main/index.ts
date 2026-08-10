import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
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
  type MenuItemConstructorOptions
} from 'electron'
import { HistoryStore } from './history-store'
import { SettingsStore } from './settings-store'
import { ShortcutController } from './shortcut-controller'
import { TranscriptionService } from './transcription-service'
import { lightCleanup } from '../shared/cleanup'
import { chordLabel } from '../shared/keycodes'
import type {
  Page,
  RecorderAudioPayload,
  RecorderErrorPayload,
  RecorderStartedPayload,
  SettingsUpdate,
  WorkflowStatus
} from '../shared/types'

/** Hard stop for a single take. */
const MAX_RECORDING_MS = 5 * 60 * 1000
/** The microphone must report back within this long, or the take is abandoned. */
const START_WATCHDOG_MS = 8000
/** A stop request must produce audio or an error within this long. */
const STOP_WATCHDOG_MS = 10_000
/** Long enough for the overlay's exit animation to finish. */
const OVERLAY_HIDE_MS = 220
/** Shortcut capture gives up on its own so the hook can never stay hijacked. */
const CAPTURE_TIMEOUT_MS = 10_000

let mainWindow: BrowserWindow | null = null
let recorderWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let tray: Tray | null = null

let settingsStore: SettingsStore
let historyStore: HistoryStore
let shortcutController: ShortcutController

const transcriber = new TranscriptionService()

let isQuitting = false
let mainWindowReady = false
let pendingNavigation: Page | null = null

let currentStatus: WorkflowStatus = { phase: 'idle', message: 'Ready' }
let currentRequestId = ''
let releaseRequested = false
let stopRequested = false
let recordingStartedAt = 0

let statusResetTimer: NodeJS.Timeout | null = null
let maximumRecordingTimer: NodeJS.Timeout | null = null
let startWatchdog: NodeJS.Timeout | null = null
let stopWatchdog: NodeJS.Timeout | null = null
let overlayHideTimer: NodeJS.Timeout | null = null
let captureTimeout: NodeJS.Timeout | null = null
let overlayVisible = false

function clearTimer(timer: NodeJS.Timeout | null): null {
  if (timer) clearTimeout(timer)
  return null
}

function clearDictationTimers(): void {
  maximumRecordingTimer = clearTimer(maximumRecordingTimer)
  startWatchdog = clearTimer(startWatchdog)
  stopWatchdog = clearTimer(stopWatchdog)
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

function broadcastStatus(status: WorkflowStatus, resetAfterMs = 0): void {
  currentStatus = status
  mainWindow?.webContents.send('workflow:status', status)
  overlayWindow?.webContents.send('workflow:status', status)

  statusResetTimer = clearTimer(statusResetTimer)

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

  if (resetAfterMs > 0) {
    statusResetTimer = setTimeout(() => {
      statusResetTimer = null
      goIdle()
    }, resetAfterMs)
  }
}

function goIdle(): void {
  currentRequestId = ''
  releaseRequested = false
  stopRequested = false
  broadcastStatus({ phase: 'idle', message: 'Ready' })
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

function failDictation(message: string, openSettings = false): void {
  clearDictationTimers()
  currentRequestId = ''
  releaseRequested = false
  stopRequested = false
  broadcastStatus({ phase: 'error', message: 'Dictation failed', detail: message }, 4500)
  if (openSettings) showMain('settings')
}

function requestStop(): void {
  if (!currentRequestId || currentStatus.phase !== 'recording' || stopRequested) return
  stopRequested = true
  recorderWindow?.webContents.send('recorder:stop', { requestId: currentRequestId })
  armStopWatchdog()
}

/**
 * Used by the maximum-duration timer. Unlike `requestStop` this ignores
 * `stopRequested`: if the first stop request was lost, retrying is the only way
 * to finish the take. The previous build shared one guarded function between
 * both paths, so a lost stop wedged the app in `recording` permanently.
 */
function forceStop(): void {
  if (!currentRequestId) return
  stopRequested = true
  recorderWindow?.webContents.send('recorder:stop', { requestId: currentRequestId })
  armStopWatchdog()
}

function armStopWatchdog(): void {
  stopWatchdog = clearTimer(stopWatchdog)
  stopWatchdog = setTimeout(() => {
    stopWatchdog = null
    failDictation('The recording could not be finalised. Try again.')
  }, STOP_WATCHDOG_MS)
}

function onShortcutPressed(): void {
  const phase = currentStatus.phase
  if (phase === 'starting' || phase === 'recording' || phase === 'processing') return

  // `success` and `error` linger on screen for a few seconds. Pressing the
  // shortcut during that window used to be ignored, forcing a wait of up to
  // 4.5s between dictations.
  if (phase === 'success' || phase === 'error') {
    statusResetTimer = clearTimer(statusResetTimer)
  }

  if (!settingsStore.getPublic().apiKeyConfigured) {
    failDictation('Add your own OpenAI API key in Settings before recording.', true)
    return
  }

  currentRequestId = randomUUID()
  releaseRequested = false
  stopRequested = false
  recordingStartedAt = 0
  clearDictationTimers()

  broadcastStatus({
    phase: 'starting',
    message: 'Starting microphone…',
    detail: 'Keep holding the shortcut'
  })

  startWatchdog = setTimeout(() => {
    startWatchdog = null
    failDictation('The microphone did not start in time. Check it is connected and try again.')
  }, START_WATCHDOG_MS)

  recorderWindow?.webContents.send('recorder:start', {
    requestId: currentRequestId,
    microphoneId: settingsStore.getInternal().microphoneId
  })
}

function onShortcutReleased(): void {
  if (currentStatus.phase === 'starting') {
    releaseRequested = true
    return
  }
  if (currentStatus.phase === 'recording') requestStop()
}

function handleRecorderStarted(payload: RecorderStartedPayload): void {
  if (payload.requestId !== currentRequestId || currentStatus.phase !== 'starting') return
  startWatchdog = clearTimer(startWatchdog)
  recordingStartedAt = Date.now()
  broadcastStatus({
    phase: 'recording',
    message: 'Listening…',
    detail: `Release ${shortcutLabel()} to finish`,
    startedAt: recordingStartedAt
  })
  maximumRecordingTimer = setTimeout(forceStop, MAX_RECORDING_MS)
  if (releaseRequested) requestStop()
}

async function handleRecorderAudio(payload: RecorderAudioPayload): Promise<void> {
  if (payload.requestId !== currentRequestId) return
  if (currentStatus.phase !== 'recording' && currentStatus.phase !== 'starting') return
  clearDictationTimers()

  broadcastStatus({
    phase: 'processing',
    message: 'Transcribing…',
    detail: 'Your audio is being converted to text'
  })

  const audio = new Uint8Array(payload.audio)
  try {
    const settings = settingsStore.getInternal()
    const rawText = await transcriber.transcribe({
      audio,
      mimeType: payload.mimeType,
      apiKey: settingsStore.getApiKey(),
      model: settings.model,
      language: settings.language
    })
    const text = settings.removeFillers ? lightCleanup(rawText) : rawText.trim()
    if (!text) throw new Error('Only filler words or silence were detected.')

    historyStore.add({
      text,
      durationMs: Math.max(0, payload.durationMs),
      model: settings.model
    })
    historyStore.prune(settings.historyRetentionDays)
    mainWindow?.webContents.send('history:changed')

    clipboard.writeText(text)
    if (settings.autoPaste) {
      await new Promise((resolve) => setTimeout(resolve, 80))
      shortcutController.paste()
    }

    broadcastStatus(
      {
        phase: 'success',
        message: settings.autoPaste ? 'Copied and pasted' : 'Copied to clipboard',
        detail: text.length > 68 ? `${text.slice(0, 68)}…` : text
      },
      1600
    )
  } catch (error) {
    failDictation(error instanceof Error ? error.message : 'An unexpected error occurred.')
  } finally {
    audio.fill(0)
    releaseRequested = false
    stopRequested = false
  }
}

function handleRecorderError(payload: RecorderErrorPayload): void {
  if (payload.requestId !== currentRequestId) return
  failDictation(payload.message)
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
    width: 400,
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
  if (!tray) return
  const settings = settingsStore.getPublic()
  const template: MenuItemConstructorOptions[] = [
    { label: `Hold ${shortcutLabel()} to talk`, enabled: false },
    { type: 'separator' },
    { label: 'Open history', click: () => showMain('history') },
    { label: 'Settings', click: () => showMain('settings') },
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
      // while an elevated window has focus.
      label: 'Reset shortcut state',
      click: () => {
        shortcutController.resetKeyState()
        if (currentStatus.phase !== 'idle') goIdle()
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
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => settingsStore.getPublic())

  ipcMain.handle('settings:save', (_event, update: SettingsUpdate) => {
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

  ipcMain.handle('settings:clear-api-key', () => settingsStore.clearApiKey())

  ipcMain.handle('history:list', () => historyStore.list())
  ipcMain.handle('history:delete', (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid history entry.')
    return historyStore.delete(id)
  })
  ipcMain.handle('history:clear', () => {
    historyStore.clear()
    mainWindow?.webContents.send('history:changed')
  })

  ipcMain.handle('clipboard:write', (_event, text: unknown) => {
    if (typeof text !== 'string' || text.length > 250_000) throw new Error('Invalid clipboard text.')
    clipboard.writeText(text)
  })

  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }))
  ipcMain.handle('app:hide-window', () => mainWindow?.hide())
  ipcMain.handle('app:ready', () => {
    mainWindowReady = true
    if (pendingNavigation) {
      mainWindow?.webContents.send('app:navigate', pendingNavigation)
      pendingNavigation = null
    }
  })
  ipcMain.handle('app:open-external', async (_event, target: unknown) => {
    const targets: Record<string, string> = {
      'api-keys': 'https://platform.openai.com/api-keys',
      'transcription-docs': 'https://developers.openai.com/api/docs/guides/speech-to-text'
    }
    const url = typeof target === 'string' ? targets[target] : undefined
    if (!url) return
    await shell.openExternal(url)
  })

  ipcMain.handle('shortcut:begin-capture', () => {
    shortcutController.beginCapture()
    captureTimeout = clearTimer(captureTimeout)
    captureTimeout = setTimeout(() => {
      captureTimeout = null
      shortcutController.cancelCapture()
      mainWindow?.webContents.send('shortcut:capture', { keys: [], done: true })
    }, CAPTURE_TIMEOUT_MS)
  })
  ipcMain.handle('shortcut:cancel-capture', () => endCapture())

  ipcMain.on('recorder:started', (_event, payload: RecorderStartedPayload) => {
    if (payload && typeof payload.requestId === 'string') handleRecorderStarted(payload)
  })
  ipcMain.on('recorder:audio', (_event, payload: RecorderAudioPayload) => {
    if (payload && typeof payload.requestId === 'string') void handleRecorderAudio(payload)
  })
  ipcMain.on('recorder:error', (_event, payload: RecorderErrorPayload) => {
    if (payload && typeof payload.requestId === 'string' && typeof payload.message === 'string') {
      handleRecorderError(payload)
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
  shortcutController = new ShortcutController({
    chord: initial.shortcut,
    holdDelayMs: initial.holdDelayMs,
    onPress: onShortcutPressed,
    onRelease: onShortcutReleased,
    onError: (message) => failDictation(message),
    onCapture: (keys, done) => {
      if (done) captureTimeout = clearTimer(captureTimeout)
      mainWindow?.webContents.send('shortcut:capture', { keys, done })
    }
  })
  shortcutController.setEnabled(initial.hotkeyEnabled)

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

app.on('before-quit', () => {
  isQuitting = true
  clearDictationTimers()
  statusResetTimer = clearTimer(statusResetTimer)
  overlayHideTimer = clearTimer(overlayHideTimer)
  captureTimeout = clearTimer(captureTimeout)
  shortcutController?.stop()
  historyStore?.flush()
})

// Voice Hotkey lives in the tray; closing the window must not quit it.
app.on('window-all-closed', () => {})
