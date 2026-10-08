import { randomBytes } from 'node:crypto'
import { safeStorage } from 'electron'
import {
  readJsonWithBackup,
  refreshJsonRecoveryBackup,
  removeJsonRecoveryCopies,
  writeJsonAtomic
} from './atomic-json'
import {
  DEFAULT_CHORD,
  DEFAULT_HOLD_DELAY_MS,
  HOLD_DELAY_OPTIONS,
  chordFromLegacyPreset,
  normaliseChord,
  validateChord,
  type ShortcutChord
} from '../shared/shortcuts'
import {
  RETENTION_OPTIONS,
  TRANSCRIPTION_ENGINES,
  TRANSCRIPTION_MODELS,
  THEMES,
  type ApiKeySource,
  type PublicSettings,
  type SettingsUpdate,
  type Theme,
  type TranscriptionEngine
} from '../shared/types'
import { RECORDING_MODES, type RecordingMode } from '../shared/capabilities'
import { clampReplacements } from '../shared/replacements'
import { clampVocabulary } from '../shared/vocabulary'
import { DEFAULT_ZOOM, isZoomStep } from './zoom'
import {
  DEFAULT_POLISH,
  MAX_POLISH_INSTRUCTIONS_CHARS,
  POLISH_BUDGETS_MS,
  POLISH_MODEL_PATTERN,
  POLISH_STYLES,
  type PolishBudgetMs,
  type PolishStyle
} from '../shared/polish'
import { assessSecureStorage, type SecureStorageAssessment } from './secure-storage'

/** v5 added `theme`; earlier files load with the default. */
export const SETTINGS_VERSION = 5

/**
 * A Pro licence activated on this PC: what releasing it later needs, and what
 * the Pro page shows. Nothing else from Polar's answer is kept — it names the
 * buyer, and none of that is Vocette's business.
 *
 * `encryptedKey` holds the key encrypted by the operating system wherever
 * that is possible. Where it is not, it holds the key as typed, and
 * `keyStorage` says `plain`. The API key is refused in that case, but a
 * licence key is an entitlement token rather than a credential: it unlocks
 * Pro in this app, and it spends no money and opens no account. Refusing to
 * keep it would take Pro away from a paying user for very little protection.
 * It is still encrypted where it can be, because whoever holds a key can use
 * one of its device slots and see the buyer details Polar returns.
 */
export interface StoredLicence {
  encryptedKey: string
  keyStorage: 'encrypted' | 'plain'
  activationId: string
  benefitId: string
  /** Polar's masked form of the key, "****-E304DA", or its last four characters. */
  displayKey: string
  activatedAt: string
  /**
   * What Polar last said about the subscription behind the key. "ended" keeps
   * the key, so a new subscription brings Pro back at the next check.
   */
  subscription: 'active' | 'ended'
  /** When Polar last confirmed the subscription as active; activation counts. */
  confirmedAt: string
}

/** The licence as the main process may pass it around: no key material. */
export type LicenceRecord = Omit<StoredLicence, 'encryptedKey' | 'keyStorage'>

/** What activating hands the store to keep. */
export interface NewLicence {
  key: string
  activationId: string
  benefitId: string
  displayKey: string
  activatedAt: string
}

/** Four upper-case hexadecimal characters, generated once per profile. */
const DEVICE_TAG_PATTERN = /^[0-9A-F]{4}$/u
const MAX_LICENCE_FIELD_CHARS = 200
const MAX_STORED_KEY_CHARS = 4096

export interface StoredSettings {
  version: number
  engine: TranscriptionEngine
  shortcut: ShortcutChord
  holdDelayMs: number
  recordingMode: RecordingMode
  hotkeyEnabled: boolean
  instantCapture: boolean
  autoPaste: boolean
  restoreClipboard: boolean
  pasteLastShortcut: boolean
  removeFillers: boolean
  spokenCorrections: boolean
  spokenFormatting: boolean
  playSounds: boolean
  launchAtLogin: boolean
  theme: Theme
  microphoneId: string
  historyRetentionDays: number
  model: string
  language: string
  vocabulary: string
  replacements: string
  apiEndpoint: string
  encryptedApiKey: string
  /**
   * When this profile's Pro trial began. Absent in a file written before the
   * trial existed, and then set the first time this version loads it — so an
   * existing user's trial starts on their first launch of it, like a new one's.
   */
  trialStartedAt: string | null
  /** The one notice that the trial has ended has been dismissed, for good. */
  trialEndNoticeDismissed: boolean
  /** Names this PC in the activation label: the 7F3A of "Vocette on Windows · 7F3A". */
  deviceTag: string
  licence: StoredLicence | null
  /** The daily update check. Off unless the user switches it on on the About page. */
  updateCheck: boolean
  /** When an update check last finished, so a restart cannot make it daily-plus. */
  lastUpdateCheckAt: string | null
  /** The main window's zoom, one of `ZOOM_STEPS`; the pill never zooms. */
  uiZoom: number
  /** AI polish (Pro); see `src/shared/polish.ts`. */
  polishEnabled: boolean
  polishStyle: PolishStyle
  polishInstructions: string
  polishEndpoint: string
  polishModel: string
  polishBudgetMs: PolishBudgetMs
  /** The polish provider's key, encrypted like the transcription key. */
  encryptedPolishKey: string
}

