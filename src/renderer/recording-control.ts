import { clipboardOnlyReason, globalShortcutUsable, type PlatformStatus } from '../shared/capabilities'
import type { ApiKeySource, WorkflowStatus } from '../shared/types'

/**
 * The Record / Stop / Cancel control.
 *
 * It is rendered once and moved: a compact pill in the top bar on most pages,
 * and the large round control at the head of History. Moving the same element
 * rather than building a second one keeps a single set of listeners and makes
 * two controls disagreeing with each other impossible.
 *
 * It is the entry point that always works. A global shortcut can be missing,
 * refused or impossible depending on the desktop; a button in a window the
 * user is already looking at cannot be. Recording started here is delivered to
 * the clipboard, because the window in front is Murmur itself.
 *
 * The whole state is derived by a pure function, so every combination of
 * phase, capability and setup state is testable without a browser.
 */
export type ControlTone =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'processing'
  | 'success'
  | 'cancelled'
  | 'error'

export type ControlAction = 'start' | 'stop'

export interface RecordingControlState {
  primaryLabel: string
  primaryEnabled: boolean
  /** What clicking the primary button should do, or null when it is inert. */
  primaryAction: ControlAction | null
  cancelVisible: boolean
  phaseLabel: string
  tone: ControlTone
  /** A short explanation shown beside the control, or null when unremarkable. */
  hint: string | null
}

export interface RecordingControlInput {
  status: WorkflowStatus
  platform: PlatformStatus
  apiKeySource: ApiKeySource
}

/* Inline, so there is no icon font, no sprite and no request. */
const MIC_ICON =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">' +
  '<rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/>' +
  '<path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round"/></svg>'
const STOP_ICON =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">' +
  '<rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor"/></svg>'

const NEEDS_KEY = 'Add your API key in Settings before recording.'
const NO_SHORTCUT = 'No system-wide shortcut on this desktop — use Record.'
const CLIPBOARD_ONLY = 'Transcripts are copied here, not pasted. Settings explains why.'

export function recordingControlState(input: RecordingControlInput): RecordingControlState {
  const { phase } = input.status
  const ready = input.apiKeySource !== 'none'
  const recording = phase === 'starting' || phase === 'recording'
  const busy = recording || phase === 'processing'

  const hint = (): string | null => {
    if (!ready) return NEEDS_KEY
    if (busy) {
      // Recording from the window has no other application to paste into, so
      // say so up front rather than at the end.
      return 'This recording goes to your clipboard.'
    }
    // Short summaries only. The full reason belongs in Settings and the setup
    // guidance, where there is room for it; three lines of explanation in the
    // top bar of every page is not a limitation being explained, it is a
    // limitation being shouted.
    if (!globalShortcutUsable(input.platform.capabilities)) {
      return NO_SHORTCUT
    }
    return clipboardOnlyReason(input.platform.capabilities) === null ? null : CLIPBOARD_ONLY
  }

  if (recording) {
    return {
      primaryLabel: 'Stop',
      primaryEnabled: true,
      primaryAction: 'stop',
      cancelVisible: true,
      phaseLabel: input.status.message,
      tone: phase,
      hint: hint()
    }
  }

  if (phase === 'processing') {
    return {
      primaryLabel: 'Transcribing…',
      primaryEnabled: false,
      primaryAction: null,
      // Cancellation is the point of this button: a slow provider must never
      // leave the user with nothing to press.
      cancelVisible: true,
      phaseLabel: input.status.message,
      tone: 'processing',
      hint: hint()
    }
  }

  // "Ready" while the app is telling you it has no key reads as a
  // contradiction — mildly in a top-bar label, glaringly as the heading over
  // the record button on History.
  const idleLabel = ready ? 'Ready' : 'Not set up yet'

  return {
    primaryLabel: 'Record',
    primaryEnabled: ready,
    primaryAction: ready ? 'start' : null,
    cancelVisible: false,
    phaseLabel: phase === 'idle' ? idleLabel : input.status.message,
    tone: phase === 'idle' ? 'idle' : (phase as ControlTone),
    hint: hint()
  }
}

export interface RecordingControlBridge {
  startRecording(): Promise<void>
  stopRecording(): Promise<void>
  cancelRecording(): Promise<void>
}

export interface RecordingControlView {
  apply(input: RecordingControlInput): void
}

/**
 * Renders the control into a host element and keeps it in step.
 *
 * The buttons and their listeners are created once. Re-rendering them on every
 * status change would drop keyboard focus mid-dictation, which is exactly what
 * a person using this without a mouse is relying on.
 */
export function createRecordingControl(
  host: HTMLElement,
  bridge: RecordingControlBridge
): RecordingControlView {
  host.innerHTML = `
    <div class="record-control" role="group" aria-label="Recording">
      <button class="record-button" id="record-primary" type="button">
        <span class="record-icon" id="record-icon" aria-hidden="true"></span>
        <span class="record-label" id="record-label"></span>
      </button>
      <button class="record-cancel" id="record-cancel" type="button" title="Discard this recording">Cancel</button>
      <span class="record-phase" id="record-phase" aria-live="polite"></span>
    </div>
    <p class="record-hint" id="record-hint"></p>
  `

  const primary = host.querySelector<HTMLButtonElement>('#record-primary')
  const icon = host.querySelector<HTMLElement>('#record-icon')
  const label = host.querySelector<HTMLElement>('#record-label')
  const cancel = host.querySelector<HTMLButtonElement>('#record-cancel')
  const phase = host.querySelector<HTMLElement>('#record-phase')
  const hint = host.querySelector<HTMLElement>('#record-hint')
  let action: ControlAction | null = null
  /** A command that failed, shown until something else happens. */
  let failure: string | null = null

  const showHint = (text: string | null): void => {
    if (!hint) return
    hint.textContent = text ?? ''
    hint.hidden = text === null
  }

  /**
   * Runs a command and shows any failure.
   *
   * A rejected `invoke` used to vanish into a floating promise, which meant a
   * button that did nothing and said nothing — the worst possible outcome
   * halfway through a dictation, because there is no way to tell it apart from
   * a missed click.
   */
  const run = (command: () => Promise<void>): void => {
    void command().catch((error: unknown) => {
      failure = error instanceof Error ? error.message : 'That did not work. Try again.'
      showHint(failure)
    })
  }

  primary?.addEventListener('click', () => {
    if (action === 'start') run(() => bridge.startRecording())
    if (action === 'stop') run(() => bridge.stopRecording())
  })
  cancel?.addEventListener('click', () => {
    run(() => bridge.cancelRecording())
  })

  return {
    apply(input: RecordingControlInput): void {
      const state = recordingControlState(input)
      action = state.primaryAction
      // Anything actually happening supersedes the last failure.
      failure = null
      if (primary) {
        primary.disabled = !state.primaryEnabled
        primary.className = `record-button tone-${state.tone}`
        // The label is hidden in the round hero form, so the accessible name
        // has to come from the element itself rather than from its text.
        primary.title = state.primaryLabel
        primary.setAttribute('aria-label', state.primaryLabel)
      }
      if (icon) icon.innerHTML = state.primaryAction === 'stop' ? STOP_ICON : MIC_ICON
      if (label) label.textContent = state.primaryLabel
      if (cancel) cancel.hidden = !state.cancelVisible
      if (phase) phase.textContent = state.phaseLabel
      showHint(state.hint)
    }
  }
}
