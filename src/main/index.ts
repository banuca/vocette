import { basename, dirname, join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  clipboard,
  dialog,
  globalShortcut,
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
  type DictationSource,
  type SoundKind,
  type TranscriptionPayload,
  type WorkflowSettings
} from './dictation-controller'
import { recordHistoryWithRetention } from './history-retention'
import { migrateLegacyProfile } from './legacy-profile'
import { HistoryStore } from './history-store'
import { createPlatformAdapter } from './platform'
import type { PlatformAdapter, ShortcutBackend, TargetTracker } from './platform/types'
import { SYNTHETIC_ECHO_MS } from './shortcut-controller'
import { SettingsStore } from './settings-store'
import { TranscriptionService } from './transcription-service'
import { parseVocabulary } from '../shared/vocabulary'
import {
  autoPasteSupported,
  effectiveRecordingMode,
  globalShortcutUsable,
  type CapabilityMap,
  type PlatformStatus,
  type SettingsPane
} from '../shared/capabilities'
import { formatDuration } from '../shared/format'
import { chordLabel } from '../shared/keycodes'
import {
  hasApiKey,
  type HistorySaveStatus,
  type Page,
  type RecorderAudioPayload,
  type RecorderErrorPayload,
  type RecorderStartedPayload,
  type SettingsUpdate,
  type WorkflowStatus
} from '../shared/types'

/** Long enough for the overlay's exit animation to finish. */
const OVERLAY_HIDE_MS = 220
/** Shortcut capture gives up on its own so the hook can never stay hijacked. */
const CAPTURE_TIMEOUT_MS = 10_000
/** Upper bound for waiting on the final history flush before quitting. */
const QUIT_FLUSH_TIMEOUT_MS = 3000
/** Mirrors the window's banner for a user working with the window hidden. */
const HISTORY_SAVE_FAILED_TRAY_LABEL =
  'History could not be saved — recent entries may be lost when you quit'
/** Both retention warnings point at the same retry, so they share its wording. */
const RETENTION_RETRY_ADVICE =
  'Check available disk space and folder permissions, then save your retention ' +
  'setting again in Settings to retry the cleanup.'

let mainWindow: BrowserWindow | null = null
let recorderWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let tray: Tray | null = null

let settingsStore: SettingsStore
let historyStore: HistoryStore
// Assigned during `bootstrap`, before any window or tray can reach them.
let platform!: PlatformAdapter
let shortcutController!: ShortcutBackend
let dictation!: DictationController
let foreground!: TargetTracker
let capabilities!: CapabilityMap

const transcriber = new TranscriptionService()

let isQuitting = false
let mainWindowReady = false
let pendingNavigation: Page | null = null

let overlayHideTimer: NodeJS.Timeout | null = null
let captureTimeout: NodeJS.Timeout | null = null
let overlayVisible = false
let quitFlushed = false
let lastBroadcastPhase: WorkflowStatus['phase'] | null = null

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

  // The tray's Start/Stop and Cancel items depend on the phase, and a take can
  // end on its own — transcription finishing, a watchdog firing — with nobody
  // to rebuild the menu afterwards. Without this the tray was left offering a
  // disabled Start until something else happened to rebuild it.
  if (status.phase !== lastBroadcastPhase) {
    lastBroadcastPhase = status.phase
    rebuildTrayMenu()
  }

  // The tray tooltip mirrors the workflow so the state is visible even with
  // the overlay off-screen.
  const tooltipByPhase: Record<WorkflowStatus['phase'], string> = {
    idle: 'Murmur',
    starting: 'Murmur — starting microphone…',
    recording: 'Murmur — listening…',
    processing: 'Murmur — transcribing…',
    success: 'Murmur — copied to clipboard',
    cancelled: 'Murmur — dictation cancelled',
    error: `Murmur — ${status.detail ?? 'dictation failed'}`
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
    // Resolved here, once: the controller is told the mode actually in force,
    // never the preference the platform cannot honour.
    recordingMode: effectiveRecordingMode(settings.recordingMode, capabilities),
    autoPaste: settings.autoPaste,
    pasteAvailable: autoPasteSupported(capabilities),
    removeFillers: settings.removeFillers,
    playSounds: settings.playSounds,
    model: settings.model,
    language: settings.language,
    vocabulary: parseVocabulary(settings.vocabulary),
    microphoneId: settings.microphoneId,
    apiKeyConfigured: hasApiKey(settingsStore.getPublic())
  }
}

