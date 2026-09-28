import type { PlatformStatus, RecordingMode } from './capabilities'
import type { Plan } from './entitlement'
import type { ShortcutChord } from './shortcuts'

export type WorkflowPhase =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'processing'
  | 'success'
  | 'cancelled'
  | 'error'

export interface WorkflowStatus {
  phase: WorkflowPhase
  message: string
  detail?: string
  /** Epoch ms the recording began, for the overlay's elapsed timer. */
  startedAt?: number
  /**
   * Whether a failed take is being kept for Retry. The dictation controller
   * sets it on every status it sends, idle included, so the window never has
   * to ask.
   */
  canRetry?: boolean
}

/** True while a take is being recorded or transcribed — what the main process calls busy. */
export function dictationIsBusy(phase: WorkflowPhase): boolean {
  return phase === 'starting' || phase === 'recording' || phase === 'processing'
}

/**
 * Whether transcript history is known to be on disk. Deliberately carries no
 * transcript text, file path or raw error: it crosses the IPC bridge into the
 * renderer, and the user only needs to know that recent entries are at risk.
 */
export interface HistorySaveStatus {
  /** True while the newest in-memory history is not known to be saved. */
  saveFailed: boolean
}

export interface HistoryEntry {
  id: string
  text: string
  createdAt: string
  durationMs: number
  model: string
}

export const TRANSCRIPTION_MODELS = [
  'gpt-transcribe',
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
  'whisper-1'
] as const

export type TranscriptionModel = (typeof TRANSCRIPTION_MODELS)[number]

export const RETENTION_OPTIONS = [0, 30, 90, 365] as const

/** Settings as the renderer sees them — never includes the API key itself. */
/** Curated language list for the Settings dropdown. Codes are ISO-639-1. */
export const LANGUAGE_OPTIONS = [
  { code: 'auto', label: 'Automatic' },
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'Arabic' },
  { code: 'zh', label: 'Chinese' },
  { code: 'cs', label: 'Czech' },
  { code: 'da', label: 'Danish' },
  { code: 'nl', label: 'Dutch' },
  { code: 'fi', label: 'Finnish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'el', label: 'Greek' },
  { code: 'he', label: 'Hebrew' },
  { code: 'hi', label: 'Hindi' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'id', label: 'Indonesian' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'no', label: 'Norwegian' },
  { code: 'pl', label: 'Polish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ro', label: 'Romanian' },
  { code: 'ru', label: 'Russian' },
  { code: 'sk', label: 'Slovak' },
  { code: 'es', label: 'Spanish' },
  { code: 'sv', label: 'Swedish' },
  { code: 'th', label: 'Thai' },
  { code: 'tr', label: 'Turkish' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'vi', label: 'Vietnamese' }
] as const

/**
 * Where the API key currently in use came from.
 *
 * `session` means the key was never written to disk — the only honest option
 * where the operating system has no storage fit to hold a credential. It is
 * gone when Murmur quits, and the interface says so.
 */
export type ApiKeySource = 'none' | 'stored' | 'session'

/**
 * The interface palette, chosen by the user and kept with the rest of their
 * settings so it survives a restart. Modern Dark is the default; `light`
 * follows Visual Studio Code's Light Modern theme. The overlay uses the same
 * value, so a light window never has a black pill floating over it.
 */
export type Theme = 'dark' | 'light'

export const THEMES: readonly Theme[] = ['dark', 'light']

/**
 * Where speech becomes text. `local` runs the downloaded speech model on this
 * PC and sends nothing anywhere; `cloud` sends the recording to the
 * OpenAI-compatible provider the user configured, with their own key.
 */
export type TranscriptionEngine = 'local' | 'cloud'

export const TRANSCRIPTION_ENGINES: readonly TranscriptionEngine[] = ['local', 'cloud']

export interface PublicSettings {
  /** Which engine transcribes. The model or key it needs may still be missing. */
  engine: TranscriptionEngine
  shortcut: ShortcutChord
  holdDelayMs: number
  /** What the user asked for; the platform may not be able to honour it. */
  recordingMode: RecordingMode
  hotkeyEnabled: boolean
  /**
   * Open the microphone once the shortcut has been held for a moment, before
   * the hold delay has confirmed it, so the first word is less likely to be
   * cut off. Audio captured for a press that turns out to be another shortcut
   * is thrown away unheard.
   */
  instantCapture: boolean
  autoPaste: boolean
  /** Put back what the user had copied once an automatic paste has landed. */
  restoreClipboard: boolean
  /** Alt + Shift + V pastes the newest transcript again. Windows only, for now. */
  pasteLastShortcut: boolean
  removeFillers: boolean
  /** "Scratch that" and "Tuesday, no sorry, Wednesday". English rules only. */
  spokenCorrections: boolean
  /** "New line" and "new paragraph". English rules only. */
  spokenFormatting: boolean
  playSounds: boolean
  launchAtLogin: boolean
  theme: Theme
  microphoneId: string
  historyRetentionDays: number
  model: string
  language: string
  /**
   * The user's own words, one per line, sent as recognition bias with every
   * dictation. Stored verbatim so the text area round-trips; parsed into terms
   * at the point of use by `parseVocabulary`.
   */
  vocabulary: string
  /**
   * Replacement rules and snippets, one `spoken => written` per line, applied
   * to every transcript after cleanup. Stored verbatim so the text area
   * round-trips; parsed at the point of use by `parseReplacements`. Unlike
   * the vocabulary, they never leave this computer.
   */
  replacements: string
  /** Empty = api.openai.com. Otherwise an OpenAI-compatible transcription endpoint. */
  apiEndpoint: string
  apiKeySource: ApiKeySource
}

