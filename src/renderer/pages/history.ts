import type { AppContext } from '../app-context'
import { icon } from '../icons'
import { escapeHtml, formatDate, formatDuration, friendlyError, wordCount } from '../dom'
import { createModelRow, type ModelRowView } from '../model-download'
import { setupHeading, setupSteps, type SetupStep } from '../setup-guide'
import { createTrialEndNotice } from '../trial-end-notice'
import { effectiveRecordingMode, globalShortcutUsable } from '../../shared/capabilities'
import type { EngineStatus } from '../../shared/engine'
import { chordLabel } from '../../shared/keycodes'
import type { HistoryEntry, LicenceStatus } from '../../shared/types'

/** Initial render cap; "Show more" reveals the rest in steps. */
const PAGE_SIZE = 200

/** Simple English day buckets; the full timestamp still appears per entry. */
function dayLabel(createdAt: string): string {
  const date = new Date(createdAt)
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const daysAgo = Math.round((startOfToday - startOfDay) / 86_400_000)
  if (daysAgo <= 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric'
  }).format(date)
}

export interface HistoryView {
  refresh(): void
  /** Download progress: only the model step changes, so only it is repainted. */
  applyEngine(status: EngineStatus): void
  /** Only the trial's end notice depends on the plan, so only it is repainted. */
  applyLicence(status: LicenceStatus): void
}

/**
 * The history page renders its shell once and then patches only the list and
 * the metric values. Rebuilding the whole page on every `history:changed`
 * destroyed focus and the caret in the search box mid-typing.
 */
