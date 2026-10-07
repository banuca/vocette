import { type CapabilityMap, type SettingsPane } from '../shared/capabilities'
import type { EngineStatus } from '../shared/engine'
import { formatMegabytes } from '../shared/format'

/**
 * First-run guidance.
 *
 * It lists only what is actually outstanding, and each item disappears the
 * moment it is satisfied — so there is nothing to dismiss, nothing to
 * remember, and no chance of the app insisting on a permission the user has
 * already granted. An empty list means there is nothing left to set up.
 */
export type SetupStepId =
  | 'model'
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
  /**
   * The button beside the step, or null. The model step has none of its own:
   * it carries the download itself, drawn by `model-download`.
   */
  action: SetupAction | null
  /** True when dictation cannot work at all until this is resolved. */
  blocking: boolean
}

export interface SetupInput {
  /** The chosen engine, whether it can transcribe, and where the speech model stands. */
  engine: EngineStatus
  capabilities: CapabilityMap
  microphone: MicrophoneAccess
}

export function setupSteps(input: SetupInput): SetupStep[] {
  const steps: SetupStep[] = []
  const { engine } = input

  if (engine.engine === 'local' && engine.model.state !== 'installed') {
    // The on-device engine needs nothing but its model, so the step is the
    // download itself — with its progress, Cancel and Try again — rather
    // than a pointer to somewhere else to go and do it.
    steps.push({
      id: 'model',
      title: 'Download the speech model',
      detail:
        'Vocette transcribes on this PC, so your voice never leaves it. The model is ' +
        `${formatMegabytes(engine.model.totalBytes)} and downloads once.`,
      action: null,
      blocking: true
    })
  } else if (!engine.ready) {
    // A cloud user with no key and no endpoint of their own: OpenAI always
    // needs a key, while a server of the user's own may need none, so an
    // endpoint alone makes the cloud ready. The reason names what is missing,
    // so the step never guesses.
    steps.push({
      id: 'transcription',
      title: 'Set up transcription',
      detail: engine.notReadyReason ?? 'Transcription is not set up yet.',
      action: { kind: 'navigate-settings', label: 'Open Settings' },
      blocking: true
    })
  }

  if (input.microphone === 'denied') {
    steps.push({
      id: 'microphone',
      title: 'Allow Vocette to use your microphone',
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
      title: 'Let Vocette see your shortcut',
      detail: listening.reason,
      action: { kind: 'open-pane', pane: listening.pane, label: 'Open permission settings' },
      blocking: false
    })
  }

  const paste = input.capabilities.autoPaste
  if (paste.state === 'needs-permission' && paste.pane) {
    steps.push({
      id: 'accessibility',
      title: 'Let Vocette paste for you',
      detail: paste.reason,
      action: { kind: 'open-pane', pane: paste.pane, label: 'Open permission settings' },
      blocking: false
    })
  }

  // Only a cloud key needs storing, and only while the cloud cannot dictate:
  // with a key in use the user has seen and answered this, and a server of
  // their own that may need no key leaves nothing to store. The on-device
  // engine has no key at all, so this would be noise there.
  if (
    engine.engine === 'cloud' &&
    input.capabilities.secureKeyStorage.state !== 'available' &&
    !engine.ready
  ) {
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

/**
 * The card's heading. Until transcription works at all the user is getting
 * started; a permission left over afterwards is only finishing off.
 */
export function setupHeading(steps: readonly SetupStep[]): string {
  return steps.some((step) => step.id === 'model' || step.id === 'transcription')
    ? 'Get started'
    : 'Finish setting up Vocette'
}
