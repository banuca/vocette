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
  nativeTheme,
  net,
  powerMonitor,
  screen,
  session,
  shell,
  utilityProcess,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions
} from 'electron'
import {
  DictationController,
  type DictationSource,
  type HistoryExtras,
  type SoundKind,
  type TranscriptionPayload,
  type WorkflowSettings
} from './dictation-controller'
import { loadCommonWords } from './common-words'
import { LocalEngine, type WorkerHandle } from './engine/local-engine'
import { ModelStore, ModelStoreError, modelsRoot, type DownloadProgress } from './engine/model-store'
import { LOCAL_MODEL } from './engine/models'
import { restoreSnapshot, takeSnapshot, type ClipboardSnapshot } from './clipboard-custody'
import { recordHistoryWithRetention } from './history-retention'
import { migrateLegacyProfile } from './legacy-profile'
import { HistoryStore, isRestorableEntry } from './history-store'
import { createPlatformAdapter } from './platform'
import type { PlatformAdapter, ShortcutBackend, TargetTracker } from './platform/types'
import { createModifierProbe } from './platform/key-state'
import { SYNTHETIC_ECHO_MS } from './shortcut-controller'
import { rearmPlan } from './rearm-plan'
import { listeningBars, trayFrame, writingAlphas, type TrayFrame, type TrayState } from './tray-icon'
import { UpdateChecker } from './update-check'
import { polishText, requestPolish } from './polish-service'
import { OPENAI_POLISH_ENDPOINT, type PolishOutcome } from '../shared/polish'
import {
  LICENCE_MESSAGES,
  LicenceClient,
  checkoutConfig,
  deviceLabel,
  licenceConfig,
  licenceStatusFor,
  purchasesConfigured
} from './licence'
import { SettingsStore } from './settings-store'
import { runConnectionTest } from './connection-test'
import { TranscriptionService } from './transcription-service'
import { decodeWav } from './wav'
import {
  REMOVE_WHILE_DICTATING,
  engineReady,
  type EngineStatus,
  type ModelStatus
} from '../shared/engine'
import {
  entitlementFor,
  planReplacements,
  planVocabulary,
  subscriptionStanding,
  type Entitlement
} from '../shared/entitlement'
import { CUSTOMER_PORTAL_URL, UPDATE_REPOSITORY } from '../shared/product'
import { SubscriptionChecker } from './subscription-check'
import { displayVersion } from '../shared/update'
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
  type HistorySaveStatus,
  type LicenceActivation,
  type LicenceRelease,
  type LicenceStatus,
  type Page,
  type PasteLastStatus,
  type RecorderAudioPayload,
  type RecorderErrorPayload,
  type RecorderLevelPayload,
  type RecorderStartedPayload,
  type SettingsUpdate,
  type TranscriptionTestResult,
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
/** "Paste last dictation", in Electron's accelerator syntax. */
const PASTE_LAST_ACCELERATOR = 'Alt+Shift+V'
/** What Test sends for polish: short, with a filler to remove. */
const POLISH_TEST_TEXT = 'this is a test um of the polish'

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
let modelStore!: ModelStore
let localEngine!: LocalEngine
let licenceClient!: LicenceClient
let subscriptionChecker!: SubscriptionChecker
let updateChecker!: UpdateChecker
/** An activation or a release is on its way to Polar; a second click waits for it. */
let licenceRequestInFlight = false

const transcriber = new TranscriptionService()

interface ModelDownload {
  controller: AbortController
  progress: DownloadProgress
  /** Settles, never rejects, once the download has stopped for any reason. */
  done: Promise<void>
}

/** The model download this session is running, if any. */
let modelDownload: ModelDownload | null = null
/** Why the last download failed, until another starts or the model is removed. */
let modelDownloadError: string | null = null
/** The last engine status sent to the window, so an unchanged one is not sent again. */
let lastEngineStatus = ''
/** Readiness as the tray menu last showed it, so download progress never rebuilds it. */
let trayReadiness = ''

let isQuitting = false
let mainWindowReady = false
let pendingNavigation: Page | null = null

let overlayHideTimer: NodeJS.Timeout | null = null
let captureTimeout: NodeJS.Timeout | null = null
let overlayVisible = false
let quitFlushed = false
let lastBroadcastPhase: WorkflowStatus['phase'] | null = null
/** Whether Alt + Shift + V is actually registered, not merely switched on. */
let pasteLastRegistered = false
/** When the keyboard hook was last put back after a sleep or a lock. */
let lastRearmAt: number | null = null

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
    idle: 'Vocette',
    starting: 'Vocette — starting microphone…',
    recording: 'Vocette — listening…',
    processing: 'Vocette — transcribing…',
    // The outcome in its own words: after a paste the clipboard is given
    // back, so "copied to clipboard" is no longer true of every success.
    success: `Vocette — ${status.message}`,
    cancelled: 'Vocette — dictation cancelled',
    error: `Vocette — ${status.detail ?? 'dictation failed'}`
  }
  tray?.setToolTip(tooltipByPhase[status.phase])
  setTrayState(status.phase)

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

