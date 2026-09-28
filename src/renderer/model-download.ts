import {
  REMOVE_WHILE_DICTATING,
  type EngineStatus,
  type ModelState
} from '../shared/engine'
import { formatMegabytes, wholeMegabytes } from '../shared/format'
import { LOCAL_MODEL_INFO } from '../shared/speech-model'
import { LANGUAGE_OPTIONS } from '../shared/types'

/**
 * The speech model's download row.
 *
 * History's first-run step and the Transcription card in Settings both show
 * it. Both are drawn by this module from one pure state, so they cannot
 * disagree about where the download stands. The main process pushes the
 * status on every change, throttled progress included, and the answer to a
 * command is applied the moment it arrives.
 */

export type ModelBadgeTone = 'ready' | 'idle' | 'busy' | 'failed'

export interface ModelRowState {
  state: ModelState
  /** "Parakeet v3 · 25 European languages". */
  name: string
  /** The whole download: "670 MB". */
  size: string
  badge: string
  badgeTone: ModelBadgeTone
  /** How far the download has got, from 0 to 1, while one runs; otherwise null. */
  progress: number | null
  /** The line under the row — progress, the check, or the failure — or null. */
  detail: string | null
  /** True when `detail` says what went wrong. */
  detailIsError: boolean
  /** The button that fetches the model, or null when there is nothing to fetch. */
  downloadLabel: string | null
  cancelVisible: boolean
  removeVisible: boolean
  removeEnabled: boolean
  /** Why a visible control cannot be used right now, or null. */
  note: string | null
}

export const CHECKING_DOWNLOAD = 'Checking the download…'
/** Only if the main process ever reports a failure without saying why. */
const DOWNLOAD_FAILED = 'The download failed. Try again.'
/** Only if a refused command ever arrives without a sentence of its own. */
const COMMAND_FAILED = 'That did not work. Try again.'

/** The model as the Settings row names it, languages counted from the manifest. */
export function modelName(): string {
  return `${LOCAL_MODEL_INFO.displayName} · ${LOCAL_MODEL_INFO.languages.length} European languages`
}

/**
 * Where the download stands, as the row shows it.
 *
 * `dictating` matters only once the model is installed: removing it has to
 * wait for the take in progress, so the button is disabled and says why
 * instead of being refused when pressed.
 */
export function modelRowState(status: EngineStatus, dictating = false): ModelRowState {
  const { model } = status
  const fraction =
    model.totalBytes > 0 ? Math.min(1, Math.max(0, model.receivedBytes / model.totalBytes)) : 0
  const common: Omit<ModelRowState, 'badge' | 'badgeTone'> = {
    state: model.state,
    name: modelName(),
    size: formatMegabytes(model.totalBytes),
    progress: null,
    detail: null,
    detailIsError: false,
    downloadLabel: null,
    cancelVisible: false,
    removeVisible: false,
    removeEnabled: false,
    note: null
  }

  switch (model.state) {
    case 'installed':
      return {
        ...common,
        badge: 'Ready',
        badgeTone: 'ready',
        removeVisible: true,
        removeEnabled: !dictating,
        note: dictating ? REMOVE_WHILE_DICTATING : null
      }
    case 'downloading':
      return {
        ...common,
        // Rounded down, like the byte count: never 100% before it is.
        badge: `Downloading · ${Math.floor(fraction * 100)}%`,
        badgeTone: 'busy',
        progress: fraction,
        detail: `${wholeMegabytes(model.receivedBytes).toLocaleString('en-GB')} of ${formatMegabytes(model.totalBytes)}`,
        cancelVisible: true
      }
    case 'verifying':
      // What is already on disk is being hashed before the rest is fetched.
      return {
        ...common,
        badge: 'Checking',
        badgeTone: 'busy',
        progress: fraction,
        detail: CHECKING_DOWNLOAD,
        cancelVisible: true
      }
    case 'failed':
      return {
        ...common,
        badge: 'Download failed',
        badgeTone: 'failed',
        detail: model.error ?? DOWNLOAD_FAILED,
        detailIsError: true,
        downloadLabel: 'Try again'
      }
    case 'partial':
      // A stopped download keeps what arrived, and the next one carries on
      // from there — which the button says, so Cancel never looks like loss.
      return { ...common, badge: 'Partly downloaded', badgeTone: 'idle', downloadLabel: 'Resume download' }
    case 'missing':
      return { ...common, badge: 'Not downloaded', badgeTone: 'idle', downloadLabel: 'Download' }
  }
}

