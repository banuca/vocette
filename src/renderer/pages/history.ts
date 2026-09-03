import type { AppContext } from '../app-context'
import { formatDate, formatDuration, wordCount } from '../dom'
import type { HistoryEntry } from '../../shared/types'

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

/**
 * The history page renders its shell once and then patches only the list and
 * the metric values. Rebuilding the whole page on every `history:changed`
 * destroyed focus and the caret in the search box mid-typing.
 */
export function renderHistory(context: AppContext): { refresh: () => void } {
  context.setHeading('History', 'Everything you have dictated, stored on this PC.')

  let searchQuery = ''
  let visibleCount = PAGE_SIZE

  context.content.innerHTML = `
    ${
      context.settings.apiKeyConfigured
        ? ''
        : `<div class="setup-banner"><div><strong>Finish setting up Voice Hotkey</strong><p>Add your own API key before your first dictation.</p></div><button class="primary-button" id="open-setup">Open settings</button></div>`
    }
    <section class="metrics" aria-label="Dictation totals">
      <div class="metric-card"><span>Dictations</span><strong id="metric-count">0</strong></div>
      <div class="metric-card"><span>Words captured</span><strong id="metric-words">0</strong></div>
      <div class="metric-card"><span>Est. time saved</span><strong id="metric-saved">0 min</strong></div>
      <div class="metric-card"><span>Last 30 days</span><strong id="metric-month">0</strong></div>
    </section>
    <section class="history-section">
      <div class="section-toolbar">
        <div class="search-box"><span aria-hidden="true">⌕</span><input id="history-search" type="search" placeholder="Search your dictations" aria-label="Search your dictations" /></div>
        <span class="result-count" id="history-result-count"></span>
        <span class="toolbar-spacer"></span>
        <button class="text-button" id="export-txt" type="button">Export .txt</button>
        <button class="text-button" id="export-json" type="button">Export .json</button>
      </div>
      <div class="history-list" id="history-list"></div>
    </section>
  `

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
        ? '<div class="empty-icon">⌕</div><h3>No matching dictations</h3><p>Try a different word or phrase.</p>'
        : '<div class="empty-icon">◌</div><h3>Your history is empty</h3><p>Hold your shortcut, speak, and release it. Your first transcript will appear here.</p>'
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
        await window.voiceHotkey.copyText(entry.text)
        copy.textContent = 'Copied'
        window.setTimeout(() => {
          copy.textContent = 'Copy'
        }, 1200)
      })

      const remove = document.createElement('button')
      remove.className = 'icon-button delete-button'
      remove.setAttribute('aria-label', 'Delete dictation')
      remove.textContent = '×'
      remove.addEventListener('click', async () => {
        if (!window.confirm('Delete this dictation? It is still in your clipboard if you copied it.')) {
          return
        }
        context.history = await window.voiceHotkey.deleteHistoryEntry(entry.id)
        renderMetrics()
        renderList()
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

  context.content.querySelector('#open-setup')?.addEventListener('click', () => {
    context.navigate('settings')
  })

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
    const result = await window.voiceHotkey.exportHistory('txt')
    exportFeedback(result.saved, result.path)
  })
  context.content.querySelector('#export-json')?.addEventListener('click', async () => {
    const result = await window.voiceHotkey.exportHistory('json')
    exportFeedback(result.saved, result.path)
  })

  renderMetrics()
  renderList()

  return {
    refresh: () => {
      renderMetrics()
      renderList()
    }
  }
}