function playSound(kind: SoundKind): void {
  if (!settingsStore.getInternal().playSounds) return
  const beeps = kind === 'start' ? 1 : 2
  for (let index = 0; index < beeps; index += 1) shell.beep()
}

function recordHistory(text: string, durationMs: number, model: string): void {
  recordHistoryWithRetention(
    {
      historyStore,
      retentionDays: () => settingsStore.getInternal().historyRetentionDays,
      onHistoryChanged: () => mainWindow?.webContents.send('history:changed'),
      onRetentionFailure: reportHistoryRetentionFailure
    },
    { text, durationMs, model }
  )
}

function reportHistoryRetentionFailure(): void {
  // The transcript was already stored in memory and announced to History. Do
  // not turn a retention problem into a transcription retry.
  void dialog
    .showMessageBox({
      type: 'warning',
      title: 'History retention needs attention',
      message: 'Your latest transcript was kept, but expired history could not be removed.',
      detail: RETENTION_RETRY_ADVICE
    })
    .catch(() => undefined)
}

/**
 * Retention at startup is best-effort. The failure can land after some of the
 * writes or companion cleanup have already gone through, so this claims only
 * what is known: the cleanup was not confirmed complete, expired data may
 * remain, and nothing held in memory is known to be saved. Startup itself
 * carries on, so the user can still dictate.
 */
function reportStartupRetentionFailure(error: unknown): void {
  void dialog
    .showMessageBox({
      type: 'warning',
      title: 'History retention needs attention',
      message: 'Murmur started, but expired transcript history could not be removed.',
      detail:
        `${storageFailureReason(error)}\n\n` +
        'The cleanup was not confirmed complete, and part of it may already have been ' +
        'applied. Expired transcripts may still be on disk and can reappear the next ' +
        'time Murmur starts. Murmur may not be able to save new transcripts ' +
        'either, so treat anything dictated in this session as unsaved. Dictation, the ' +
        'clipboard and auto-paste are unaffected.' +
        `\n\n${RETENTION_RETRY_ADVICE}`
    })
    .catch(() => undefined)
}

/**
 * A failed history save is persistent and non-blocking: no dialog, no window
 * stealing focus, no change to the dictation the user just completed. The
 * clipboard and auto-paste have already delivered the text.
 */
function reportHistorySaveStatus(status: HistorySaveStatus): void {
  mainWindow?.webContents.send('history:save-status', status)
  rebuildTrayMenu()
}

function storageFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected storage error occurred.'
}

/**
 * Retention still runs before any window can list history, but it must not
 * gate the launch: a locked or full disk would otherwise reach the fatal
 * startup handler and leave the user with no way to dictate at all. The store
 * keeps a failed cleanup retryable, so the action this reports really retries.
 */
async function pruneHistoryAtStartup(): Promise<unknown> {
  try {
    await historyStore.prune(settingsStore.getInternal().historyRetentionDays)
    return null
  } catch (error) {
    return error ?? new Error('An unexpected storage error occurred.')
  }
}

function transcribe(payload: TranscriptionPayload, signal: AbortSignal): Promise<string> {
  return transcriber.transcribe({
    audio: payload.audio,
    mimeType: payload.mimeType,
    apiKey: settingsStore.getApiKey(),
    model: payload.model,
    language: payload.language,
    terms: payload.vocabulary,
    endpoint: settingsStore.getInternal().apiEndpoint,
    signal
  })
}