export const DEFAULT_SETTINGS: StoredSettings = {
  version: SETTINGS_VERSION,
  // A fresh install transcribes on this PC: nothing to sign up for, and no
  // recording leaves the machine unless the user chooses a cloud provider.
  engine: 'local',
  shortcut: DEFAULT_CHORD,
  holdDelayMs: DEFAULT_HOLD_DELAY_MS,
  recordingMode: 'hold',
  hotkeyEnabled: true,
  // The clipped first word is the commonest complaint about push-to-talk, and
  // what is captured for another shortcut is discarded unheard.
  instantCapture: true,
  autoPaste: true,
  restoreClipboard: true,
  pasteLastShortcut: true,
  removeFillers: true,
  spokenCorrections: true,
  spokenFormatting: true,
  playSounds: true,
  launchAtLogin: false,
  theme: 'system',
  microphoneId: '',
  historyRetentionDays: 0,
  model: 'gpt-transcribe',
  language: 'en',
  vocabulary: '',
  replacements: '',
  apiEndpoint: '',
  encryptedApiKey: '',
  trialStartedAt: null,
  trialEndNoticeDismissed: false,
  deviceTag: '',
  licence: null,
  updateCheck: false,
  lastUpdateCheckAt: null,
  uiZoom: DEFAULT_ZOOM,
  polishEnabled: DEFAULT_POLISH.enabled,
  polishStyle: DEFAULT_POLISH.style,
  polishInstructions: DEFAULT_POLISH.instructions,
  polishEndpoint: DEFAULT_POLISH.endpoint,
  polishModel: DEFAULT_POLISH.model,
  polishBudgetMs: DEFAULT_POLISH.budgetMs,
  encryptedPolishKey: ''
}

const MAX_API_KEY_LENGTH = 512
const MAX_ENDPOINT_LENGTH = 300
const retentionSet = new Set<number>(RETENTION_OPTIONS)
const holdDelaySet = new Set<number>(HOLD_DELAY_OPTIONS)
const modelSet = new Set<string>(TRANSCRIPTION_MODELS)
const recordingModeSet = new Set<string>(RECORDING_MODES)
const themeSet = new Set<string>(THEMES)
const engineSet = new Set<string>(TRANSCRIPTION_ENGINES)
const polishStyleSet = new Set<string>(POLISH_STYLES)
const polishBudgetSet = new Set<number>(POLISH_BUDGETS_MS)
/** A model name for custom endpoints: provider slug, letters/digits/dots/dashes. */
const CUSTOM_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u

interface SettingsPersistence {
  writeJsonAtomic: typeof writeJsonAtomic
  removeJsonRecoveryCopies: typeof removeJsonRecoveryCopies
  refreshJsonRecoveryBackup: typeof refreshJsonRecoveryBackup
}

/** What the store needs from the world beyond its file; injectable for tests. */
export interface StoreEnvironment {
  now?: () => number
  /** Four upper-case hexadecimal characters; random unless a test supplies them. */
  newDeviceTag?: () => string
}

function randomDeviceTag(): string {
  return randomBytes(2).toString('hex').toUpperCase()
}

function isLanguageCode(value: unknown): value is string {
  return typeof value === 'string' && (value === 'auto' || /^[a-z]{2}$/u.test(value))
}

/**
 * Endpoint rules: empty means api.openai.com. Otherwise https is required —
 * except for http on localhost/127.0.0.1, so a locally hosted transcription
 * server (whisper.cpp, vLLM) can be used without certificates.
 */
function isValidEndpoint(value: string): boolean {
  if (!value) return true
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
}

/** A polish endpoint follows the transcription rules, but may never be empty. */
function isValidPolishEndpoint(value: string): boolean {
  return value !== '' && value.length <= MAX_ENDPOINT_LENGTH && isValidEndpoint(value)
}

/** Empty is allowed and means "not chosen yet"; polish is then not attempted. */
function isValidPolishModel(value: string): boolean {
  return value === '' || POLISH_MODEL_PATTERN.test(value)
}

