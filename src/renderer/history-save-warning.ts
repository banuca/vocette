import { icon } from './icons'
import type { HistorySaveStatus } from '../shared/types'

/**
 * The one wording for a failed history save. It says what is at risk, what the
 * user can do about it right now, and where to look — without naming a file
 * path or repeating a raw storage error.
 */
export const HISTORY_SAVE_WARNING =
  'History could not be saved. Recent entries may be lost when you quit. ' +
  'Copy any text you need and check disk space or folder permissions.'

export interface HistorySaveWarningView {
  apply(status: HistorySaveStatus): void
}

/**
 * A persistent, non-modal banner above the page content. It lives in the shell
 * rather than a page, so switching pages cannot hide it and nothing about it
 * interrupts a dictation: no dialog, no focus change, no dismiss button that
 * would let a real risk be waved away while it still applies.
 */
export function createHistorySaveWarning(host: HTMLElement): HistorySaveWarningView {
  let showing: boolean | null = null
  return {
    apply(status: HistorySaveStatus): void {
      // Re-rendering identical state would restart the assistive-technology
      // announcement every time an unrelated write completes.
      if (showing === status.saveFailed) return
      showing = status.saveFailed
      host.innerHTML = status.saveFailed
        ? `<div class="save-warning" role="alert"><span class="save-warning-mark">${icon('alert', 15)}</span><p>${HISTORY_SAVE_WARNING}</p></div>`
        : ''
    }
  }
}

export interface HistorySaveStatusBridge {
  getHistorySaveStatus(): Promise<HistorySaveStatus>
  onHistorySaveStatus(callback: (status: HistorySaveStatus) => void): () => void
}

export interface HistorySaveStatusTracker {
  readonly status: HistorySaveStatus
  /** Attaches the banner once the shell exists, showing the current status. */
  attach(view: HistorySaveWarningView): void
}

/**
 * Subscribes before it asks, so a failure raised while this window was loading
 * cannot slip between the two. A pushed status is always newer than whatever
 * the initial read returns, so it wins even if the read answers afterwards.
 *
 * The read is deliberately not awaited by the caller: a status that cannot be
 * fetched must never stop the window from opening.
 */
export function trackHistorySaveStatus(bridge: HistorySaveStatusBridge): HistorySaveStatusTracker {
  let current: HistorySaveStatus = { saveFailed: false }
  let pushed = false
  let view: HistorySaveWarningView | null = null
  const apply = (): void => view?.apply(current)

  bridge.onHistorySaveStatus((status) => {
    pushed = true
    current = status
    apply()
  })
  void bridge
    .getHistorySaveStatus()
    .then((status) => {
      if (pushed) return
      current = status
      apply()
    })
    .catch(() => undefined)

  return {
    get status(): HistorySaveStatus {
      return current
    },
    attach(next: HistorySaveWarningView): void {
      view = next
      apply()
    }
  }
}