export interface SettingsUpdate {
  engine?: TranscriptionEngine
  shortcut?: ShortcutChord
  holdDelayMs?: number
  recordingMode?: RecordingMode
  hotkeyEnabled?: boolean
  instantCapture?: boolean
  autoPaste?: boolean
  restoreClipboard?: boolean
  pasteLastShortcut?: boolean
  removeFillers?: boolean
  spokenCorrections?: boolean
  spokenFormatting?: boolean
  playSounds?: boolean
  launchAtLogin?: boolean
  theme?: Theme
  microphoneId?: string
  historyRetentionDays?: number
  model?: string
  language?: string
  vocabulary?: string
  replacements?: string
  apiEndpoint?: string
  apiKey?: string
  /**
   * Whether a supplied key may be written to disk. `session` keeps it in main
   * process memory only; it is the offer made where secure storage is unfit.
   */
  apiKeyScope?: 'persist' | 'session'
  /** Dismisses the one notice that the trial has ended. Only `true` does anything. */
  trialEndNoticeDismissed?: boolean
}

/** True when a key is available for transcription, wherever it is held. */
export function hasApiKey(settings: Pick<PublicSettings, 'apiKeySource'>): boolean {
  return settings.apiKeySource !== 'none'
}

export interface AppInfo {
  version: string
  platform: string
  /** What this operating system and session can actually do. */
  platformStatus: PlatformStatus
}

export type Page = 'history' | 'settings' | 'pro' | 'about'

/**
 * Where this PC stands with Pro, as the window may know it. Carries no key,
 * no activation id and no Polar identifier: whether purchases are set up is a
 * yes or no, worked out in the main process.
 */
export interface LicenceStatus {
  plan: Plan
  /** Whole days left in the trial, rounded up; 0 outside it. */
  trialDaysLeft: number
  trialEndsAt: string | null
  /** The licence on this PC, as the Pro page shows it. */
  licence: { displayKey: string; activatedAt: string } | null
  /** An organisation and a benefit are configured, so a key can be activated. */
  purchasesConfigured: boolean
  checkoutAvailable: boolean
  portalAvailable: boolean
  /** "US$29, once, for up to 3 PCs". */
  priceLabel: string
  /** The trial has ended and its one notice has not been dismissed. */
  trialEndNoticeDue: boolean
  /** What activation names this PC to Polar: "Murmur on Windows · 7F3A". */
  deviceLabel: string
}

/** Activating answers with the new status, or the sentence that says why not. */
export type LicenceActivation =
  | { ok: true; status: LicenceStatus }
  | { ok: false; error: string; status: LicenceStatus }

/**
 * Releasing this PC. `canRemoveLocally` is true when Polar could not be asked —
 * no connection, or a key this PC cannot read — so the Pro page can offer to
 * remove the licence here anyway, saying the device slot stays in use.
 */
export type LicenceRelease =
  | { ok: true; status: LicenceStatus }
  | { ok: false; error: string; canRemoveLocally: boolean; status: LicenceStatus }

export interface RecorderStartRequest {
  requestId: string
  microphoneId: string
}

export interface RecorderStopRequest {
  requestId: string
}

export interface RecorderCancelRequest {
  requestId: string
}

export interface RecorderStartedPayload {
  requestId: string
}

export interface RecorderAudioPayload {
  requestId: string
  audio: Uint8Array
  mimeType: string
  durationMs: number
  /**
   * False when the recorder found no speech anywhere in the take, which is
   * then dismissed without being transcribed. Only an explicit false does
   * that: a take without the flag is transcribed as it always was.
   */
  speechDetected?: boolean
}

export interface RecorderErrorPayload {
  requestId: string
  message: string
}

/**
 * How loud the microphone is right now: the peak of the last reading, 0–1,
 * rounded to two decimals. It exists only to move the overlay's meter, so the
 * main process forwards it there and nowhere else, and nothing keeps it.
 */
export interface RecorderLevelPayload {
  requestId: string
  level: number
}

/** Live chord being captured by the "Change shortcut" button. */
export interface ShortcutCapture {
  keys: number[]
  done: boolean
}

/**
 * Whether Alt + Shift + V is in force. False while the setting is off, on a
 * desktop it is not offered on, and when the system refused the registration —
 * usually because another app already owns the combination.
 */
export interface PasteLastStatus {
  pasteLastRegistered: boolean
}