export function isValidModel(value: string, apiEndpoint: string): boolean {
  if (modelSet.has(value)) return true
  // A custom model name is only meaningful against a custom endpoint.
  return apiEndpoint !== '' && CUSTOM_MODEL_PATTERN.test(value)
}

/**
 * Reads a settings object of any known version into the current shape.
 *
 * v1 stored `shortcut` as a preset id string; v2 stores the actual keycodes so
 * any chord can be expressed. `encryptedApiKey` is carried across untouched —
 * losing it would silently log the user out of their own API account.
 */
export function normaliseSettings(value: unknown): StoredSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS }
  const candidate = value as Record<string, unknown>

  const chord =
    normaliseChord(candidate.shortcut) ??
    chordFromLegacyPreset(candidate.shortcut) ??
    DEFAULT_CHORD
  // A chord that is no longer allowed (e.g. a bare modifier saved by an older
  // build) falls back to the default rather than being rejected at runtime.
  const shortcut = validateChord(chord.keys).ok ? chord : DEFAULT_CHORD
  const apiEndpoint =
    typeof candidate.apiEndpoint === 'string' &&
    candidate.apiEndpoint.length <= MAX_ENDPOINT_LENGTH &&
    isValidEndpoint(candidate.apiEndpoint)
      ? candidate.apiEndpoint
      : ''

  return {
    version: SETTINGS_VERSION,
    engine: storedEngine(candidate),
    shortcut,
    recordingMode:
      typeof candidate.recordingMode === 'string' && recordingModeSet.has(candidate.recordingMode)
        ? (candidate.recordingMode as RecordingMode)
        : DEFAULT_SETTINGS.recordingMode,
    holdDelayMs:
      typeof candidate.holdDelayMs === 'number' && holdDelaySet.has(candidate.holdDelayMs)
        ? candidate.holdDelayMs
        : DEFAULT_SETTINGS.holdDelayMs,
    hotkeyEnabled:
      typeof candidate.hotkeyEnabled === 'boolean'
        ? candidate.hotkeyEnabled
        : DEFAULT_SETTINGS.hotkeyEnabled,
    // Added within v5, like the clipboard switches: absent means on, the same
    // as a fresh install, so an existing user keeps their first word too.
    instantCapture:
      typeof candidate.instantCapture === 'boolean'
        ? candidate.instantCapture
        : DEFAULT_SETTINGS.instantCapture,
    autoPaste:
      typeof candidate.autoPaste === 'boolean' ? candidate.autoPaste : DEFAULT_SETTINGS.autoPaste,
    // Added within v5, like the cleanup switches: absent means on, the same as
    // a fresh install, so an existing user gets their clipboard back too.
    restoreClipboard:
      typeof candidate.restoreClipboard === 'boolean'
        ? candidate.restoreClipboard
        : DEFAULT_SETTINGS.restoreClipboard,
    pasteLastShortcut:
      typeof candidate.pasteLastShortcut === 'boolean'
        ? candidate.pasteLastShortcut
        : DEFAULT_SETTINGS.pasteLastShortcut,
    removeFillers:
      typeof candidate.removeFillers === 'boolean'
        ? candidate.removeFillers
        : DEFAULT_SETTINGS.removeFillers,
    // Added within v5, so no version bump: a file that predates them has
    // neither key, and absent means on — the same as a fresh install.
    spokenCorrections:
      typeof candidate.spokenCorrections === 'boolean'
        ? candidate.spokenCorrections
        : DEFAULT_SETTINGS.spokenCorrections,
    spokenFormatting:
      typeof candidate.spokenFormatting === 'boolean'
        ? candidate.spokenFormatting
        : DEFAULT_SETTINGS.spokenFormatting,
    playSounds:
      typeof candidate.playSounds === 'boolean'
        ? candidate.playSounds
        : DEFAULT_SETTINGS.playSounds,
    launchAtLogin:
      typeof candidate.launchAtLogin === 'boolean'
        ? candidate.launchAtLogin
        : DEFAULT_SETTINGS.launchAtLogin,
    theme:
      typeof candidate.theme === 'string' && themeSet.has(candidate.theme)
        ? (candidate.theme as Theme)
        : DEFAULT_SETTINGS.theme,
    microphoneId:
      typeof candidate.microphoneId === 'string' ? candidate.microphoneId.slice(0, 512) : '',
    historyRetentionDays:
      typeof candidate.historyRetentionDays === 'number' &&
      retentionSet.has(candidate.historyRetentionDays)
        ? candidate.historyRetentionDays
        : DEFAULT_SETTINGS.historyRetentionDays,
    model:
      typeof candidate.model === 'string' && isValidModel(candidate.model, apiEndpoint)
        ? candidate.model
        : DEFAULT_SETTINGS.model,
    language: isLanguageCode(candidate.language)
      ? candidate.language
      : DEFAULT_SETTINGS.language,
    // Clamped, never rejected: a vocabulary is free text, and losing the whole
    // list because it grew too long would be the wrong trade. The clamp cuts
    // on a line boundary so a half-term is never biased into a request.
    vocabulary:
      typeof candidate.vocabulary === 'string'
        ? clampVocabulary(candidate.vocabulary)
        : DEFAULT_SETTINGS.vocabulary,
    // Added within v5, like the vocabulary: absent means no rules. Clamped for
    // the same reason, on a line boundary, so a cut can never leave half a
    // snippet behind to be pasted as if it were whole.
    replacements:
      typeof candidate.replacements === 'string'
        ? clampReplacements(candidate.replacements)
        : DEFAULT_SETTINGS.replacements,
    apiEndpoint,
    encryptedApiKey:
      typeof candidate.encryptedApiKey === 'string' ? candidate.encryptedApiKey : '',
    // Added within v5, like the switches. Absent, or a date that cannot be
    // read, means not started — and the store starts it as it loads.
    trialStartedAt:
      typeof candidate.trialStartedAt === 'string' &&
      candidate.trialStartedAt.length <= 64 &&
      !Number.isNaN(Date.parse(candidate.trialStartedAt))
        ? candidate.trialStartedAt
        : null,
    trialEndNoticeDismissed: candidate.trialEndNoticeDismissed === true,
    deviceTag:
      typeof candidate.deviceTag === 'string' && DEVICE_TAG_PATTERN.test(candidate.deviceTag)
        ? candidate.deviceTag
        : '',
    licence: normaliseLicence(candidate.licence),
    // Added within v5: absent means off, as on a fresh install. Only a real
    // true switches it on, so no damaged file can start sending requests.
    updateCheck: candidate.updateCheck === true,
    // Added within v5, like the update check: absent means off, with the
    // OpenAI preset filled in, as on a fresh install.
    polishEnabled: candidate.polishEnabled === true,
    polishStyle:
      typeof candidate.polishStyle === 'string' && polishStyleSet.has(candidate.polishStyle)
        ? (candidate.polishStyle as PolishStyle)
        : DEFAULT_POLISH.style,
    polishInstructions:
      typeof candidate.polishInstructions === 'string'
        ? candidate.polishInstructions.slice(0, MAX_POLISH_INSTRUCTIONS_CHARS)
        : DEFAULT_POLISH.instructions,
    polishEndpoint:
      typeof candidate.polishEndpoint === 'string' && isValidPolishEndpoint(candidate.polishEndpoint)
        ? candidate.polishEndpoint
        : DEFAULT_POLISH.endpoint,
    polishModel:
      typeof candidate.polishModel === 'string' && isValidPolishModel(candidate.polishModel)
        ? candidate.polishModel
        : DEFAULT_POLISH.model,
    polishBudgetMs:
      typeof candidate.polishBudgetMs === 'number' && polishBudgetSet.has(candidate.polishBudgetMs)
        ? (candidate.polishBudgetMs as PolishBudgetMs)
        : DEFAULT_POLISH.budgetMs,
    encryptedPolishKey:
      typeof candidate.encryptedPolishKey === 'string' ? candidate.encryptedPolishKey : '',
    lastUpdateCheckAt:
      typeof candidate.lastUpdateCheckAt === 'string' &&
      candidate.lastUpdateCheckAt.length <= 64 &&
      !Number.isNaN(Date.parse(candidate.lastUpdateCheckAt))
        ? candidate.lastUpdateCheckAt
        : null,
    uiZoom: isZoomStep(candidate.uiZoom) ? candidate.uiZoom : DEFAULT_ZOOM
  }
}

