import type { AppContext } from '../app-context'
import { commandFailure } from '../model-download'
import {
  FREE_FOREVER,
  PRO_ADDS,
  activationNote,
  activeLicenceLine,
  buyLabel,
  planStatusLine
} from '../licence-text'
import { TRIAL_DAYS } from '../../shared/product'
import type { LicenceStatus } from '../../shared/types'

/**
 * The Pro page: where this PC stands, what Pro adds and what stays free, the
 * way to buy it, and the licence key.
 *
 * Nothing here is sent anywhere until the user presses Activate or Release
 * this PC, and each of those is one request, made by the main process. The
 * key typed here goes to the main process once and never comes back; the page
 * shows only Polar's masked form of it.
 */

export interface ProView {
  apply(next: LicenceStatus): void
  dispose(): void
}

const RELEASE_QUESTION =
  'Release this PC? Pro stops here, and one of your key’s device slots is freed for ' +
  'another PC. You can activate this PC again later with the same key.'

const REMOVE_LOCAL_QUESTION =
  'Remove Pro from this PC without releasing it? Polar will still count this PC as one of ' +
  'your devices until you release it from your purchase email.'

/** Said beside "Remove from this PC anyway", before it is pressed. */
const REMOVE_LOCAL_NOTE =
  'You can still remove Pro from this PC alone. The device slot stays in use until you ' +
  'release it from your purchase email.'

type Tone = 'muted' | 'good' | 'error'