/**
 * The key polish is sent with: its own, if one is saved; otherwise the
 * transcription key, but only when both go to OpenAI — a key is never sent to
 * a provider it was not given for. A key that cannot be read sends none, and
 * the provider's refusal says so.
 */
function polishKey(): string {
  try {
    const own = settingsStore.getPolishKey()
    if (own) return own
    const settings = settingsStore.getInternal()
    const toOpenAI = settings.polishEndpoint.trim().replace(/\/+$/u, '') === OPENAI_POLISH_ENDPOINT
    return toOpenAI && settings.apiEndpoint === '' ? settingsStore.getApiKey() : ''
  } catch {
    return ''
  }
}

/** One polish attempt with the saved settings, for a dictation or for Test. */
function polishRequest(text: string, signal?: AbortSignal): Parameters<typeof requestPolish>[0] {
  const settings = settingsStore.getInternal()
  return {
    text,
    style: settings.polishStyle,
    instructions: settings.polishInstructions,
    terms: planVocabulary(settings.vocabulary, entitlement().pro),
    endpoint: settings.polishEndpoint,
    model: settings.polishModel,
    apiKey: polishKey(),
    budgetMs: settings.polishBudgetMs,
    signal
  }
}

function polishDictation(text: string, signal: AbortSignal): Promise<PolishOutcome> {
  return polishText(polishRequest(text, signal))
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
  const status = engineStatus()
  // Worked out afresh for every take, so the trial ends when it ends — no
  // restart — and the lists shrink to Free's limits without being cut.
  const { pro } = entitlement()
  return {
    // Resolved here, once: the controller is told the mode actually in force,
    // never the preference the platform cannot honour.
    recordingMode: effectiveRecordingMode(settings.recordingMode, capabilities),
    instantCapture: settings.instantCapture,
    autoPaste: settings.autoPaste,
    pasteAvailable: autoPasteSupported(capabilities),
    restoreClipboard: settings.restoreClipboard,
    removeFillers: settings.removeFillers,
    spokenCorrections: settings.spokenCorrections,
    spokenFormatting: settings.spokenFormatting,
    playSounds: settings.playSounds,
    engine: settings.engine,
    // History names what did the work: the on-device model, or the provider
    // model the user chose.
    model: settings.engine === 'local' ? LOCAL_MODEL.id : settings.model,
    language: settings.language,
    pro,
    // Pro only: a Free user's saved switch sends nothing anywhere.
    polish: pro && settings.polishEnabled,
    // The first 50 terms and 20 rules on Free, all of them with Pro. The
    // terms feed both the cloud request and the correction after it.
    vocabulary: planVocabulary(settings.vocabulary, pro),
    replacements: planReplacements(settings.replacements, pro),
    microphoneId: settings.microphoneId,
    transcriptionReady: status.ready,
    notReadyReason: status.notReadyReason
  }
}

/** The plan in force right now: read fresh, because the trial ends on its own. */
function entitlement(): Entitlement {
  const now = Date.now()
  return entitlementFor({
    trialStartedAt: settingsStore.getInternal().trialStartedAt,
    subscribed: subscriptionStanding(settingsStore.licenceRecord(), now) === 'active',
    now
  })
}

/** "Vocette on Windows · 7F3A": how activation names this PC to Polar. */
function thisDeviceLabel(): string {
  return deviceLabel(platform.id, settingsStore.getInternal().deviceTag)
}

function licenceStatus(): LicenceStatus {
  const checkout = checkoutConfig(process.env)
  return licenceStatusFor({
    entitlement: entitlement(),
    licence: settingsStore.licenceRecord(),
    config: licenceConfig(process.env),
    trialEndNoticeDismissed: settingsStore.getInternal().trialEndNoticeDismissed,
    deviceLabel: thisDeviceLabel(),
    now: Date.now(),
    checking: subscriptionChecker?.isChecking() ?? false,
    checkMessage: subscriptionChecker?.lastMessage() ?? null,
    monthlyCheckoutUrl: checkout.monthly,
    yearlyCheckoutUrl: checkout.yearly,
    launchOfferEndsAt: checkout.launchOfferEndsAt
  })
}

function broadcastLicenceStatus(): void {
  mainWindow?.webContents.send('licence:changed', licenceStatus())
}

/**
 * Activates a key on this PC. One request to Polar, only when the user asks;
 * after that the subscription is checked at most once a day (see
 * `SubscriptionChecker`). Answers with a sentence rather than throwing, so the
 * Pro page can show it as it is.
 */
