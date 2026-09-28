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
import { assessSecureStorage, type SecureStorageAssessment } from './secure-storage'

/** v5 added `theme`; earlier files load with the default. */
export const SETTINGS_VERSION = 5

export interface StoredSettings {
  version: number
  engine: TranscriptionEngine
  shortcut: ShortcutChord
  holdDelayMs: number
  recordingMode: RecordingMode
  hotkeyEnabled: boolean
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
  autoPaste: true,
  restoreClipboard: true,
  pasteLastShortcut: true,
  removeFillers: true,
  spokenCorrections: true,
  spokenFormatting: true,
  playSounds: true,
  launchAtLogin: false,
  theme: 'dark',
  microphoneId: '',
  historyRetentionDays: 0,
  model: 'gpt-transcribe',
  language: 'en',
  vocabulary: '',
  replacements: '',
  apiEndpoint: '',
  encryptedApiKey: ''
}

const MAX_API_KEY_LENGTH = 512
const MAX_ENDPOINT_LENGTH = 300
const retentionSet = new Set<number>(RETENTION_OPTIONS)
const holdDelaySet = new Set<number>(HOLD_DELAY_OPTIONS)
const modelSet = new Set<string>(TRANSCRIPTION_MODELS)
const recordingModeSet = new Set<string>(RECORDING_MODES)
const themeSet = new Set<string>(THEMES)
const engineSet = new Set<string>(TRANSCRIPTION_ENGINES)
/** A model name for custom endpoints: provider slug, letters/digits/dots/dashes. */
const CUSTOM_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u

interface SettingsPersistence {
  writeJsonAtomic: typeof writeJsonAtomic
  removeJsonRecoveryCopies: typeof removeJsonRecoveryCopies
  refreshJsonRecoveryBackup: typeof refreshJsonRecoveryBackup
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
      typeof candidate.encryptedApiKey === 'string' ? candidate.encryptedApiKey : ''
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
    private readonly storage: SecureStorageAssessment = assessSecureStorage(safeStorage)
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
  }

  /** One-shot read of any recovery warning raised while loading. */
  takeWarning(): string | null {
    const warning = this.warning
    this.warning = null
    return warning
  }

  getPublic(): PublicSettings {
    const { encryptedApiKey: _key, version: _version, ...values } = this.settings
    return { ...values, apiKeySource: this.apiKeySource() }
  }

  apiKeySource(): ApiKeySource {
    if (this.sessionApiKey) return 'session'
    return this.settings.encryptedApiKey.length > 0 ? 'stored' : 'none'
  }

  /** Whether this system can hold a credential safely. Never key material. */
  keyStorage(): SecureStorageAssessment {
    return this.storage
  }

  getInternal(): Omit<StoredSettings, 'encryptedApiKey' | 'version'> {
    const { encryptedApiKey: _key, version: _version, ...values } = this.settings
    return { ...values }
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