export interface LanguageNote {
  text: string
  /** True when the on-device model cannot recognise the chosen language at all. */
  warning: boolean
}

/**
 * What the language setting means on this PC. The model picks out its own
 * languages, so the setting only steers cleanup — unless it names a language
 * the model cannot recognise, which is a warning rather than a note.
 */
export function localLanguageNote(code: string): LanguageNote {
  const { shortName, languages } = LOCAL_MODEL_INFO
  if (code === 'auto' || languages.includes(code)) {
    return {
      text: `The on-device model recognises its ${languages.length} languages by itself; this setting only tunes cleanup.`,
      warning: false
    }
  }
  const label = LANGUAGE_OPTIONS.find((option) => option.code === code)?.label ?? code.toUpperCase()
  return { text: `${shortName} does not support ${label}. Choose Cloud for ${label}.`, warning: true }
}

/**
 * The sentence a refused command carries. Electron wraps a rejected `invoke`
 * as "Error invoking remote method 'channel': Error: …", which is plumbing
 * rather than anything to show a person; the main process's own words follow.
 */
export function commandFailure(error: unknown): string {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const sentence = message
    .replace(/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/u, '')
    .trim()
  return sentence || COMMAND_FAILED
}

export interface ModelDownloadBridge {
  downloadModel(): Promise<EngineStatus>
  cancelModelDownload(): Promise<EngineStatus>
  removeModel(): Promise<EngineStatus>
}

interface CommonRowOptions {
  bridge: ModelDownloadBridge
  /** Receives the status a command answers with, so every view catches up at once. */
  onStatus(status: EngineStatus): void
}

export interface SetupRowOptions extends CommonRowOptions {
  variant: 'setup'
  title: string
  detail: string
  /** The way out: a cloud provider and the user's own key instead. */
  onChooseCloud(): void
}

export interface SettingsRowOptions extends CommonRowOptions {
  variant: 'settings'
  /** Asks before removing; `window.confirm` in the app. */
  confirm(message: string): boolean
}

export type ModelRowOptions = SetupRowOptions | SettingsRowOptions

export interface ModelRowView {
  apply(status: EngineStatus): void
  /** Removing waits for a dictation to finish, so the row follows the workflow. */
  setDictating(dictating: boolean): void
}

const PROGRESS =
  '<div class="model-progress" data-model="progress" role="progressbar" ' +
  'aria-label="Speech model download" aria-valuemin="0" aria-valuemax="100" hidden>' +
  '<div class="model-progress-bar" data-model="bar"></div></div>'

// Every part starts hidden: nothing is shown until the first status is.
const SETTINGS_TEMPLATE = `
  <div class="model-row-head">
    <div class="model-row-title"><strong data-model="name"></strong><span data-model="size"></span></div>
    <span class="configured-badge" data-model="badge"></span>
  </div>
  ${PROGRESS}
  <p class="model-row-detail" data-model="detail" aria-live="polite" hidden></p>
  <div class="model-row-actions">
    <button class="secondary-button" data-model="download" type="button" hidden></button>
    <button class="link-button" data-model="cancel" type="button" hidden>Cancel</button>
    <button class="danger-link" data-model="remove" type="button" hidden>Remove model</button>
  </div>
  <p class="capability-note" data-model="note" hidden></p>
`

const SETUP_TEMPLATE = `
  <div class="model-step-text">
    <strong data-model="title"></strong>
    <p data-model="explain"></p>
    ${PROGRESS}
    <p class="model-row-detail" data-model="detail" aria-live="polite" hidden></p>
    <p class="capability-note" data-model="note" hidden></p>
    <p class="model-step-alternative">Prefer a cloud provider? <button class="link-button" data-model="cloud" type="button">Use your own API key instead</button></p>
  </div>
  <div class="model-step-actions">
    <button class="primary-button" data-model="download" type="button" hidden></button>
    <button class="link-button" data-model="cancel" type="button" hidden>Cancel</button>
  </div>
`

const BADGE_CLASS: Record<ModelBadgeTone, string> = {
  ready: 'configured-badge is-configured',
  idle: 'configured-badge',
  busy: 'configured-badge is-busy',
  failed: 'configured-badge is-failed'
}

/**
 * Draws the row into `host` and keeps it in step with the status it is given.
 *
 * The buttons and their listeners are created once and only relabelled, so a
 * keyboard user's focus survives the several updates a second a download
 * brings.
 */