async function activateLicence(rawKey: string): Promise<LicenceActivation> {
  const refuse = (error: string): LicenceActivation => ({ ok: false, error, status: licenceStatus() })
  if (settingsStore.licenceRecord()) return refuse('Pro is already active on this PC.')
  // Every activation takes a device slot, so a second click must not send a
  // second request.
  if (licenceRequestInFlight) return refuse('Vocette is already talking to Polar. Wait a moment.')
  const config = licenceConfig(process.env)
  if (!purchasesConfigured(config)) return refuse(LICENCE_MESSAGES.notConfigured)

  licenceRequestInFlight = true
  try {
    const key = rawKey.trim()
    const result = await licenceClient.activate(key, {
      ...config,
      label: thisDeviceLabel(),
      appVersion: app.getVersion()
    })
    if (!result.ok) return refuse(result.error)
    try {
      settingsStore.saveLicence({
        key,
        activationId: result.activationId,
        benefitId: result.benefitId,
        displayKey: result.displayKey,
        activatedAt: new Date().toISOString()
      })
    } catch (error) {
      return refuse(
        `Pro was activated, but this PC could not save it: ${storageFailureReason(error)}`
      )
    }
    // Whatever the last check said was about a licence this PC no longer has.
    subscriptionChecker.clearMessage()
    broadcastLicenceStatus()
    return { ok: true, status: licenceStatus() }
  } finally {
    licenceRequestInFlight = false
  }
}

/**
 * Releases this PC's activation, freeing a device slot, then forgets the
 * licence here. When Polar cannot be asked, the answer says whether the Pro
 * page may offer to forget it here anyway.
 */
async function releaseLicence(): Promise<LicenceRelease> {
  const refuse = (error: string, canRemoveLocally: boolean): LicenceRelease => ({
    ok: false,
    error,
    canRemoveLocally,
    status: licenceStatus()
  })
  const record = settingsStore.licenceRecord()
  if (!record) return { ok: true, status: licenceStatus() }
  if (licenceRequestInFlight) return refuse('Vocette is already talking to Polar. Wait a moment.', false)

  let key: string
  try {
    key = settingsStore.getLicenceKey()
  } catch (error) {
    return refuse(storageFailureReason(error), true)
  }

  licenceRequestInFlight = true
  try {
    const result = await licenceClient.deactivate(key, record.activationId, licenceConfig(process.env))
    if (!result.released) return refuse(result.error, result.canRemoveLocally)
    try {
      settingsStore.clearLicence()
    } catch (error) {
      return refuse(
        `This PC was released, but the change could not be saved: ${storageFailureReason(error)}`,
        false
      )
    }
    broadcastLicenceStatus()
    return { ok: true, status: licenceStatus() }
  } finally {
    licenceRequestInFlight = false
  }
}

/**
 * The on-device model as this session knows it: a download in progress or
 * just failed, and otherwise whatever is on disk. Reading the disk costs a few
 * file sizes and one small marker file — never a hash.
 */
function modelStatus(): ModelStatus {
  const { id, totalBytes } = LOCAL_MODEL
  if (modelDownload) {
    const { phase, receivedBytes } = modelDownload.progress
    return { id, state: phase, receivedBytes, totalBytes, error: null }
  }
  if (modelDownloadError) {
    return { id, state: 'failed', receivedBytes: 0, totalBytes, error: modelDownloadError }
  }
  const state = modelStore.state(id)
  return { id, state, receivedBytes: state === 'installed' ? totalBytes : 0, totalBytes, error: null }
}

function engineStatus(): EngineStatus {
  const settings = settingsStore.getPublic()
  const model = modelStatus()
  return { engine: settings.engine, model, ...engineReady(settings, model.state) }
}

/**
 * Tells the window whenever readiness or the download changes. Callers need
 * not know whether anything did: an unchanged status is not sent again.
 * Download progress arrives already throttled by the model store.
 */
function broadcastEngineStatus(): void {
  const status = engineStatus()
  const serialised = JSON.stringify(status)
  if (serialised === lastEngineStatus) return
  lastEngineStatus = serialised
  mainWindow?.webContents.send('engine:status', status)
  // The tray offers Start recording only when a take could be transcribed,
  // so it follows readiness — a download finishing, the model removed — but
  // not every tick of the download in between.
  if (readinessKey(status) !== trayReadiness) rebuildTrayMenu()
}

function readinessKey(status: Pick<EngineStatus, 'ready' | 'notReadyReason'>): string {
  return `${status.ready}:${status.notReadyReason ?? ''}`
}

/**
 * Starts the model download unless one is running or the model is already
 * installed. Progress and the outcome are broadcast.
 */
function startModelDownload(): void {
  if (modelDownload) return
  modelDownloadError = null
  if (modelStore.state(LOCAL_MODEL.id) === 'installed') {
    broadcastEngineStatus()
    return
  }
  const controller = new AbortController()
  const download: ModelDownload = {
    controller,
    progress: { phase: 'downloading', receivedBytes: 0, totalBytes: LOCAL_MODEL.totalBytes },
    done: Promise.resolve()
  }
  modelDownload = download
  download.done = modelStore
    .download(
      LOCAL_MODEL.id,
      (progress) => {
        download.progress = progress
        broadcastEngineStatus()
      },
      controller.signal
    )
    .catch((error: unknown) => {
      // A cancelled download is not a failure: its parts stay for a resume,
      // and the state read from disk says so.
      if (controller.signal.aborted) return
      modelDownloadError =
        error instanceof ModelStoreError ? error.message : 'The download failed. Try again.'
    })
    .finally(() => {
      if (modelDownload === download) modelDownload = null
      broadcastEngineStatus()
    })
  broadcastEngineStatus()
}