/**
 * A stored licence, or null when there is none or it cannot be used. Every
 * field is needed — releasing this PC sends the key and the activation id —
 * so a record missing one is treated as no licence rather than half of one.
 */
function normaliseLicence(value: unknown): StoredLicence | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const text = (field: unknown, max = MAX_LICENCE_FIELD_CHARS): string | null =>
    typeof field === 'string' && field.length > 0 && field.length <= max ? field : null
  const encryptedKey = text(candidate.encryptedKey, MAX_STORED_KEY_CHARS)
  const keyStorage =
    candidate.keyStorage === 'encrypted' || candidate.keyStorage === 'plain'
      ? candidate.keyStorage
      : null
  const activationId = text(candidate.activationId)
  const benefitId = text(candidate.benefitId)
  const displayKey = text(candidate.displayKey)
  const activatedText = text(candidate.activatedAt)
  const activatedAt =
    activatedText !== null && !Number.isNaN(Date.parse(activatedText)) ? activatedText : null
  if (!encryptedKey || !keyStorage || !activationId || !benefitId || !displayKey || !activatedAt) {
    return null
  }
  // Added with subscriptions: a record without them counts as confirmed when
  // it was activated, so the next check decides, within the grace period.
  const confirmedText = text(candidate.confirmedAt)
  const confirmedAt =
    confirmedText !== null && !Number.isNaN(Date.parse(confirmedText)) ? confirmedText : activatedAt
  const subscription = candidate.subscription === 'ended' ? 'ended' : 'active'
  return {
    encryptedKey,
    keyStorage,
    activationId,
    benefitId,
    displayKey,
    activatedAt,
    subscription,
    confirmedAt
  }
}