function createDictationController(): DictationController {
  return new DictationController({
    sendToRecorder: (channel, payload) => recorderWindow?.webContents.send(channel, payload),
    getSettings: workflowSettings,
    transcribe,
    writeClipboard: (text) => clipboard.writeText(text),
    paste: () => {
      // The hook sees the app's own keystrokes, so input is ignored for a
      // moment first; otherwise a user chord sharing a modifier with the
      // paste chord would re-trigger from our own injection.
      shortcutController.suppressSyntheticInput(SYNTHETIC_ECHO_MS)
      platform.paste()
    },
    playSound,
    broadcastStatus,
    showMain,
    recordHistory,
    captureForeground: () => foreground.capture(),
    clearForeground: () => foreground.clear(),
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
    title: 'Murmur',
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
  // Coming back to the window is the moment a permission is most likely to
  // have just been granted in a settings pane the app itself opened.
  mainWindow.on('focus', () => refreshCapabilities())
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
  // The overlay is a separate document with its own stylesheet, so it has to
  // be told the palette; it has no settings of its own to read.
  broadcastTheme()
}

/** Sends only the palette, and only to the window that cannot look it up. */
function broadcastTheme(): void {
  overlayWindow?.webContents.send('app:theme', settingsStore.getInternal().theme)
}

function applyLaunchAtLogin(enabled: boolean): void {
  platform.setLaunchAtLogin(enabled)
}

function platformStatus(): PlatformStatus {
  return {
    platform: platform.id,
    session: platform.session,
    pasteLabel: platform.pasteLabel,
    primaryModifierLabel: platform.primaryModifierLabel,
    capabilities
  }
}

/**
 * Re-reads what the operating system will allow and tells the window if it
 * changed. macOS permissions can be granted or revoked while Murmur is
 * running, so a snapshot taken at startup is not something to trust for the
 * rest of the session.
 */
function refreshCapabilities(): void {
  const next = platform.capabilities({
    shortcuts: shortcutController ?? null,
    target: foreground ?? null,
    secureStorage: settingsStore.keyStorage()
  })
  const changed = JSON.stringify(next) !== JSON.stringify(capabilities)
  capabilities = next
  if (!changed) return
  // Losing or regaining hold support flips the mode actually in force.
  applyRecordingMode()
  mainWindow?.webContents.send('platform:status', platformStatus())
  rebuildTrayMenu()
}

/**
 * Tells the shortcut backend which gesture is driving recording now. In toggle
 * mode the press that stops a dictation is a tap, so a chord released before
 * the hold delay has to count; holding to talk needs the opposite.
 */
function applyRecordingMode(): void {
  const settings = settingsStore.getInternal()
  shortcutController.setTapToFire(
    effectiveRecordingMode(settings.recordingMode, capabilities) === 'toggle'
  )
}

/** The tray's one-line summary of how to start a dictation right now. */
function shortcutHintLabel(): string {
  const settings = settingsStore.getInternal()
  if (!globalShortcutUsable(capabilities)) {
    return 'Open Murmur and press Record'
  }
  return effectiveRecordingMode(settings.recordingMode, capabilities) === 'toggle'
    ? `Press ${shortcutLabel()} to start and stop`
    : `Hold ${shortcutLabel()} to talk`
}

function rebuildTrayMenu(): void {
  if (!tray || !dictation) return
  const settings = settingsStore.getPublic()
  const recording = dictation.isRecording()
  const busy = dictation.isBusy()
  const template: MenuItemConstructorOptions[] = [
    { label: shortcutHintLabel(), enabled: false },
    // Visible wherever the user is: the window may be hidden when a save fails.
    ...(historyStore.getSaveStatus().saveFailed
      ? [{ label: HISTORY_SAVE_FAILED_TRAY_LABEL, enabled: false } as MenuItemConstructorOptions]
      : []),
    { type: 'separator' },
    // Recording from the tray delivers to the clipboard: whatever has focus
    // when a menu is open is not a target the user chose to dictate into.
    {
      label: recording ? 'Stop recording' : 'Start recording',
      enabled: recording || !busy,
      click: () => (recording ? dictation.stopDictation() : dictation.startDictation('ui'))
    },
    { label: 'Cancel dictation', enabled: busy, click: () => dictation.cancelDictation() },
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
      label: 'Global shortcut enabled',
      type: 'checkbox',
      enabled: globalShortcutUsable(capabilities),
      checked: shortcutController.isEnabled() && globalShortcutUsable(capabilities),
      click: (item) => {
        shortcutController.setEnabled(item.checked)
        settingsStore.update({ hotkeyEnabled: item.checked })
        mainWindow?.webContents.send('settings:changed', settingsStore.getPublic())
        rebuildTrayMenu()
      }
    },
    {
      label: launchAtLoginLabel(),
      type: 'checkbox',
      enabled: capabilities.launchAtLogin.state === 'available',
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
      label: 'Quit Murmur',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))
}

/** Each desktop calls this something different; use its own words. */
function launchAtLoginLabel(): string {
  if (platform.id === 'windows') return 'Start with Windows'
  if (platform.id === 'macos') return 'Open at login'
  return 'Start when I sign in'
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(resourcePath('tray.png')))
  tray.setToolTip('Murmur')
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

  ipcMain.handle('settings:save', async (event, update: SettingsUpdate) => {
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
    if (before.recordingMode !== after.recordingMode) applyRecordingMode()
    if (before.theme !== after.theme) broadcastTheme()
    if (before.launchAtLogin !== after.launchAtLogin) applyLaunchAtLogin(after.launchAtLogin)

    if (await historyStore.prune(after.historyRetentionDays)) {
      mainWindow?.webContents.send('history:changed')
    }
    // A saved key, or a changed shortcut, can change what the system allows.
    refreshCapabilities()
    rebuildTrayMenu()
    return result
  })

  ipcMain.handle('settings:clear-api-key', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    const result = settingsStore.clearApiKey()
    refreshCapabilities()
    return result
  })

  ipcMain.handle('settings:clear-session-key', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    return settingsStore.clearSessionApiKey()
  })

  ipcMain.handle('platform:status', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    // Read fresh: a permission may have been granted since the page loaded.
    refreshCapabilities()
    return platformStatus()
  })

  ipcMain.handle('platform:open-settings', async (event, pane: unknown) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    const panes: SettingsPane[] = ['accessibility', 'input-monitoring', 'microphone']
    if (typeof pane !== 'string' || !panes.includes(pane as SettingsPane)) {
      throw new Error('Unknown settings page.')
    }
    await platform.openSettingsPane(pane as SettingsPane)
  })

  // One controller owns the microphone. The window buttons, the tray and the
  // global shortcut all arrive here; none of them opens a device of its own.
  const startFrom = (source: DictationSource): void => {
    dictation.startDictation(source)
    rebuildTrayMenu()
  }

  ipcMain.handle('dictation:start', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    startFrom('ui')
  })
  ipcMain.handle('dictation:stop', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    dictation.stopDictation()
    rebuildTrayMenu()
  })
  ipcMain.handle('dictation:cancel', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    dictation.cancelDictation()
    rebuildTrayMenu()
  })
  ipcMain.handle('dictation:retry', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    return dictation.retryLast()
  })

  ipcMain.handle('history:list', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    return historyStore.list()
  })
  ipcMain.handle('history:save-status', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    return historyStore.getSaveStatus()
  })
  ipcMain.handle('history:delete', async (event, id: unknown) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid history entry.')
    return await historyStore.delete(id)
  })
  ipcMain.handle('history:clear', async (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    await historyStore.clear()
    mainWindow?.webContents.send('history:changed')
  })
  ipcMain.handle('history:export', async (event, format: unknown) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    if (format !== 'json' && format !== 'txt') throw new Error('Invalid export format.')
    if (!mainWindow) return { saved: false, path: null }
    const entries = historyStore.list()
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export transcript history',
      defaultPath: `murmur-history-${new Date().toISOString().slice(0, 10)}.${format}`,
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

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    platformStatus: platformStatus()
  }))
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
  // Before either store opens: the profile folder is named after the app, so
  // the rename from Murmur would otherwise leave the user's settings and
  // transcripts in a directory nothing reads. Failures are reported, never
  // thrown — a profile that could not be copied must still open a window.
  const migration = migrateLegacyProfile({
    userData,
    parent: dirname(userData),
    currentName: basename(userData),
    fs: {
      exists: (path) => existsSync(path),
      modifiedAt: (path) => {
        try {
          return statSync(path).mtimeMs
        } catch {
          return null
        }
      },
      copyFile: (from, to) => copyFileSync(from, to),
      ensureDirectory: (path) => mkdirSync(path, { recursive: true })
    }
  })
  settingsStore = new SettingsStore(join(userData, 'settings.json'))
  historyStore = new HistoryStore(join(userData, 'history.json'))
  // Subscribed before the first write of the session, so a failure during the
  // startup retention pass is already reflected when the tray and window
  // appear. The renderer re-reads the status on load, so an update sent before
  // its window exists cannot be missed.
  historyStore.onSaveStatusChanged(reportHistorySaveStatus)
  const retentionError = await pruneHistoryAtStartup()

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => permission === 'media'
  )
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) =>
    callback(permission === 'media')
  )

  const initial = settingsStore.getInternal()

  // Native integrations load here, and only here. Anything that cannot load
  // becomes a reported capability rather than a failed startup.
  platform = await createPlatformAdapter({
    setLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
    openExternal: (url) => shell.openExternal(url),
    globalShortcut
  })
  foreground = platform.createTargetTracker()
  shortcutController = platform.createShortcutBackend({
    chord: initial.shortcut,
    holdDelayMs: initial.holdDelayMs,
    onPress: () => {
      dictation.onShortcutPressed()
      rebuildTrayMenu()
    },
    onRelease: () => {
      dictation.onShortcutReleased()
      rebuildTrayMenu()
    },
    onError: (message) => dictation.reportError(message),
    onCapture: (keys, done) => {
      if (done) captureTimeout = clearTimer(captureTimeout)
      mainWindow?.webContents.send('shortcut:capture', { keys, done })
    }
  })
  capabilities = platform.capabilities({
    shortcuts: shortcutController,
    target: foreground,
    secureStorage: settingsStore.keyStorage()
  })
  shortcutController.setEnabled(initial.hotkeyEnabled)
  applyRecordingMode()
  dictation = createDictationController()

  registerIpc()
  await createWindows()
  createTray()
  applyLaunchAtLogin(initial.launchAtLogin)
  shortcutController.start()
  // Starting may have discovered the shortcut cannot be registered at all.
  refreshCapabilities()

  const startsInBackground = process.argv.includes('--background')
  if (!startsInBackground) {
    showMain(hasApiKey(settingsStore.getPublic()) ? 'history' : 'settings')
  }

  // A recovered or damaged data file is worth telling the user about — the old
  // build reset silently.
  const warnings = [settingsStore.takeWarning(), historyStore.takeWarning()].filter(Boolean)
  if (warnings.length) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Murmur recovered your data',
      message: 'Some saved data could not be read.',
      detail: warnings.join('\n\n')
    })
  }

  if (migration.error) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Murmur',
      message: 'Your previous Murmur settings could not be copied across.',
      detail:
        `${migration.error}

Nothing was deleted: the old profile is still in ` +
        `${migration.from ?? 'its original folder'}. Add your API key in Settings to carry on.`
    })
  } else if (migration.migrated.length > 0 && process.platform !== 'win32') {
    // Only here: on Windows the saved key is encrypted against the user
    // account and survives the move. Elsewhere it lives in a keychain entry
    // named after the application and cannot follow a rename.
    dialog.showMessageBox({
      type: 'info',
      title: 'Murmur',
      message: 'Murmur is now Murmur.',
      detail:
        'Your settings and transcript history have been carried across. Your saved ' +
        'API key could not be: it is held by this system under the old application ' +
        'name. Add it again in Settings.'
    })
  }

  if (retentionError) reportStartupRetentionFailure(retentionError)
}

// Set before anything asks for a path: `userData` is derived from the app
// name, and leaving it to default would put a development run and a packaged
// run in two different profile folders.
app.setName('Murmur')

// A separate profile folder for automated runs and side-by-side testing, so a
// test can never read or overwrite the user's own settings and transcripts.
// Set before the single-instance lock, which is scoped to this folder.
const profileOverride = process.env.MURMUR_PROFILE_DIR
if (profileOverride) app.setPath('userData', profileOverride)

// The desktop portal that grants a Wayland global shortcut identifies the
// application by its desktop file, so the name has to match what is installed.
if (process.platform === 'linux') app.setDesktopName('murmur.desktop')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMain('history'))
  app.whenReady().then(bootstrap).catch((error: unknown) => {
    dialog.showErrorBox(
      'Murmur could not start',
      error instanceof Error ? error.message : 'An unexpected startup error occurred.'
    )
    app.quit()
  })
}

app.on('before-quit', (event) => {
  isQuitting = true
  dictation?.shutdown()
  shortcutController?.stop()
  globalShortcut.unregisterAll()
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

// Murmur lives in the tray; closing the window must not quit it.
app.on('window-all-closed', () => {})
