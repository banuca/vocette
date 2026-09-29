import { icon } from '../icons'
import type { AppContext } from '../app-context'
import { escapeHtml } from '../dom'
import { LOCAL_MODEL_INFO } from '../../shared/speech-model'
import type { TranscriptionEngine } from '../../shared/types'
import { updateResultText, type UpdateStatus } from '../../shared/update'

/** Names the platform, and the display server where that changes what works. */
function platformName(context: AppContext): string {
  const names: Record<string, string> = {
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux',
    unknown: 'Unsupported system'
  }
  const base = names[context.platform.platform] ?? 'Unknown'
  const session = context.platform.session
  return context.platform.platform === 'linux' && session && session !== 'unknown'
    ? `${base} · ${session === 'wayland' ? 'Wayland' : 'X11'}`
    : base
}

/**
 * The credits Vocette owes: the model's licence asks for its line, word for
 * word from the manifest; the libraries that run it are named with theirs;
 * and SCOWL's permission notice asks for its copyright to be shown.
 */
export function attributions(): string[] {
  return [
    LOCAL_MODEL_INFO.attribution,
    'sherpa-onnx — Apache-2.0',
    'ONNX Runtime — MIT',
    'Word list: SCOWL, © Kevin Atkinson'
  ]
}

const INDEPENDENT =
  'Vocette is an independent MIT-licensed project with no affiliation to any commercial ' +
  'dictation product.'

/** Pro's one request, said wherever the notice says what leaves this computer. */
export const PRO_ACTIVATION_NOTICE =
  'Activating Pro sends your licence key and a device label to Polar, the payment provider, ' +
  'once, when you press Activate.'

/** The update check's one request, said with the others. */
export const UPDATE_CHECK_NOTICE =
  'Checking for updates, which you switch on below or ask for with Check now, asks GitHub ' +
  'for the latest version number and sends nothing about you.'

/** Said with the rest whenever AI polish is on: the one time text leaves for a model. */
export const POLISH_NOTICE =
  'With AI polish on, the text of each dictation (never the audio) is sent to the polish ' +
  'provider you chose in Settings.'

/** Under the switch, where it is turned on. */
export const UPDATE_CHECK_EXPLANATION =
  'Sends one request to GitHub (api.github.com) asking for the latest Vocette version. ' +
  'Nothing about you or your dictation is sent. Vocette never downloads or installs anything ' +
  'by itself.'

/**
 * What leaves this computer, for the engine actually in use. Telling an
 * on-device user that their audio goes to "the provider you configure" would
 * be as wrong as telling a cloud user that it stays here.
 */
export function privacyNotice(engine: TranscriptionEngine, polish = false): string {
  const polishing = polish ? ` ${POLISH_NOTICE}` : ''
  if (engine === 'local') {
    return (
      `${INDEPENDENT} Your audio is transcribed on this PC and never leaves it, and ` +
      'neither does the vocabulary you set in Settings. The only thing Vocette downloads is ' +
      `the speech model, once, from Hugging Face.${polishing} ${PRO_ACTIVATION_NOTICE} ` +
      UPDATE_CHECK_NOTICE
    )
  }
  return (
    `${INDEPENDENT} It sends your audio — and the vocabulary you set in Settings, which is ` +
    'what makes those words come back spelled correctly — only to the transcription provider ' +
    `you configure, using your own API key.${polishing} ${PRO_ACTIVATION_NOTICE} ` +
    `${UPDATE_CHECK_NOTICE} Nothing else leaves this computer.`
  )
}

/** The About page, kept up to date while it is open. */
export interface AboutView {
  applyUpdate(status: UpdateStatus): void
}

