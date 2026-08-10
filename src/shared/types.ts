import type { ShortcutChord } from './shortcuts'

export type WorkflowPhase =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'processing'
  | 'success'
  | 'error'

export interface WorkflowStatus {
  phase: WorkflowPhase
  message: string
  detail?: string
  /** Epoch ms the recording began, for the overlay's elapsed timer. */
  startedAt?: number
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
export interface PublicSettings {
  shortcut: ShortcutChord
  holdDelayMs: number
  hotkeyEnabled: boolean
  autoPaste: boolean
  removeFillers: boolean
  launchAtLogin: boolean
  microphoneId: string
  historyRetentionDays: number
  model: string
  language: string
  apiKeyConfigured: boolean
}

export interface SettingsUpdate {
  shortcut?: ShortcutChord
  holdDelayMs?: number
  hotkeyEnabled?: boolean
  autoPaste?: boolean
  removeFillers?: boolean
  launchAtLogin?: boolean
  microphoneId?: string
  historyRetentionDays?: number
  model?: string
  language?: string
  apiKey?: string
}

export interface AppInfo {
  version: string
  platform: string
}

export type Page = 'history' | 'settings' | 'about'

export interface RecorderStartRequest {
  requestId: string
  microphoneId: string
}

export interface RecorderStopRequest {
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
}

export interface RecorderErrorPayload {
  requestId: string
  message: string
}

/** Live chord being captured by the "Change shortcut" button. */
export interface ShortcutCapture {
  keys: number[]
  done: boolean
}