/**
 * The engine a settings file asks for. Added within v5, so no version bump: a
 * file that predates it has no `engine`. A file that already holds a saved key
 * belongs to someone whose cloud dictation works today, and moving them to a
 * model they have not downloaded would break it — so they keep the cloud.
 * Everyone else starts on this PC.
 */
function storedEngine(candidate: Record<string, unknown>): TranscriptionEngine {
  if (typeof candidate.engine === 'string' && engineSet.has(candidate.engine)) {
    return candidate.engine as TranscriptionEngine
  }
  const hasSavedKey =
    typeof candidate.encryptedApiKey === 'string' && candidate.encryptedApiKey.length > 0
  return hasSavedKey ? 'cloud' : DEFAULT_SETTINGS.engine
}

export class SettingsStore {
  private settings: StoredSettings
  private warning: string | null = null
  private readonly persistence: SettingsPersistence
  /**
   * A key the user asked to keep for this session only. It is never written
   * anywhere, never leaves the main process, and disappears when the app
   * quits. This is what makes a system without usable secure storage usable
   * at all, without ever putting a credential on disk in the clear.
   */
  private sessionApiKey: string | null = null

  constructor(
    private readonly filePath: string,
    persistence: Partial<SettingsPersistence> = {},
    private readonly storage: SecureStorageAssessment = assessSecureStorage(safeStorage),
    environment: StoreEnvironment = {}
  ) {
    this.persistence = {
      writeJsonAtomic,
      removeJsonRecoveryCopies,
      refreshJsonRecoveryBackup,
      ...persistence
    }
    const { value, problem } = readJsonWithBackup<unknown>(filePath)
    this.settings = normaliseSettings(value)
    this.warning = problem ?? null
    this.startTrialAndTagDevice(environment)
  }

  /**
   * The trial starts the first time this version loads a profile, and this PC
   * gets its tag the same way. Both are written straight away, so a restart
   * moves neither. A write that fails here is not fatal: both stay in memory
   * for this session, and the next save writes them.
   */
  private startTrialAndTagDevice(environment: StoreEnvironment): void {
    let changed = false
    if (this.settings.trialStartedAt === null) {
      const now = (environment.now ?? Date.now)()
      this.settings.trialStartedAt = new Date(Number.isFinite(now) ? now : Date.now()).toISOString()
      changed = true
    }
    if (this.settings.deviceTag === '') {
      const tag = environment.newDeviceTag?.() ?? ''
      this.settings.deviceTag = DEVICE_TAG_PATTERN.test(tag) ? tag : randomDeviceTag()
      changed = true
    }
    if (!changed) return
    try {
      this.write()
    } catch {
      // Kept in memory; the next save persists it.
    }
  }

  /** One-shot read of any recovery warning raised while loading. */
  takeWarning(): string | null {
    const warning = this.warning
    this.warning = null
    return warning
  }

  /**
   * What the renderer may see, named field by field.
   *
   * An allow-list on purpose. This used to copy the stored settings and delete
   * the fields that must not cross, so every field added to the file crossed
   * into the window by default — the trial date and the licence among them.
   * Now a new stored field stays in the main process until it is listed here,
   * and the key-set test fails if one is added to either side alone.
   */
  getPublic(): PublicSettings {
    const stored = this.settings
    return {
      engine: stored.engine,
      shortcut: { keys: [...stored.shortcut.keys] },
      holdDelayMs: stored.holdDelayMs,
      recordingMode: stored.recordingMode,
      hotkeyEnabled: stored.hotkeyEnabled,
      instantCapture: stored.instantCapture,
      autoPaste: stored.autoPaste,
      restoreClipboard: stored.restoreClipboard,
      pasteLastShortcut: stored.pasteLastShortcut,
      removeFillers: stored.removeFillers,
      spokenCorrections: stored.spokenCorrections,
      spokenFormatting: stored.spokenFormatting,
      playSounds: stored.playSounds,
      launchAtLogin: stored.launchAtLogin,
      theme: stored.theme,
      microphoneId: stored.microphoneId,
      historyRetentionDays: stored.historyRetentionDays,
      model: stored.model,
      language: stored.language,
      vocabulary: stored.vocabulary,
      replacements: stored.replacements,
      apiEndpoint: stored.apiEndpoint,
      apiKeySource: this.apiKeySource(),
      polish: {
        enabled: stored.polishEnabled,
        style: stored.polishStyle,
        instructions: stored.polishInstructions,
        endpoint: stored.polishEndpoint,
        model: stored.polishModel,
        budgetMs: stored.polishBudgetMs,
        keySource: stored.encryptedPolishKey ? 'stored' : 'none'
      }
    }
  }

