/**
 * What the operating system will and will not let Vocette do.
 *
 * This crosses the IPC bridge, so it is deliberately plain data: a state, a
 * sentence a person can act on, and — when one exists — the settings pane that
 * would fix it. No handles, paths, native error text or process details.
 *
 * Capability is kept separate from preference throughout. A capability that is
 * missing right now (a Wayland session, a revoked macOS permission) must never
 * overwrite what the user asked for, or their choice would silently disappear
 * the moment they came back to a session that supports it.
 */

export const CAPABILITY_IDS = [
  'globalHold',
  'globalToggle',
  'targetVerification',
  'autoPaste',
  'launchAtLogin',
  'secureKeyStorage'
] as const

export type CapabilityId = (typeof CAPABILITY_IDS)[number]

export type CapabilityState = 'available' | 'unavailable' | 'needs-permission'

/** An OS settings page the user can be sent to. */
export type SettingsPane = 'accessibility' | 'input-monitoring' | 'microphone'

export interface Capability {
  state: CapabilityState
  /** One sentence explaining the limitation. Empty when available. */
  reason: string
  /** Settings pane that would resolve it, when the OS offers one. */
  pane: SettingsPane | null
}

export type CapabilityMap = Record<CapabilityId, Capability>

export type PlatformId = 'windows' | 'macos' | 'linux' | 'unknown'

/** Only meaningful on Linux; null elsewhere. */
export type LinuxSession = 'x11' | 'wayland' | 'unknown'

export type RecordingMode = 'hold' | 'toggle'

export const RECORDING_MODES: readonly RecordingMode[] = ['hold', 'toggle']

/** Everything the renderer needs to describe the platform honestly. */
export interface PlatformStatus {
  platform: PlatformId
  session: LinuxSession | null
  /** Label of the paste chord this platform injects, e.g. "Ctrl + V". */
  pasteLabel: string
  /** Modifier word used in shortcut labels, e.g. "Ctrl" or "Command". */
  primaryModifierLabel: string
  capabilities: CapabilityMap
}

export function available(): Capability {
  return { state: 'available', reason: '', pane: null }
}

export function unavailable(reason: string, pane: SettingsPane | null = null): Capability {
  return { state: 'unavailable', reason, pane }
}

export function needsPermission(reason: string, pane: SettingsPane): Capability {
  return { state: 'needs-permission', reason, pane }
}

export function isAvailable(capability: Capability | undefined): boolean {
  return capability?.state === 'available'
}

/**
 * The mode actually in force. The stored preference is returned untouched
 * whenever the platform can honour it; only a genuinely unavailable hold
 * capability downgrades it, and only for as long as that lasts.
 */
export function effectiveRecordingMode(
  preference: RecordingMode,
  capabilities: CapabilityMap
): RecordingMode {
  if (preference === 'hold' && !isAvailable(capabilities.globalHold)) return 'toggle'
  return preference
}

/** True when the stored preference cannot be honoured on this system right now. */
export function recordingModeIsForced(
  preference: RecordingMode,
  capabilities: CapabilityMap
): boolean {
  return effectiveRecordingMode(preference, capabilities) !== preference
}

/** Whether any global shortcut at all can start a dictation. */
export function globalShortcutUsable(capabilities: CapabilityMap): boolean {
  return isAvailable(capabilities.globalHold) || isAvailable(capabilities.globalToggle)
}

/**
 * Whether automatic paste can be offered at all.
 *
 * Both halves are required, and neither is negotiable: without target
 * verification the app cannot tell where a paste would land, and pasting
 * blind is exactly the failure this check exists to prevent.
 */
export function autoPasteSupported(capabilities: CapabilityMap): boolean {
  return isAvailable(capabilities.autoPaste) && isAvailable(capabilities.targetVerification)
}

/**
 * Why delivery is clipboard-only, or null when automatic paste is on offer.
 * Target verification is reported first: it is the reason that also explains
 * why nothing will be typed into the focused window.
 */
export function clipboardOnlyReason(capabilities: CapabilityMap): string | null {
  if (autoPasteSupported(capabilities)) return null
  if (!isAvailable(capabilities.targetVerification)) {
    return capabilities.targetVerification.reason || 'The paste target cannot be verified here.'
  }
  return capabilities.autoPaste.reason || 'Automatic paste is not available here.'
}
