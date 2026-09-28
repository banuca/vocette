import { TRIAL_END_NOTICE } from './licence-text'

/**
 * The one reminder Murmur ever gives about Pro: a card at the head of History
 * once the trial has ended, saying that nothing the user relies on changes.
 * It has two buttons — See Pro and Dismiss — and once dismissed it is gone
 * for good. There is no countdown before it and nothing after it.
 */

export interface TrialEndNoticeActions {
  seePro(): void
  dismiss(): void
}

export interface TrialEndNoticeView {
  /** Shows the card while the notice is due, and nothing otherwise. */
  apply(due: boolean): void
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = className
  element.textContent = label
  element.addEventListener('click', onClick)
  return element
}

export function createTrialEndNotice(
  host: HTMLElement,
  actions: TrialEndNoticeActions
): TrialEndNoticeView {
  let shown: boolean | null = null
  return {
    apply(due: boolean): void {
      // Drawn once per change, so a repaint of History does not move focus
      // off the buttons or read the card out again.
      if (shown === due) return
      shown = due
      if (!due) {
        host.replaceChildren()
        return
      }
      const card = document.createElement('section')
      card.className = 'trial-end-notice'
      card.setAttribute('aria-label', 'Pro trial')
      const text = document.createElement('p')
      text.textContent = TRIAL_END_NOTICE
      const buttons = document.createElement('div')
      buttons.className = 'trial-end-actions'
      buttons.append(
        button('See Pro', 'secondary-button', () => actions.seePro()),
        button('Dismiss', 'link-button', () => actions.dismiss())
      )
      card.append(text, buttons)
      host.replaceChildren(card)
    }
  }
}