export function renderPro(context: AppContext): ProView {
  context.setHeading('Pro', 'For people who dictate all day. Everything else stays free, for good.')

  context.content.innerHTML = `
    <div class="settings-stack pro-page">
      <section class="settings-card">
        <div class="settings-heading">
          <div><h2 id="pro-status"></h2><p id="pro-status-detail"></p></div>
        </div>
        <div class="pro-plans">
          <div class="pro-plan"><h3>What stays free, forever</h3><ul id="free-forever"></ul></div>
          <div class="pro-plan is-pro"><h3>What Pro adds</h3><ul id="pro-adds"></ul></div>
        </div>
        <div class="pro-buy" id="pro-buy">
          <button class="primary-button" id="buy-pro" type="button"></button>
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-heading">
          <div><h2>Licence key</h2><p id="licence-summary"></p></div>
        </div>
        <div id="licence-entry">
          <label class="field field-wide"><span>Licence key</span>
            <div class="password-row">
              <input id="licence-key" type="text" autocomplete="off" spellcheck="false" placeholder="MURMUR-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" aria-describedby="licence-note" />
              <button class="secondary-button" id="activate-licence" type="button">Activate</button>
            </div>
          </label>
          <small class="field-note" id="licence-note"></small>
        </div>
        <div id="licence-active" hidden>
          <p class="licence-active-line" id="licence-active-line"></p>
          <div class="key-actions">
            <button class="danger-link" id="release-licence" type="button">Release this PC</button>
            <button class="link-button" id="manage-purchase" type="button">Manage your purchase</button>
          </div>
          <div class="licence-remove-local" id="remove-local-row" hidden>
            <p class="capability-note" id="remove-local-note"></p>
            <button class="danger-link" id="remove-local" type="button">Remove from this PC anyway</button>
          </div>
        </div>
        <p class="licence-feedback" id="licence-feedback" aria-live="polite" hidden></p>
      </section>
    </div>
  `

  const query = <T extends HTMLElement>(selector: string): T | null =>
    context.content.querySelector<T>(selector)

  const statusHeading = query<HTMLElement>('#pro-status')
  const statusDetail = query<HTMLElement>('#pro-status-detail')
  const buyButton = query<HTMLButtonElement>('#buy-pro')
  const summary = query<HTMLElement>('#licence-summary')
  const entry = query<HTMLElement>('#licence-entry')
  const keyInput = query<HTMLInputElement>('#licence-key')
  const activateButton = query<HTMLButtonElement>('#activate-licence')
  const keyNote = query<HTMLElement>('#licence-note')
  const active = query<HTMLElement>('#licence-active')
  const activeLine = query<HTMLElement>('#licence-active-line')
  const releaseButton = query<HTMLButtonElement>('#release-licence')
  const manageButton = query<HTMLButtonElement>('#manage-purchase')
  const removeRow = query<HTMLElement>('#remove-local-row')
  const removeNote = query<HTMLElement>('#remove-local-note')
  const removeButton = query<HTMLButtonElement>('#remove-local')
  const feedback = query<HTMLElement>('#licence-feedback')

  // textContent throughout: the price and the masked key come from outside
  // this file, and none of it is markup.
  const fillList = (selector: string, items: readonly string[]): void => {
    query<HTMLElement>(selector)?.replaceChildren(
      ...items.map((line) => {
        const item = document.createElement('li')
        item.textContent = line
        return item
      })
    )
  }
  fillList('#pro-adds', PRO_ADDS)
  fillList('#free-forever', FREE_FOREVER)

  let status = context.licence
  /** A request to Polar is on its way; its buttons wait for the answer. */
  let pending = false
  /** Release could not reach Polar, so removing Pro here alone is on offer. */
  let offerRemoveLocal = false

  const say = (text: string, tone: Tone = 'muted'): void => {
    if (!feedback) return
    feedback.textContent = text
    feedback.hidden = text === ''
    feedback.className = `licence-feedback tone-${tone}`
  }

  const paint = (): void => {
    if (statusHeading) statusHeading.textContent = planStatusLine(status)
    if (statusDetail) {
      statusDetail.textContent =
        status.plan === 'free'
          ? 'Dictation, cleanup, your words and history keep working, for good. Pro is for power users.'
          : status.plan === 'trial'
            ? `Everyone gets Pro for the first ${TRIAL_DAYS} days. After that, Free keeps everything ` +
              'you rely on, and nothing you have written is ever deleted.'
            : 'Every Pro feature is on for this PC.'
    }

    const licensed = status.licence !== null
    // Nothing to buy for someone who has.
    const buyRow = query<HTMLElement>('#pro-buy')
    if (buyRow) buyRow.hidden = licensed
    if (buyButton) {
      buyButton.textContent = buyLabel(status)
      buyButton.disabled = !status.checkoutAvailable
    }

    if (summary) {
      summary.textContent = licensed
        ? 'Activated once, and never checked again.'
        : 'Bought Pro? Paste the key from your purchase confirmation.'
    }
    if (entry) entry.hidden = licensed
    if (keyInput) keyInput.disabled = pending || !status.purchasesConfigured
    if (activateButton) activateButton.disabled = pending || !status.purchasesConfigured
    if (keyNote) {
      keyNote.textContent = status.purchasesConfigured
        ? activationNote(status)
        : 'Licence keys can be activated once Pro purchases open.'
    }

    if (active) active.hidden = !licensed
    if (activeLine && status.licence) activeLine.textContent = activeLicenceLine(status.licence)
    if (releaseButton) releaseButton.disabled = pending
    if (manageButton) manageButton.hidden = !status.portalAvailable
    const removeOffered = licensed && offerRemoveLocal
    if (removeRow) removeRow.hidden = !removeOffered
    if (removeNote) removeNote.textContent = removeOffered ? REMOVE_LOCAL_NOTE : ''
    if (removeButton) removeButton.disabled = pending
  }

  /** Every answer carries the status as it now stands, so the whole window catches up. */
  const adopt = (next: LicenceStatus): void => {
    status = next
    if (!next.licence) offerRemoveLocal = false
    context.applyLicence(next)
    paint()
  }

  const activate = async (): Promise<void> => {
    if (pending || !keyInput) return
    const key = keyInput.value
    pending = true
    offerRemoveLocal = false
    say('Activating…')
    paint()
    try {
      const result = await window.murmur.activateLicence(key)
      pending = false
      if (result.ok) {
        keyInput.value = ''
        say('Pro is active on this PC. Thank you for supporting Murmur.', 'good')
      } else {
        say(result.error, 'error')
      }
      adopt(result.status)
    } catch (error) {
      pending = false
      say(commandFailure(error), 'error')
      paint()
    }
  }

  activateButton?.addEventListener('click', () => void activate())
  keyInput?.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') void activate()
  })

  releaseButton?.addEventListener('click', async () => {
    if (pending || !window.confirm(RELEASE_QUESTION)) return
    pending = true
    say('Releasing this PC…')
    paint()
    try {
      const result = await window.murmur.releaseLicence()
      pending = false
      if (result.ok) {
        say('This PC was released. Its device slot is free for another PC.', 'good')
      } else {
        offerRemoveLocal = result.canRemoveLocally
        say(result.error, 'error')
      }
      adopt(result.status)
    } catch (error) {
      pending = false
      say(commandFailure(error), 'error')
      paint()
    }
  })

  removeButton?.addEventListener('click', async () => {
    if (pending || !window.confirm(REMOVE_LOCAL_QUESTION)) return
    pending = true
    paint()
    try {
      const next = await window.murmur.removeLicenceLocally()
      pending = false
      offerRemoveLocal = false
      say(
        'Pro was removed from this PC. Its device slot stays in use until you release it from your purchase email.'
      )
      adopt(next)
    } catch (error) {
      pending = false
      say(commandFailure(error), 'error')
      paint()
    }
  })

  buyButton?.addEventListener('click', () => {
    if (status.checkoutAvailable) void window.murmur.openExternal('checkout')
  })
  manageButton?.addEventListener('click', () => {
    if (status.portalAvailable) void window.murmur.openExternal('customer-portal')
  })

  paint()

  return {
    apply: (next) => {
      status = next
      if (!next.licence) offerRemoveLocal = false
      paint()
    },
    dispose: () => {
      // Nothing to release: the page holds no subscription of its own. A
      // request still on its way lands in the shell through `applyLicence`.
    }
  }
}