export function renderAbout(context: AppContext): AboutView {
  context.setHeading('About', 'A small, inspectable voice tool built for people—not subscriptions.')
  const { engine } = context.settings

  context.content.innerHTML = `
    <div class="about-hero">
      <div class="large-brand-mark" aria-hidden="true"><span></span></div>
      <h2>Vocette</h2>
      <p>Open-source push-to-talk dictation for Windows, macOS and Linux.</p>
      <span class="version-badge">Version ${escapeHtml(context.appInfo.version)}</span>
      <span class="version-badge">${escapeHtml(platformName(context))}</span>
    </div>
    <div class="about-grid">
      <section class="about-card"><div class="about-icon">${icon('keyboard', 18)}</div><h3>Simple by design</h3><p>Hold or press your shortcut, speak, then finish. The transcript is copied, pasted where that is safe, and saved locally.</p></section>
      <section class="about-card"><div class="about-icon">${icon('home', 18)}</div><h3>Local history</h3><p>Your history remains on this computer. Audio is held in memory only long enough to transcribe it.</p></section>
      <section class="about-card"><div class="about-icon">${icon('lock', 18)}</div><h3>Private by default</h3><p>Transcription runs on this PC. A cloud provider is optional and uses your own key.</p></section>
    </div>
    <section class="notice-card">
      <h3>Independent open-source project</h3>
      <p id="privacy-notice"></p>
      ${
        // A provider's API documentation only concerns someone using one.
        engine === 'cloud'
          ? '<button class="secondary-button" id="open-transcription-docs" type="button">Read the transcription API documentation</button>'
          : ''
      }
    </section>
    <section class="notice-card updates-card" aria-labelledby="updates-heading">
      <h3 id="updates-heading">Updates</h3>
      <label class="toggle-row" id="row-update-check"><div><strong>Check for updates once a day</strong><span id="update-check-explanation"></span></div><input id="update-check" type="checkbox" /><i></i></label>
      <div class="update-actions">
        <button class="secondary-button" id="check-updates" type="button">Check now</button>
        <p class="update-result" id="update-result" aria-live="polite"></p>
        <button class="link-button" id="open-release" type="button" hidden>Download</button>
      </div>
    </section>
    <section class="notice-card attributions-card">
      <h3>Attributions</h3>
      <ul class="attribution-list" id="attributions"></ul>
    </section>
  `

  const notice = context.content.querySelector<HTMLElement>('#privacy-notice')
  // Polish counts only where it can run: switched on, with Pro.
  const polishing = context.settings.polish?.enabled === true && context.licence.plan !== 'free'
  if (notice) notice.textContent = privacyNotice(engine, polishing)

  // textContent: the model's attribution comes from its manifest, and no text
  // on this page is parsed as markup.
  const list = context.content.querySelector<HTMLElement>('#attributions')
  list?.replaceChildren(
    ...attributions().map((line) => {
      const item = document.createElement('li')
      item.textContent = line
      return item
    })
  )

  context.content.querySelector('#open-transcription-docs')?.addEventListener('click', () => {
    void window.murmur.openExternal('transcription-docs')
  })

  const explanation = context.content.querySelector<HTMLElement>('#update-check-explanation')
  if (explanation) explanation.textContent = UPDATE_CHECK_EXPLANATION
  const toggle = context.content.querySelector<HTMLInputElement>('#update-check')
  const checkNow = context.content.querySelector<HTMLButtonElement>('#check-updates')
  const result = context.content.querySelector<HTMLElement>('#update-result')
  const download = context.content.querySelector<HTMLButtonElement>('#open-release')

  const applyUpdate = (status: UpdateStatus): void => {
    if (toggle) toggle.checked = status.enabled
    if (checkNow) checkNow.disabled = status.state === 'checking'
    if (result) {
      result.textContent = updateResultText(status)
      result.classList.toggle('is-error', status.state === 'error')
    }
    if (download) download.hidden = status.state !== 'available'
  }

  toggle?.addEventListener('change', () => {
    const enabled = toggle.checked
    void window.murmur
      .setUpdateCheck(enabled)
      .then(applyUpdate)
      .catch(() => {
        // The store refused; show what is really saved.
        toggle.checked = !enabled
      })
  })
  checkNow?.addEventListener('click', () => {
    void window.murmur
      .checkForUpdates()
      .then(applyUpdate)
      .catch(() => undefined)
  })
  download?.addEventListener('click', () => {
    void window.murmur.openExternal('release')
  })

  // Drawn as "not checked yet" until the main process answers.
  void window.murmur
    .getUpdateStatus()
    .then(applyUpdate)
    .catch(() => undefined)

  return { applyUpdate }
}