export function createModelRow(host: HTMLElement, options: ModelRowOptions): ModelRowView {
  host.innerHTML = options.variant === 'setup' ? SETUP_TEMPLATE : SETTINGS_TEMPLATE
  const part = <T extends HTMLElement = HTMLElement>(name: string): T | null =>
    host.querySelector<T>(`[data-model="${name}"]`)

  const name = part('name')
  const size = part('size')
  const badge = part('badge')
  const progress = part('progress')
  const bar = part('bar')
  const detail = part('detail')
  const note = part('note')
  const download = part<HTMLButtonElement>('download')
  const cancel = part<HTMLButtonElement>('cancel')
  const remove = part<HTMLButtonElement>('remove')

  if (options.variant === 'setup') {
    const title = part('title')
    const explain = part('explain')
    if (title) title.textContent = options.title
    if (explain) explain.textContent = options.detail
    part('cloud')?.addEventListener('click', () => options.onChooseCloud())
  }

  let status: EngineStatus | null = null
  let dictating = false
  /** A command is on its way; its buttons wait for the answer. */
  let pending = false
  /** A refused command, shown until the model's state moves on. */
  let failure: { message: string; state: ModelState } | null = null

  const paint = (): void => {
    if (!status) return
    const view = modelRowState(status, dictating)
    if (name) name.textContent = view.name
    if (size) size.textContent = view.size
    if (badge) {
      badge.textContent = view.badge
      badge.className = BADGE_CLASS[view.badgeTone]
    }
    const percent = Math.floor((view.progress ?? 0) * 100)
    if (progress) {
      progress.hidden = view.progress === null
      progress.setAttribute('aria-valuenow', String(percent))
    }
    if (bar) bar.style.width = `${percent}%`
    if (detail) {
      // A live region, so the check and a failure are read out — but not the
      // byte count, which changes several times a second; the progress bar
      // carries that for a screen reader.
      detail.setAttribute('aria-live', view.state === 'downloading' ? 'off' : 'polite')
      detail.textContent = view.detail ?? ''
      detail.hidden = view.detail === null
      detail.className = `model-row-detail${view.detailIsError ? ' is-error' : ''}`
    }
    if (download) {
      download.textContent = view.downloadLabel ?? ''
      download.hidden = view.downloadLabel === null
      download.disabled = pending
    }
    if (cancel) {
      cancel.hidden = !view.cancelVisible
      cancel.disabled = pending
    }
    if (remove) {
      remove.hidden = !view.removeVisible
      remove.disabled = !view.removeEnabled || pending
    }
    if (note) {
      // The dictation note belongs to the Remove button, so only a row that
      // has one shows it.
      const text = failure?.message ?? (remove ? view.note : null)
      note.textContent = text ?? ''
      note.hidden = text === null
    }
  }

  /**
   * Runs a command and shows its answer, or the sentence it was refused
   * with. A rejected `invoke` must never vanish: a button that does nothing
   * and says nothing cannot be told apart from a missed click.
   */
  const run = (command: () => Promise<EngineStatus>): void => {
    // The buttons are disabled while a command is out, so this is only a
    // guard against a second click landing before the repaint.
    if (pending) return
    pending = true
    failure = null
    paint()
    // Through a promise even if the command throws outright, so the buttons
    // can never be left disabled with nothing said.
    Promise.resolve()
      .then(command)
      .then(
        (next) => {
          pending = false
          view.apply(next)
          options.onStatus(next)
        },
        (error: unknown) => {
          pending = false
          failure = { message: commandFailure(error), state: status?.model.state ?? 'missing' }
          paint()
        }
      )
  }

  download?.addEventListener('click', () => run(() => options.bridge.downloadModel()))
  cancel?.addEventListener('click', () => run(() => options.bridge.cancelModelDownload()))
  if (options.variant === 'settings') {
    remove?.addEventListener('click', () => {
      const total = formatMegabytes(status?.model.totalBytes ?? 0)
      const question =
        'Remove the speech model from this PC? Dictating on this PC will need it ' +
        `downloaded again (${total}).`
      if (!options.confirm(question)) return
      run(() => options.bridge.removeModel())
    })
  }

  const view: ModelRowView = {
    apply(next) {
      // Anything that moves the model on supersedes a refused command.
      if (failure && next.model.state !== failure.state) failure = null
      status = next
      paint()
    },
    setDictating(next) {
      dictating = next
      paint()
    }
  }
  return view
}