  apiKeySource(): ApiKeySource {
    if (this.sessionApiKey) return 'session'
    return this.settings.encryptedApiKey.length > 0 ? 'stored' : 'none'
  }

  /** Whether this system can hold a credential safely. Never key material. */
  keyStorage(): SecureStorageAssessment {
    return this.storage
  }

  /**
   * Main process only. Leaves out the API key and the licence, which have
   * their own accessors, so neither is handed around with the rest.
   */
  getInternal(): Omit<
    StoredSettings,
    'encryptedApiKey' | 'encryptedPolishKey' | 'version' | 'licence'
  > {
    const {
      encryptedApiKey: _key,
      encryptedPolishKey: _polishKey,
      version: _version,
      licence: _licence,
      ...values
    } = this.settings
    return { ...values }
  }

  /** The polish provider's key, decrypted; empty when none is saved. */
  getPolishKey(): string {
    if (!this.settings.encryptedPolishKey) return ''
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is unavailable, so the saved polish key cannot be read.')
    }
    try {
      return safeStorage.decryptString(Buffer.from(this.settings.encryptedPolishKey, 'base64'))
    } catch {
      throw new Error('The saved polish key could not be read. Enter it again in Settings.')
    }
  }

  /** Forgets the polish key, and scrubs the recovery copies so it does not linger. */
  clearPolishKey(): PublicSettings {
    const next = { ...this.settings, encryptedPolishKey: '' }
    this.persistence.writeJsonAtomic(this.filePath, next)
    this.persistence.removeJsonRecoveryCopies(this.filePath)
    this.persistence.refreshJsonRecoveryBackup(this.filePath)
    this.settings = next
    return this.getPublic()
  }

  /** The licence activated on this PC, without its key, or null. */
  licenceRecord(): LicenceRecord | null {
    const licence = this.settings.licence
    if (!licence) return null
    const { encryptedKey: _key, keyStorage: _storage, ...record } = licence
    return record
  }

  /**
   * The licence key itself, which only releasing this PC needs. Throws when a
   * key the operating system encrypted cannot be read back — on another user
   * account, say, or with secure storage gone.
   */
  getLicenceKey(): string {
    const licence = this.settings.licence
    if (!licence) throw new Error('No licence is active on this PC.')
    if (licence.keyStorage === 'plain') return licence.encryptedKey
    try {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable.')
      return safeStorage.decryptString(Buffer.from(licence.encryptedKey, 'base64'))
    } catch {
      throw new Error(
        'The saved licence key could not be read on this PC, so it cannot be released from here.'
      )
    }
  }

  /**
   * Keeps a licence Polar has just activated: encrypted wherever the system
   * can hold it safely, and see `StoredLicence` for why it is kept plain
   * where it cannot.
   */
  saveLicence(input: NewLicence): void {
    const encrypted = this.storage.usable
    const licence: StoredLicence = {
      encryptedKey: encrypted ? safeStorage.encryptString(input.key).toString('base64') : input.key,
      keyStorage: encrypted ? 'encrypted' : 'plain',
      activationId: input.activationId,
      benefitId: input.benefitId,
      displayKey: input.displayKey,
      activatedAt: input.activatedAt,
      // Activation itself is Polar saying the key is granted.
      subscription: 'active',
      confirmedAt: input.activatedAt
    }
    const next = { ...this.settings, licence }
    this.persistence.writeJsonAtomic(this.filePath, next)
    this.settings = next
  }

  /**
   * Keeps what a subscription check found. "active" moves the confirmation to
   * `at`; "ended" keeps the last confirmation, and the key, as they were.
   */
  recordSubscriptionCheck(result: 'active' | 'ended', at: string): void {
    const licence = this.settings.licence
    if (!licence || Number.isNaN(Date.parse(at))) return
    const updated: StoredLicence =
      result === 'active'
        ? { ...licence, subscription: 'active', confirmedAt: at }
        : { ...licence, subscription: 'ended' }
    const next = { ...this.settings, licence: updated }
    this.persistence.writeJsonAtomic(this.filePath, next)
    this.settings = next
  }

  /** Switches the daily update check on or off. */
  setUpdateCheck(enabled: boolean): void {
    this.settings = { ...this.settings, updateCheck: enabled }
    this.write()
  }

  /** Keeps the main window's zoom for next time; a size that is not a step is ignored. */
  setUiZoom(factor: number): void {
    if (!isZoomStep(factor) || factor === this.settings.uiZoom) return
    this.settings = { ...this.settings, uiZoom: factor }
    this.write()
  }

  /** Records when an update check finished; "Check now" counts as well. */
  setLastUpdateCheck(iso: string): void {
    if (Number.isNaN(Date.parse(iso))) return
    this.settings = { ...this.settings, lastUpdateCheckAt: iso }
    this.write()
  }

  /**
   * Forgets the licence on this PC, and scrubs the recovery copies so the key
   * does not linger in a backup. It also settles the notice that the trial
   * has ended: someone who has just taken Pro off this PC knows their plan,
   * and "your Pro trial has ended" would be news about something else.
   */
  clearLicence(): void {
    const next = { ...this.settings, licence: null, trialEndNoticeDismissed: true }
    this.persistence.writeJsonAtomic(this.filePath, next)
    this.persistence.removeJsonRecoveryCopies(this.filePath)
    this.persistence.refreshJsonRecoveryBackup(this.filePath)
    this.settings = next
  }

  getApiKey(): string {
    // A session key is the most recent thing the user asked for, so it wins.
    if (this.sessionApiKey) return this.sessionApiKey
    if (!this.settings.encryptedApiKey) return ''
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'Secure storage is unavailable on this system, so the saved API key ' +
          'cannot be read. Sign out and back in, or add a key for this session.'
      )
    }
    try {
      return safeStorage.decryptString(Buffer.from(this.settings.encryptedApiKey, 'base64'))
    } catch {
      throw new Error('The saved API key could not be decrypted. Clear it and add it again.')
    }
  }

  update(update: SettingsUpdate): PublicSettings {
    if (typeof update.engine === 'string' && engineSet.has(update.engine)) {
      // Kept whatever the model or key situation: readiness is reported on
      // its own, so an engine may be chosen before it has been set up.
      this.settings.engine = update.engine
    }
    if (update.shortcut !== undefined) {
      const chord = normaliseChord(update.shortcut)
      if (!chord) throw new Error('That shortcut could not be read.')
      const validation = validateChord(chord.keys)
      if (!validation.ok) throw new Error(validation.error ?? 'That shortcut cannot be used.')
      this.settings.shortcut = chord
    }
    if (typeof update.holdDelayMs === 'number' && holdDelaySet.has(update.holdDelayMs)) {
      this.settings.holdDelayMs = update.holdDelayMs
    }
    if (typeof update.recordingMode === 'string' && recordingModeSet.has(update.recordingMode)) {
      // Stored as the user's preference, whatever this platform can honour.
      this.settings.recordingMode = update.recordingMode
    }
    if (typeof update.theme === 'string' && themeSet.has(update.theme)) {
      this.settings.theme = update.theme
    }
    if (typeof update.hotkeyEnabled === 'boolean') this.settings.hotkeyEnabled = update.hotkeyEnabled
    if (typeof update.instantCapture === 'boolean') {
      this.settings.instantCapture = update.instantCapture
    }
    if (typeof update.autoPaste === 'boolean') this.settings.autoPaste = update.autoPaste
    if (typeof update.restoreClipboard === 'boolean') {
      this.settings.restoreClipboard = update.restoreClipboard
    }
    if (typeof update.pasteLastShortcut === 'boolean') {
      this.settings.pasteLastShortcut = update.pasteLastShortcut
    }
    if (typeof update.removeFillers === 'boolean') this.settings.removeFillers = update.removeFillers
    if (typeof update.spokenCorrections === 'boolean') {
      this.settings.spokenCorrections = update.spokenCorrections
    }
    if (typeof update.spokenFormatting === 'boolean') {
      this.settings.spokenFormatting = update.spokenFormatting
    }
    if (typeof update.launchAtLogin === 'boolean') this.settings.launchAtLogin = update.launchAtLogin
    if (typeof update.microphoneId === 'string') {
      this.settings.microphoneId = update.microphoneId.slice(0, 512)
    }
    if (
      typeof update.historyRetentionDays === 'number' &&
      retentionSet.has(update.historyRetentionDays)
    ) {
      this.settings.historyRetentionDays = update.historyRetentionDays
    }
    if (typeof update.playSounds === 'boolean') this.settings.playSounds = update.playSounds
    if (typeof update.apiEndpoint === 'string' && update.apiEndpoint !== this.settings.apiEndpoint) {
      const endpoint = update.apiEndpoint.trim()
      if (endpoint.length > MAX_ENDPOINT_LENGTH || !isValidEndpoint(endpoint)) {
        throw new Error(
          'That API endpoint is not valid. Use an https:// URL, or http://localhost for a local transcription server.'
        )
      }
      this.settings.apiEndpoint = endpoint
      // A custom model name is only valid while an endpoint is configured;
      // clearing the endpoint must fall back to a known model.
      if (!isValidModel(this.settings.model, endpoint)) {
        this.settings.model = DEFAULT_SETTINGS.model
      }
    }
    if (typeof update.model === 'string' && update.model !== this.settings.model) {
      const model = update.model.trim()
      if (!isValidModel(model, this.settings.apiEndpoint)) {
        throw new Error('That model name is not recognised.')
      }
      this.settings.model = model
    }
    if (isLanguageCode(update.language)) this.settings.language = update.language
    if (typeof update.vocabulary === 'string') {
      this.settings.vocabulary = clampVocabulary(update.vocabulary)
    }
    if (typeof update.replacements === 'string') {
      this.settings.replacements = clampReplacements(update.replacements)
    }
    // Only ever set: once dismissed, the notice is gone for good.
    if (update.trialEndNoticeDismissed === true) this.settings.trialEndNoticeDismissed = true
    if (update.polish && typeof update.polish === 'object') this.applyPolishUpdate(update.polish)
    if (typeof update.polishKey === 'string' && update.polishKey.trim()) {
      const polishKey = update.polishKey.trim()
      if (polishKey.length > MAX_API_KEY_LENGTH) {
        throw new Error('That polish key is too long to be valid.')
      }
      // As for the transcription key: never obfuscated and called encrypted.
      if (!this.storage.usable) throw new Error(this.storage.reason)
      this.settings.encryptedPolishKey = safeStorage.encryptString(polishKey).toString('base64')
    }

    if (typeof update.apiKey === 'string' && update.apiKey.trim()) {
      const apiKey = update.apiKey.trim()
      if (apiKey.length > MAX_API_KEY_LENGTH) {
        throw new Error('That API key is too long to be valid.')
      }
      if (update.apiKeyScope === 'session') {
        // Nothing on disk changes. A previously stored key stays stored and
        // comes back if the session key is cleared.
        this.sessionApiKey = apiKey
      } else {
        // Refusing here is the point: obfuscating a credential and calling it
        // encrypted would be worse than not saving it at all.
        if (!this.storage.usable) throw new Error(this.storage.reason)
        this.settings.encryptedApiKey = safeStorage.encryptString(apiKey).toString('base64')
        this.sessionApiKey = null
      }
    }

    this.write()
    return this.getPublic()
  }

  /** Each polish field that is valid; an endpoint or model that is not is refused. */
  private applyPolishUpdate(polish: NonNullable<SettingsUpdate['polish']>): void {
    if (typeof polish.enabled === 'boolean') this.settings.polishEnabled = polish.enabled
    if (typeof polish.style === 'string' && polishStyleSet.has(polish.style)) {
      this.settings.polishStyle = polish.style
    }
    if (typeof polish.instructions === 'string') {
      this.settings.polishInstructions = polish.instructions.slice(0, MAX_POLISH_INSTRUCTIONS_CHARS)
    }
    if (typeof polish.budgetMs === 'number' && polishBudgetSet.has(polish.budgetMs)) {
      this.settings.polishBudgetMs = polish.budgetMs
    }
    if (typeof polish.endpoint === 'string' && polish.endpoint !== this.settings.polishEndpoint) {
      const endpoint = polish.endpoint.trim()
      if (!isValidPolishEndpoint(endpoint)) {
        throw new Error(
          'That polish endpoint is not valid. Use an https:// URL, or http://localhost for a model on this PC.'
        )
      }
      this.settings.polishEndpoint = endpoint
    }
    if (typeof polish.model === 'string' && polish.model !== this.settings.polishModel) {
      const model = polish.model.trim()
      if (!isValidPolishModel(model)) throw new Error('That polish model name is not valid.')
      this.settings.polishModel = model
    }
  }

  /** Drops the session key, falling back to a stored one if there is one. */
  clearSessionApiKey(): PublicSettings {
    this.sessionApiKey = null
    return this.getPublic()
  }

  clearApiKey(): PublicSettings {
    this.sessionApiKey = null
    const next = { ...this.settings, encryptedApiKey: '' }
    this.persistence.writeJsonAtomic(this.filePath, next)
    this.persistence.removeJsonRecoveryCopies(this.filePath)
    this.persistence.refreshJsonRecoveryBackup(this.filePath)
    this.settings = next
    return this.getPublic()
  }

  private write(): void {
    this.persistence.writeJsonAtomic(this.filePath, this.settings)
  }
}
