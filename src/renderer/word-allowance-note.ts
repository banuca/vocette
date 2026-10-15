import { FREE_WORDS_NOTICE_AT } from '../shared/product'
import { allowanceCount, type WordAllowance } from '../shared/word-allowance'

/**
 * Free's month so far, as a quiet line at the head of History: nothing until
 * 8,000 words, then the count with a thin bar, and at 10,000 when dictation
 * is back. One way to Pro beside it, never a pop-up. On the trial and Pro
 * there is no line at all.
 */

export interface WordAllowanceNoteState {
  text: string
  /** How full the month is, 0–100, for the bar. */
  percent: number
  usedUp: boolean
}

/** What the line says, or null when it has nothing to say. */
export function wordAllowanceNoteState(words: WordAllowance | null): WordAllowanceNoteState | null {
  if (!words || words.used < FREE_WORDS_NOTICE_AT) return null
  const usedUp = words.used >= words.limit
  return {
    usedUp,
    percent: Math.min(100, Math.round((words.used / words.limit) * 100)),
    text: usedUp
      ? `You have used this month's ${words.limit.toLocaleString('en-GB')} free words. ` +
        `Dictation is back on ${words.resetsOn}.`
      : `${allowanceCount(words.used, words.limit)} free words this month. ` +
        `The count starts again on ${words.resetsOn}.`
  }
}

export interface WordAllowanceNoteView {
  apply(words: WordAllowance | null): void
}

export function createWordAllowanceNote(
  host: HTMLElement,
  actions: { seePro(): void }
): WordAllowanceNoteView {
  let drawn = ''
  return {
    apply(words) {
      const state = wordAllowanceNoteState(words)
      // Redrawn only when it changes, so a repaint never moves focus off the button.
      const key = state ? `${state.text}|${state.percent}` : ''
      if (key === drawn) return
      drawn = key
      if (!state) {
        host.replaceChildren()
        return
      }
      const note = document.createElement('section')
      note.className = state.usedUp ? 'allowance-note is-used-up' : 'allowance-note'
      note.setAttribute('aria-label', 'Free words this month')
      const bar = document.createElement('div')
      bar.className = 'allowance-bar'
      bar.setAttribute('role', 'progressbar')
      bar.setAttribute('aria-valuemin', '0')
      bar.setAttribute('aria-valuemax', '100')
      bar.setAttribute('aria-valuenow', String(state.percent))
      bar.setAttribute('aria-label', 'Free words used this month')
      const fill = document.createElement('i')
      fill.style.width = `${state.percent}%`
      bar.append(fill)
      const text = document.createElement('p')
      text.textContent = state.text
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'link-button'
      button.textContent = 'See Pro'
      button.addEventListener('click', () => actions.seePro())
      note.append(bar, text, button)
      host.replaceChildren(note)
    }
  }
}