export function renderHistory(context: AppContext): HistoryView {
  context.setHeading('History', 'Everything you have dictated, stored on this PC.')

  let searchQuery = ''
  let visibleCount = PAGE_SIZE

  context.content.innerHTML = `
    <section class="hero" aria-label="Recording">
      <div id="hero-record"></div>
      <p class="hero-hint" id="hero-hint"></p>
    </section>
    <div id="trial-end-notice"></div>
    <div id="setup-guide"></div>
    <section class="metrics" aria-label="Dictation totals">
      <div class="metric-card"><span>Dictations</span><strong id="metric-count">0</strong></div>
      <div class="metric-card"><span>Words captured</span><strong id="metric-words">0</strong></div>
      <div class="metric-card"><span>Est. time saved</span><strong id="metric-saved">0 min</strong></div>
      <div class="metric-card"><span>Last 30 days</span><strong id="metric-month">0</strong></div>
    </section>
    <section class="history-section">
      <div class="section-toolbar">
        <div class="search-box">${icon('search', 14)}<input id="history-search" type="search" placeholder="Search your dictations" aria-label="Search your dictations" /></div>
        <span class="result-count" id="history-result-count"></span>
        <span class="toolbar-spacer"></span>
        <button class="text-button" id="export-txt" type="button">Export .txt</button>
        <button class="text-button" id="export-json" type="button">Export .json</button>
      </div>
      <div class="history-list" id="history-list"></div>
    </section>
  `

  /**
   * How to make a first recording *on this system*. Telling a Wayland user to
   * hold a shortcut that cannot exist there is worse than saying nothing.
   */
  const firstDictationHint = (): string => {
    const map = context.platform.capabilities
    if (!globalShortcutUsable(map)) return 'Press Record above, speak, then press Stop.'
    const chord = chordLabel(context.settings.shortcut.keys)
    return effectiveRecordingMode(context.settings.recordingMode, map) === 'toggle'
      ? `Press ${chord}, speak, then press it again.`
      : `Hold ${chord}, speak, and release it.`
  }

  const heroHint = context.content.querySelector<HTMLElement>('#hero-hint')

  /** The hero's one line of guidance, in the terms this desktop can honour. */
  const updateHeroHint = (): void => {
    if (heroHint) heroHint.textContent = firstDictationHint()
  }

  const noticeHost = context.content.querySelector<HTMLDivElement>('#trial-end-notice')
  const trialEndNotice = noticeHost
    ? createTrialEndNotice(noticeHost, {
        seePro: () => context.navigate('pro'),
        dismiss: () => {
          // Gone at once, and for good once saved. If saving fails it comes
          // back, rather than vanishing for this session only.
          context.applyLicence({ ...context.licence, trialEndNoticeDue: false })
          void window.murmur.saveSettings({ trialEndNoticeDismissed: true }).catch(() => {
            context.applyLicence({ ...context.licence, trialEndNoticeDue: true })
          })
        }
      })
    : null

  const setupHost = context.content.querySelector<HTMLDivElement>('#setup-guide')
  /** The model step's row while there is one, so progress repaints only it. */
  let modelStep: ModelRowView | null = null

  /**
   * First-run guidance, rendered from whatever is genuinely outstanding. Each
   * item disappears as soon as it is satisfied, so there is nothing to dismiss
   * and no chance of nagging about a permission already granted.
   */
  const renderSetup = (): void => {
    if (!setupHost) return
    modelStep = null
    const steps = setupSteps({
      engine: context.engine,
      capabilities: context.platform.capabilities,
      microphone: context.microphone
    })
    if (!steps.length) {
      setupHost.replaceChildren()
      return
    }

    const card = document.createElement('section')
    card.className = 'setup-card'
    const heading = document.createElement('h2')
    heading.textContent = setupHeading(steps)
    card.append(heading)

    const stepButton = (step: SetupStep): HTMLButtonElement | null => {
      if (!step.action) return null
      const button = document.createElement('button')
      button.className = 'secondary-button'
      button.type = 'button'
      button.textContent = step.action.label
      const action = step.action
      button.addEventListener('click', () => {
        if (action.kind === 'navigate-settings') context.navigate('settings')
        else if (action.pane) void window.murmur.openPlatformSettings(action.pane)
      })
      return button
    }

    for (const step of steps) {
      const row = document.createElement('div')
      row.className = `setup-step${step.blocking ? ' is-blocking' : ''}`
      if (step.id === 'model') {
        // The download runs on the step itself, drawn by the same module as
        // the Settings row so the two can never disagree.
        row.classList.add('model-step')
        modelStep = createModelRow(row, {
          variant: 'setup',
          title: step.title,
          detail: step.detail,
          bridge: window.murmur,
          onStatus: (status) => context.applyEngine(status),
          // Chosen, not saved: Settings shows the key fields, and Save
          // settings is what switches.
          onChooseCloud: () => context.navigate('settings', { engine: 'cloud' })
        })
        modelStep.apply(context.engine)
        card.append(row)
        continue
      }
      row.innerHTML =
        `<div><strong>${escapeHtml(step.title)}</strong>` +
        `<p>${escapeHtml(step.detail)}</p></div>`
      const button = stepButton(step)
      if (button) row.append(button)
      card.append(row)
    }
    setupHost.replaceChildren(card)
  }

  const list = context.content.querySelector<HTMLDivElement>('#history-list')
  const resultCount = context.content.querySelector<HTMLSpanElement>('#history-result-count')
  const metricCount = context.content.querySelector<HTMLElement>('#metric-count')
  const metricWords = context.content.querySelector<HTMLElement>('#metric-words')
  const metricSaved = context.content.querySelector<HTMLElement>('#metric-saved')
  const metricMonth = context.content.querySelector<HTMLElement>('#metric-month')

  const renderMetrics = (): void => {
    const totalWords = context.history.reduce((sum, entry) => sum + wordCount(entry.text), 0)
    const spokenMinutes =
      context.history.reduce((sum, entry) => sum + entry.durationMs, 0) / 60_000
    const typingMinutes = totalWords / 45

    const monthCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const lastThirtyDays = context.history.filter(
      (entry) => Date.parse(entry.createdAt) >= monthCutoff
    )

    if (metricCount) metricCount.textContent = context.history.length.toLocaleString()
    if (metricWords) metricWords.textContent = totalWords.toLocaleString()
    if (metricSaved) {
      metricSaved.textContent = `${Math.max(0, Math.round(typingMinutes - spokenMinutes))} min`
    }
    if (metricMonth) {
      const minutes = Math.round(
        lastThirtyDays.reduce((sum, entry) => sum + entry.durationMs, 0) / 60_000
      )
      metricMonth.textContent = `${lastThirtyDays.length.toLocaleString()} · ${minutes} min`
    }
  }

  /** Builds a paragraph node where search matches are wrapped in `<mark>`. */
  const highlight = (text: string, needle: string): HTMLParagraphElement => {
    const paragraph = document.createElement('p')
    paragraph.className = 'history-text'
    if (!needle) {
      paragraph.textContent = text
      return paragraph
    }
    const lower = text.toLocaleLowerCase()
    let cursor = 0
    for (;;) {
      const found = lower.indexOf(needle, cursor)
      if (found < 0) {
        paragraph.append(text.slice(cursor))
        break
      }
      if (found > cursor) paragraph.append(text.slice(cursor, found))
      const mark = document.createElement('mark')
      mark.textContent = text.slice(found, found + needle.length)
      paragraph.append(mark)
      cursor = found + needle.length
    }
    return paragraph
  }

  const renderList = (): void => {
    if (!list || !resultCount) return
    const needle = searchQuery.trim().toLocaleLowerCase()
    const filtered = needle
      ? context.history.filter((entry) => entry.text.toLocaleLowerCase().includes(needle))
      : context.history

    resultCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'dictation' : 'dictations'}`
    list.replaceChildren()

    if (!filtered.length) {
      const empty = document.createElement('div')
      empty.className = 'empty-state'
      empty.innerHTML = needle
        ? `<div class="empty-icon">${icon('search', 22)}</div><h3>No matching dictations</h3><p>Try a different word or phrase.</p>`
        : // The hero above already says how to make a first recording; saying
          // it again here is noise, not reassurance.
          `<div class="empty-icon">${icon('empty', 22)}</div><h3>Your history is empty</h3><p>Your first transcript will appear here.</p>`
      list.append(empty)
      return
    }

    const appendEntry = (entry: HistoryEntry): void => {
      const article = document.createElement('article')
      article.className = 'history-card'

      const metadata = document.createElement('div')
      metadata.className = 'history-meta'
      metadata.textContent = `${formatDate(entry.createdAt)} · ${formatDuration(entry.durationMs)} · ${wordCount(entry.text)} words`

      const actions = document.createElement('div')
      actions.className = 'history-actions'

      const copy = document.createElement('button')
      copy.className = 'text-button copy-button'
      copy.textContent = 'Copy'
      copy.addEventListener('click', async () => {
        await window.murmur.copyText(entry.text)
        copy.textContent = 'Copied'
        window.setTimeout(() => {
          copy.textContent = 'Copy'
        }, 1200)
      })

      const remove = document.createElement('button')
      remove.className = 'icon-button delete-button'
      remove.setAttribute('aria-label', 'Delete dictation')
      remove.innerHTML = icon('trash', 14)
      remove.addEventListener('click', async () => {
        if (!window.confirm('Delete this dictation? It is still in your clipboard if you copied it.')) {
          return
        }
        try {
          context.history = await window.murmur.deleteHistoryEntry(entry.id)
          renderMetrics()
          renderList()
        } catch (error) {
          if (resultCount) resultCount.textContent = friendlyError(error)
        }
      })

      actions.append(copy, remove)
      article.append(metadata, highlight(entry.text, needle), actions)
      list.append(article)
    }

    const dayHeader = (label: string): void => {
      const header = document.createElement('div')
      header.className = 'history-day'
      header.textContent = label
      list.append(header)
    }

    // Group by day, newest first, and virtualise: only `visibleCount` cards
    // are in the DOM; the list used to render all 5,000 at once.
    let previousDay = ''
    for (const entry of filtered.slice(0, visibleCount)) {
      const day = dayLabel(entry.createdAt)
      if (day !== previousDay) {
        dayHeader(day)
        previousDay = day
      }
      appendEntry(entry)
    }

    if (filtered.length > visibleCount) {
      const more = document.createElement('button')
      more.className = 'text-button show-more'
      more.textContent = `Show more (${filtered.length - visibleCount} remaining)`
      more.addEventListener('click', () => {
        visibleCount += PAGE_SIZE
        renderList()
      })
      list.append(more)
    }
  }

  context.content
    .querySelector<HTMLInputElement>('#history-search')
    ?.addEventListener('input', (event) => {
      searchQuery = (event.currentTarget as HTMLInputElement).value
      visibleCount = PAGE_SIZE
      renderList()
    })

  const exportFeedback = (saved: boolean, path: string | null): void => {
    if (resultCount) {
      resultCount.textContent = saved
        ? `Exported to ${path ?? 'file'}`
        : 'Export cancelled'
      window.setTimeout(() => renderList(), 2000)
    }
  }

  context.content.querySelector('#export-txt')?.addEventListener('click', async () => {
    const result = await window.murmur.exportHistory('txt')
    exportFeedback(result.saved, result.path)
  })
  context.content.querySelector('#export-json')?.addEventListener('click', async () => {
    const result = await window.murmur.exportHistory('json')
    exportFeedback(result.saved, result.path)
  })

  updateHeroHint()
  trialEndNotice?.apply(context.licence.trialEndNoticeDue)
  renderSetup()
  renderMetrics()
  renderList()

  return {
    refresh: () => {
      updateHeroHint()
      trialEndNotice?.apply(context.licence.trialEndNoticeDue)
      renderSetup()
      renderMetrics()
      renderList()
    },
    applyEngine: (status) => modelStep?.apply(status),
    applyLicence: (status) => trialEndNotice?.apply(status.trialEndNoticeDue)
  }
}
