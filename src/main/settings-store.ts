import { safeStorage } from 'electron'
import { readJsonWithBackup, writeJsonAtomic } from './atomic-json'
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
  TRANSCRIPTION_MODELS,
  type PublicSettings,
  type SettingsUpdate
} from '../shared/types'

export const SETTINGS_VERSION = 3

export interface StoredSettings {
  version: number
  shortcut: ShortcutChord
  holdDelayMs: number
  hotkeyEnabled: boolean
  autoPaste: boolean
  removeFillers: boolean
  playSounds: boolean
  launchAtLogin: boolean
  microphoneId: string
  historyRetentionDays: number
  model: string
  language: string
  apiEndpoint: string
  encryptedApiKey: string
}

export const DEFAULT_SETTINGS: StoredSettings = {
  version: SETTINGS_VERSION,
  shortcut: DEFAULT_CHORD,
  holdDelayMs: DEFAULT_HOLD_DELAY_MS,
  hotkeyEnabled: true,
  autoPaste: true,
  removeFillers: true,
  playSounds: true,
  launchAtLogin: false,
  microphoneId: '',
  historyRetentionDays: 0,
  model: 'gpt-transcribe',
  language: 'en',
  apiEndpoint: '',
  encryptedApiKey: ''
}

const MAX_API_KEY_LENGTH = 512
const MAX_ENDPOINT_LENGTH = 300
const retentionSet = new Set<number>(RETENTION_OPTIONS)
const holdDelaySet = new Set<number>(HOLD_DELAY_OPTIONS)
const modelSet = new Set<string>(TRANSCRIPTION_MODELS)
/** A model name for custom endpoints: provider slug, letters/digits/dots/dashes. */
const CUSTOM_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u

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
    shortcut,
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
    removeFillers:
      typeof candidate.removeFillers === 'boolean'
        ? candidate.removeFillers
        : DEFAULT_SETTINGS.removeFillers,
    playSounds:
      typeof candidate.playSounds === 'boolean'
        ? candidate.playSounds
        : DEFAULT_SETTINGS.playSounds,
    launchAtLogin:
      typeof candidate.launchAtLogin === 'boolean'
        ? candidate.launchAtLogin
        : DEFAULT_SETTINGS.launchAtLogin,
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
    apiEndpoint,
    encryptedApiKey:
      typeof candidate.encryptedApiKey === 'string' ? candidate.encryptedApiKey : ''
  }
}

export class SettingsStore {
  private settings: StoredSettings
  private warning: string | null = null

  constructor(private readonly filePath: string) {
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
    const { encryptedApiKey, version: _version, ...values } = this.settings
    return { ...values, apiKeyConfigured: encryptedApiKey.length > 0 }
  }

  getInternal(): Omit<StoredSettings, 'encryptedApiKey' | 'version'> {
    const { encryptedApiKey: _key, version: _version, ...values } = this.settings
    return { ...values }
  }

  getApiKey(): string {
    if (!this.settings.encryptedApiKey) return ''
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure Windows storage is unavailable. Restart Windows and try again.')
    }
    try {
      return safeStorage.decryptString(Buffer.from(this.settings.encryptedApiKey, 'base64'))
    } catch {
      throw new Error('The saved API key could not be decrypted. Clear it and add it again.')
    }
  }

  update(update: SettingsUpdate): PublicSettings {
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
    if (typeof update.hotkeyEnabled === 'boolean') this.settings.hotkeyEnabled = update.hotkeyEnabled
    if (typeof update.autoPaste === 'boolean') this.settings.autoPaste = update.autoPaste
    if (typeof update.removeFillers === 'boolean') this.settings.removeFillers = update.removeFillers
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

    if (typeof update.apiKey === 'string' && update.apiKey.trim()) {
      const apiKey = update.apiKey.trim()
      if (apiKey.length > MAX_API_KEY_LENGTH) {
        throw new Error('That API key is too long to be valid.')
      }
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Secure Windows storage is unavailable. The API key was not saved.')
      }
      this.settings.encryptedApiKey = safeStorage.encryptString(apiKey).toString('base64')
    }

    this.write()
    return this.getPublic()
  }

  clearApiKey(): PublicSettings {
    this.settings.encryptedApiKey = ''
    this.write()
    return this.getPublic()
  }

  private write(): void {
    writeJsonAtomic(this.filePath, this.settings)
  }
}