/** Stops a running download and waits until its files are closed. */
async function stopModelDownload(): Promise<void> {
  const download = modelDownload
  if (!download) return
  download.controller.abort()
  await download.done
}

/** The speech-engine utility process. Lives beside index.js in the build. */
function spawnEngineWorker(): WorkerHandle {
  const child = utilityProcess.fork(join(__dirname, 'engine-worker.js'), [], {
    serviceName: 'Vocette speech engine'
  })
  return {
    postMessage: (message) => child.postMessage(message),
    kill: () => void child.kill(),
    onMessage: (listener) => void child.on('message', listener),
    onExit: (listener) => void child.on('exit', listener)
  }
}

function playSound(kind: SoundKind): void {
  if (!settingsStore.getInternal().playSounds) return
  const beeps = kind === 'start' ? 1 : 2
  for (let index = 0; index < beeps; index += 1) shell.beep()
}

function recordHistory(
  text: string,
  durationMs: number,
  model: string,
  extras: HistoryExtras
): void {
  recordHistoryWithRetention(
    {
      historyStore,
      retentionDays: () => settingsStore.getInternal().historyRetentionDays,
      onHistoryChanged: () => mainWindow?.webContents.send('history:changed'),
      onRetentionFailure: reportHistoryRetentionFailure
    },
    { text, durationMs, model, ...extras }
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
      message: 'Vocette started, but expired transcript history could not be removed.',
      detail:
        `${storageFailureReason(error)}\n\n` +
        'The cleanup was not confirmed complete, and part of it may already have been ' +
        'applied. Expired transcripts may still be on disk and can reappear the next ' +
        'time Vocette starts. Vocette may not be able to save new transcripts ' +
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

async function transcribe(payload: TranscriptionPayload, signal: AbortSignal): Promise<string> {
  if (payload.engine === 'local') {
    // Read here, not by the addon: its WAV readers do not work inside
    // Electron. A recording that is not the recorder's own WAV — its audio
    // preparation fell back to the original container — cannot be used.
    const wav = decodeWav(payload.audio)
    if (!wav) {
      throw new Error('This recording could not be read for on-device transcription. Try again.')
    }
    // The decoded samples are a fresh copy, handed to the engine outright;
    // the controller keeps the recording itself for Retry.
    return localEngine.transcribe(wav.samples, wav.sampleRate, signal)
  }
  return transcriber.transcribe({
    audio: payload.audio,
    mimeType: payload.mimeType,
    apiKey: settingsStore.getApiKey(),
    model: payload.model,
    language: payload.language,
    terms: payload.vocabulary,
    endpoint: settingsStore.getInternal().apiEndpoint,
    signal,
    // The cloud path only: its one quiet retry is announced through this. The
    // on-device engine restarts its own worker instead, and has no busy server.
    onRetry: payload.onRetry
  })
}

function createDictationController(): DictationController {
  return new DictationController({
    sendToRecorder: (channel, payload) => recorderWindow?.webContents.send(channel, payload),
    getSettings: workflowSettings,
    transcribe,
    writeClipboard: (text) => clipboard.writeText(text),
    // The copy never leaves this process: it is held until the paste has
    // landed, written back, and dropped.
    snapshotClipboard: () => takeSnapshot(clipboard),
    restoreClipboard: (token, ours) => {
      restoreSnapshot(clipboard, token as ClipboardSnapshot, ours)
    },
    // Windows only: the physical key state, so a paste is never sent into
    // modifiers the user is still holding.
    modifiersHeld: process.platform === 'win32' ? createModifierProbe() : undefined,
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
    escapeWatched: () =>
      shortcutController.supportsEscape &&
      shortcutController.isEnabled() &&
      shortcutController.registrationError() === null,
    onRetryChanged: () => rebuildTrayMenu(),
    // The model loads while the user is still speaking. Only the on-device
    // engine has anything to load, and only once its model is on disk: a
    // prewarm without one would just fail.
    prewarm: () => {
      if (settingsStore.getInternal().engine !== 'local') return
      if (modelStatus().state !== 'installed') return
      localEngine.prewarm()
    },
    polish: polishDictation,
    commonWords: loadCommonWords
  })
}

function hardenWebContents(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
}

/**
 * Tells the operating system which palette Vocette is in, so the parts it draws itself — the
 * window's title bar on Windows — match the page. `system` hands the choice back to the
 * operating system, which is what following Windows means.
 */
function applyNativeTheme(): void {
  nativeTheme.themeSource = settingsStore.getInternal().theme
}

/** The Graphite ground of the palette the window opens in, so no flash of the other. */
function windowBackdrop(): string {
  applyNativeTheme()
  const theme = settingsStore.getInternal().theme
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? '#0e0e11' : '#f4f4f6'
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
    title: 'Vocette',
    // The colour shown before the page paints: the palette the window will open in.
    backgroundColor: windowBackdrop(),
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
  applyNativeTheme()
  overlayWindow?.webContents.send('app:theme', settingsStore.getInternal().theme)
}

function applyLaunchAtLogin(enabled: boolean): void {
  // An isolated profile — a test run, or a second copy run side by side —
  // keeps its own preference but never adds or removes the startup entry of
  // the Vocette this computer actually starts.
  if (profileOverride) return
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
 * changed. macOS permissions can be granted or revoked while Vocette is
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

/**
 * The PC is going to sleep or being locked. A take still recording is finished,
 * not thrown away — a lock that comes on its own can arrive in the middle of a
 * long dictation — and the microphone does not stay open behind the lock
 * screen. What was said is transcribed as usual, and pasted only if the window
 * it was meant for is still in front when it is ready; otherwise it is left on
 * the clipboard and in History.
 */
function finishTakeBeforeAway(): void {
  if (dictation.isRecording()) dictation.stopDictation()
}

/**
 * The user is back from a sleep or the lock screen: the keyboard hook is put
 * back with nothing held (see `rearmPlan`). A take somehow still recording is
 * cancelled first.
 */
function rearmShortcut(): void {
  const now = Date.now()
  const plan = rearmPlan({ recording: dictation.isRecording(), lastRearmAt, now })
  if (plan === 'skip') return
  lastRearmAt = now
  if (plan === 'cancel-then-rearm') dictation.cancelDictation()
  shortcutController.stop()
  shortcutController.start()
  // Starting again can fail, or succeed where it failed before.
  refreshCapabilities()
}

/**
 * The newest transcript, pasted again into whatever has focus. Nothing when
 * there is no history yet, or while a take is running.
 */
function pasteLastDictation(): void {
  // The controller refuses too; checked here first so a press mid-take never
  // copies the whole history list for nothing.
  if (dictation.isBusy()) return
  const newest = historyStore.list()[0]
  if (!newest) return
  void dictation.pasteLast(newest.text)
}

/**
 * Registers Alt + Shift + V to match the setting, and records whether that
 * worked: another app may already own the combination, and a switch that
 * shows as on while doing nothing has to be able to say so.
 *
 * Registered with the system rather than watched by the keyboard hook. The
 * hook only observes keys, so the focused app would receive Alt + Shift + V
 * too — typed into the very window the paste is meant for.
 *
 * Windows only for now. Elsewhere it stays unregistered, and Settings does not
 * offer it.
 */
function applyPasteLastShortcut(enabled: boolean): void {
  if (pasteLastRegistered) {
    try {
      globalShortcut.unregister(PASTE_LAST_ACCELERATOR)
    } catch {
      // Already released.
    }
    pasteLastRegistered = false
  }
  if (!enabled || platform.id !== 'windows') return
  try {
    pasteLastRegistered =
      globalShortcut.register(PASTE_LAST_ACCELERATOR, pasteLastDictation) &&
      globalShortcut.isRegistered(PASTE_LAST_ACCELERATOR)
  } catch {
    pasteLastRegistered = false
  }
}

/** The tray's one-line summary of how to start a dictation right now. */
function shortcutHintLabel(): string {
  const settings = settingsStore.getInternal()
  if (!globalShortcutUsable(capabilities)) {
    return 'Open Vocette and press Record'
  }
  return effectiveRecordingMode(settings.recordingMode, capabilities) === 'toggle'
    ? `Press ${shortcutLabel()} to start and stop`
    : `Hold ${shortcutLabel()} to talk`
}

/** The tray's line for an update on offer; nothing otherwise. */
function updateTrayItems(): MenuItemConstructorOptions[] {
  const status = updateChecker?.getStatus()
  const page = updateChecker?.downloadPage()
  if (!status || status.state !== 'available' || !status.latest || !page) return []
  return [
    {
      label: `Update available: ${displayVersion(status.latest)} — open download page`,
      click: () => void shell.openExternal(page)
    }
  ]
}

function rebuildTrayMenu(): void {
  if (!tray || !dictation) return
  const settings = settingsStore.getPublic()
  const recording = dictation.isRecording()
  const busy = dictation.isBusy()
  // Read fresh, like the rest of the menu: a few file sizes, never a hash.
  const readiness = engineStatus()
  trayReadiness = readinessKey(readiness)
  const template: MenuItemConstructorOptions[] = [
    // A shortcut hint while nothing could be transcribed would promise a
    // dictation that cannot happen, so the reason takes its place.
    {
      label: readiness.ready
        ? shortcutHintLabel()
        : (readiness.notReadyReason ?? 'Transcription is not set up yet.'),
      enabled: false
    },
    // Visible wherever the user is: the window may be hidden when a save fails.
    ...(historyStore.getSaveStatus().saveFailed
      ? [{ label: HISTORY_SAVE_FAILED_TRAY_LABEL, enabled: false } as MenuItemConstructorOptions]
      : []),
    // One quiet line, only once a check the user allowed has found something.
    ...updateTrayItems(),
    { type: 'separator' },
    // Recording from the tray delivers to the clipboard: whatever has focus
    // when a menu is open is not a target the user chose to dictate into.
    {
      label: recording ? 'Stop recording' : 'Start recording',
      enabled: recording || (!busy && readiness.ready),
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
      label: 'Quit Vocette',
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

/** What the tray icon shows, and the timer that animates writing. */
let trayState: TrayState = 'ready'
let trayLevelAt = 0
let trayWritingStep = 0
let trayWritingTimer: NodeJS.Timeout | null = null

/** The tray's frames are drawn at 16 and 32 px; Windows picks the one for its scale. */
function trayImage(frame: TrayFrame): Electron.NativeImage {
  const image = nativeImage.createEmpty()
  image.addRepresentation({ scaleFactor: 1, dataURL: `data:image/png;base64,${frame.small.toString('base64')}` })
  image.addRepresentation({ scaleFactor: 2, dataURL: `data:image/png;base64,${frame.large.toString('base64')}` })
  return image
}

/** The taskbar's own light or dark, which the tray sits on; not the app's theme. */
function darkTaskbar(): boolean {
  return nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
}

function paintTray(heights?: readonly number[], alphas?: readonly number[]): void {
  tray?.setImage(trayImage(trayFrame(trayState, darkTaskbar(), heights, alphas)))
}

/** Ready, listening or writing, from the workflow phase. */
function setTrayState(phase: WorkflowStatus['phase']): void {
  const next: TrayState =
    phase === 'recording' ? 'listening' : phase === 'processing' || phase === 'starting' ? 'writing' : 'ready'
  if (next === trayState) return
  trayState = next
  trayWritingTimer = clearTimer(trayWritingTimer)
  if (next === 'writing') {
    // A light passes along the bars while the words are being worked out.
    trayWritingTimer = setInterval(() => {
      trayWritingStep += 1
      paintTray(undefined, writingAlphas(trayWritingStep))
    }, 140)
    paintTray(undefined, writingAlphas(trayWritingStep))
    return
  }
  paintTray(next === 'listening' ? listeningBars(0) : undefined)
}

/**
 * While listening, the bars follow the microphone. Readings arrive about 14
 * times a second; ten redraws a second is plenty for a 16 px icon and keeps
 * the shell from churning.
 */
function trayLevel(level: number): void {
  if (trayState !== 'listening') return
  const now = Date.now()
  if (now - trayLevelAt < 100) return
  trayLevelAt = now
  paintTray(listeningBars(level))
}

function createTray(): void {
  tray = new Tray(trayImage(trayFrame('ready', darkTaskbar())))
  // Switching the taskbar between light and dark repaints the bars to match.
  nativeTheme.on('updated', () => {
    if (trayState !== 'writing') paintTray(trayState === 'listening' ? listeningBars(0) : undefined)
  })
  tray.setToolTip('Vocette')
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
    if (before.pasteLastShortcut !== after.pasteLastShortcut) {
      applyPasteLastShortcut(after.pasteLastShortcut)
    }
    if (before.trialEndNoticeDismissed !== after.trialEndNoticeDismissed) {
      broadcastLicenceStatus()
    }

    if (await historyStore.prune(after.historyRetentionDays)) {
      mainWindow?.webContents.send('history:changed')
    }
    // A saved key, or a changed shortcut, can change what the system allows.
    refreshCapabilities()
    rebuildTrayMenu()
    // A new engine or key changes whether a dictation can be transcribed.
    broadcastEngineStatus()
    return result
  })

  ipcMain.handle('settings:clear-polish-key', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    return settingsStore.clearPolishKey()
  })
  // Test for polish: one short sentence to the saved provider, as a dictation
  // would send it, and what came back.
  ipcMain.handle('polish:test', async (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    const started = performance.now()
    try {
      const text = await requestPolish(polishRequest(POLISH_TEST_TEXT))
      return { ok: true, text: text.trim(), ms: Math.round(performance.now() - started), error: null }
    } catch (error) {
      return {
        ok: false,
        text: null,
        ms: null,
        error: error instanceof Error ? error.message : 'Polish could not be tested.'
      }
    }
  })
  ipcMain.handle('settings:clear-api-key', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    const result = settingsStore.clearApiKey()
    refreshCapabilities()
    broadcastEngineStatus()
    return result
  })

  ipcMain.handle('settings:clear-session-key', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    const result = settingsStore.clearSessionApiKey()
    broadcastEngineStatus()
    return result
  })

  // Test connection. It takes nothing from the window: the endpoint, model and
  // key are the saved ones, so the stored key never goes anywhere the user has
  // not saved, and a window cannot aim a request of its own. One request, with
  // no retry, and a short timeout.
  ipcMain.handle('transcription:test', (event): Promise<TranscriptionTestResult> => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    const settings = settingsStore.getInternal()
    return runConnectionTest({
      endpoint: settings.apiEndpoint,
      model: settings.model,
      language: settings.language,
      apiKey: () => settingsStore.getApiKey(),
      send: (input, timeoutMs) => transcriber.testConnection(input, timeoutMs),
      now: () => performance.now()
    })
  })

  ipcMain.handle('engine:get-status', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    return engineStatus()
  })
  // Starts and returns at once; progress and the outcome follow as
  // `engine:status` broadcasts.
  ipcMain.handle('engine:download', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    startModelDownload()
    return engineStatus()
  })
  ipcMain.handle('engine:cancel-download', async (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    // What has arrived stays on disk, so the next download resumes from it.
    await stopModelDownload()
    return engineStatus()
  })
  ipcMain.handle('engine:remove-model', async (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    if (dictation.isBusy()) throw new Error(REMOVE_WHILE_DICTATING)
    await stopModelDownload()
    // The worker holds the model in memory and may hold its files open.
    localEngine.unload()
    modelDownloadError = null
    try {
      await modelStore.remove(LOCAL_MODEL.id)
    } finally {
      broadcastEngineStatus()
    }
    return engineStatus()
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
  // An edit from the History page. The store refuses an unknown id or an
  // empty text, and clamps a long one, so only the types are checked here.
  ipcMain.handle('history:update', async (event, id: unknown, text: unknown) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid history entry.')
    if (typeof text !== 'string') throw new Error('Invalid dictation text.')
    return await historyStore.update(id, text)
  })
  // Undo after a delete: the window hands back its own copy of the entry.
  ipcMain.handle('history:restore', async (event, entry: unknown) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    if (!isRestorableEntry(entry) || entry.id.length > 128) {
      throw new Error('Invalid history entry.')
    }
    return await historyStore.restore(entry)
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

  ipcMain.handle('app:info', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    return {
      version: app.getVersion(),
      platform: process.platform,
      platformStatus: platformStatus()
    }
  })
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
    const checkout = checkoutConfig(process.env)
    const targets: Record<string, string> = {
      'api-keys': 'https://platform.openai.com/api-keys',
      'transcription-docs': 'https://developers.openai.com/api/docs/guides/speech-to-text',
      // Empty until the owner fills them in, and then nothing opens.
      'checkout-monthly': checkout.monthly,
      'checkout-yearly': checkout.yearly,
      'customer-portal': CUSTOMER_PORTAL_URL,
      // Only the release page a check has just validated, and only while an
      // update is on offer.
      release: updateChecker.downloadPage() ?? ''
    }
    const url = typeof target === 'string' ? targets[target] : undefined
    if (!url || !url.startsWith('https://')) return
    await shell.openExternal(url)
  })

  // The update check: off unless switched on, and "Check now" on request.
  ipcMain.handle('update:status', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    return updateChecker.getStatus()
  })
  ipcMain.handle('update:check-now', (event) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    return updateChecker.checkNow()
  })
  ipcMain.handle('update:set-enabled', (event, enabled: unknown) => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    if (typeof enabled !== 'boolean') throw new Error('Invalid update setting.')
    settingsStore.setUpdateCheck(enabled)
    updateChecker.enabledChanged()
    return updateChecker.getStatus()
  })

  // Pro. The window learns the plan and what it may offer; it never sees a
  // key once it has been sent, an activation id, or Polar's identifiers.
  ipcMain.handle('licence:status', (event): LicenceStatus => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    return licenceStatus()
  })
  ipcMain.handle('licence:activate', async (event, key: unknown): Promise<LicenceActivation> => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    if (typeof key !== 'string') {
      return { ok: false, error: LICENCE_MESSAGES.empty, status: licenceStatus() }
    }
    return activateLicence(key)
  })
  // "Check now" on the Pro page: one validation, then the status as it stands.
  ipcMain.handle('licence:check-now', async (event): Promise<LicenceStatus> => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    await subscriptionChecker.checkNow()
    return licenceStatus()
  })
  ipcMain.handle('licence:deactivate', async (event): Promise<LicenceRelease> => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    return releaseLicence()
  })
  // Local only: the device slot stays in use until it is released from the
  // purchase email. The Pro page says so before offering this.
  ipcMain.handle('licence:remove-local', (event): LicenceStatus => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    if (licenceRequestInFlight) throw new Error('Vocette is already talking to Polar. Wait a moment.')
    if (settingsStore.licenceRecord()) {
      settingsStore.clearLicence()
      broadcastLicenceStatus()
    }
    return licenceStatus()
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
  ipcMain.handle('shortcut:paste-last-status', (event): PasteLastStatus => {
    if (!fromMain(event)) throw new Error('Forbidden.')
    return { pasteLastRegistered }
  })

  const fromRecorder = (event: IpcMainEvent): boolean => fromWindow(event, recorderWindow)

  ipcMain.on('recorder:started', (event, payload: RecorderStartedPayload) => {
    if (!fromRecorder(event)) return
    if (payload && typeof payload.requestId === 'string') dictation.onRecorderStarted(payload)
  })
  ipcMain.on('recorder:audio', (event, payload: RecorderAudioPayload) => {
    if (!fromRecorder(event)) return
    if (!payload || typeof payload.requestId !== 'string') return
    // The flag decides whether a take is transcribed at all, so it is taken
    // only as a real boolean. Anything else is ignored, and the take is sent
    // for transcription as it was before the recorder could tell.
    const speechDetected =
      typeof payload.speechDetected === 'boolean' ? payload.speechDetected : undefined
    void dictation.onRecorderAudio({ ...payload, speechDetected })
  })
  ipcMain.on('recorder:error', (event, payload: RecorderErrorPayload) => {
    if (!fromRecorder(event)) return
    if (payload && typeof payload.requestId === 'string' && typeof payload.message === 'string') {
      dictation.onRecorderError(payload)
    }
  })
  // The live level exists only to move the overlay's meter. It is passed on
  // for the take being recorded right now and at no other time, to the
  // overlay and no other window, and is never kept or logged.
  ipcMain.on('recorder:level', (event, payload: RecorderLevelPayload) => {
    if (!fromRecorder(event)) return
    if (!payload || typeof payload.requestId !== 'string') return
    if (typeof payload.level !== 'number' || !Number.isFinite(payload.level)) return
    if (!dictation.isRecordingRequest(payload.requestId)) return
    overlayWindow?.webContents.send('workflow:level', Math.min(1, Math.max(0, payload.level)))
  trayLevel(Math.min(1, Math.max(0, payload.level)))
  })
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData')
  // Before either store opens: the profile folder is named after the app, so
  // the rename from Vocette would otherwise leave the user's settings and
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
  modelStore = new ModelStore({
    root: modelsRoot({ env: process.env, platform: process.platform, userData }),
    // Chromium's network stack: the system proxy and certificate store, which
    // a managed network's proxy and TLS inspection both need.
    fetch: (url, init) => net.fetch(url, init)
  })
  // The same network stack, for activation and the daily subscription check.
  licenceClient = new LicenceClient({ fetch: (url, init) => net.fetch(url, init) })
  subscriptionChecker = new SubscriptionChecker({
    licence: () => settingsStore.licenceRecord(),
    key: () => settingsStore.getLicenceKey(),
    check: (key, record) => licenceClient.check(key, record, licenceConfig(process.env)),
    record: (result, at) => settingsStore.recordSubscriptionCheck(result, at),
    release: () => settingsStore.clearLicence(),
    busy: () => licenceRequestInFlight,
    onChange: () => broadcastLicenceStatus()
  })
  updateChecker = new UpdateChecker({
    fetch: (url, init) => net.fetch(url, init),
    repository: UPDATE_REPOSITORY,
    currentVersion: app.getVersion(),
    enabled: () => settingsStore.getInternal().updateCheck,
    lastCheckedAt: () => settingsStore.getInternal().lastUpdateCheckAt,
    saveLastCheckedAt: (iso) => settingsStore.setLastUpdateCheck(iso),
    onStatus: (status) => {
      mainWindow?.webContents.send('update:status', status)
      rebuildTrayMenu()
    }
  })
  // Nothing starts here: the worker is spawned by the first dictation that
  // needs it, and killed again once it has been idle for a while.
  localEngine = new LocalEngine({
    spawn: spawnEngineWorker,
    modelDir: modelStore.path(LOCAL_MODEL.id)
  })
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
    // The microphone opens once the chord has been held on its own for a
    // moment, before the hold delay has confirmed it. Neither changes anything
    // on screen, so the tray menu is not rebuilt for them.
    onArm: () => dictation.prepareDictation(),
    onDisarm: () => dictation.abandonPreparation(),
    // Esc on its own cancels a recording nobody is holding a key for.
    onEscape: () => dictation.cancelOnEscape(),
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
  powerMonitor.on('suspend', finishTakeBeforeAway)
  powerMonitor.on('lock-screen', finishTakeBeforeAway)
  powerMonitor.on('resume', rearmShortcut)
  powerMonitor.on('unlock-screen', rearmShortcut)
  // Sends nothing now: a minute from here, and only if switched on and due.
  updateChecker.start()
  // Likewise: a minute from here, and only with a key activated on this PC.
  subscriptionChecker.start()
  applyPasteLastShortcut(initial.pasteLastShortcut)
  // Starting may have discovered the shortcut cannot be registered at all.
  refreshCapabilities()

  const startsInBackground = process.argv.includes('--background')
  if (!startsInBackground) {
    // History carries the setup guidance, so that is where a first run lands.
    // Only a cloud user who cannot dictate yet — no key, and no server of
    // their own that might need none — has nothing to do but open Settings.
    const readiness = engineStatus()
    showMain(readiness.engine === 'cloud' && !readiness.ready ? 'settings' : 'history')
  }

  // A recovered or damaged data file is worth telling the user about — the old
  // build reset silently.
  const warnings = [settingsStore.takeWarning(), historyStore.takeWarning()].filter(Boolean)
  if (warnings.length) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Vocette recovered your data',
      message: 'Some saved data could not be read.',
      detail: warnings.join('\n\n')
    })
  }

  if (migration.error) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Vocette',
      message: 'Your previous Vocette settings could not be copied across.',
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
      title: 'Vocette',
      message: 'Vocette is now Vocette.',
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
      'Vocette could not start',
      error instanceof Error ? error.message : 'An unexpected startup error occurred.'
    )
    app.quit()
  })
}

app.on('before-quit', (event) => {
  isQuitting = true
  dictation?.shutdown()
  // A download stopped here resumes from its part files next time.
  modelDownload?.controller.abort()
  localEngine?.dispose()
  updateChecker?.stop()
  subscriptionChecker?.stop()
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

// Vocette lives in the tray; closing the window must not quit it.
app.on('window-all-closed', () => {})
