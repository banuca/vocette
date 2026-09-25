import { type CapabilityMap, type SettingsPane } from '../shared/capabilities'

/**
 * First-run guidance.
 *
 * It lists only what is actually outstanding, and each item disappears the
 * moment it is satisfied — so there is nothing to dismiss, nothing to
 * remember, and no chance of the app insisting on a permission the user has
 * already granted. An empty list means there is nothing left to set up.
 */
export type SetupStepId =
  | 'transcription'
  | 'microphone'
  | 'input-monitoring'
  | 'accessibility'
  | 'secure-storage'

export type MicrophoneAccess = 'granted' | 'denied' | 'unknown'

export interface SetupAction {
  kind: 'navigate-settings' | 'open-pane'
  pane?: SettingsPane
  label: string
}

export interface SetupStep {
  id: SetupStepId
  title: string
  detail: string
  action: SetupAction | null
  /** True when dictation cannot work at all until this is resolved. */
  blocking: boolean
}

export interface SetupInput {
  /** Whether the chosen engine can transcribe: its model, or a key, is in place. */
  ready: boolean
  /** What is missing, already a sentence — the speech model, or a key. */
  notReadyReason: string | null
  capabilities: CapabilityMap
  microphone: MicrophoneAccess
}

export function setupSteps(input: SetupInput): SetupStep[] {
  const steps: SetupStep[] = []

  if (!input.ready) {
    // The reason names what is missing, so one step serves both engines
    // without guessing which of them the user chose.
    steps.push({
      id: 'transcription',
      title: 'Set up transcription',
      detail: input.notReadyReason ?? 'Transcription is not set up yet.',
      action: { kind: 'navigate-settings', label: 'Open Settings' },
      blocking: true
    })
  }

  if (input.microphone === 'denied') {
    steps.push({
      id: 'microphone',
      title: 'Allow Murmur to use your microphone',
      detail: 'Microphone access is blocked, so no audio can be recorded.',
      action: { kind: 'open-pane', pane: 'microphone', label: 'Open privacy settings' },
      blocking: true
    })
  }

  // Permission-gated capabilities are worth guiding; a capability the platform
  // simply does not have is a fact about the desktop, not a setup step.
  const listening = input.capabilities.globalHold.state === 'needs-permission'
    ? input.capabilities.globalHold
    : input.capabilities.globalToggle.state === 'needs-permission'
      ? input.capabilities.globalToggle
      : null
  if (listening?.pane) {
    steps.push({
      id: 'input-monitoring',
      title: 'Let Murmur see your shortcut',
      detail: listening.reason,
      action: { kind: 'open-pane', pane: listening.pane, label: 'Open permission settings' },
      blocking: false
    })
  }

  const paste = input.capabilities.autoPaste
  if (paste.state === 'needs-permission' && paste.pane) {
    steps.push({
      id: 'accessibility',
      title: 'Let Murmur paste for you',
      detail: paste.reason,
      action: { kind: 'open-pane', pane: paste.pane, label: 'Open permission settings' },
      blocking: false
    })
  }

  // Only worth raising while transcription is not set up: with a key already
  // in use the user has seen and answered this.
  if (input.capabilities.secureKeyStorage.state !== 'available' && !input.ready) {
    steps.push({
      id: 'secure-storage',
      title: 'Your key cannot be saved on this system',
      detail: input.capabilities.secureKeyStorage.reason,
      action: { kind: 'navigate-settings', label: 'Open Settings' },
      blocking: false
    })
  }

  return steps
}

/** True when nothing at all can be dictated until the user acts. */
export function setupIsBlocking(steps: readonly SetupStep[]): boolean {
  return steps.some((step) => step.blocking)
}
