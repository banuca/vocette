import type { AppContext } from '../app-context'
import { formatDate, formatDuration, wordCount } from '../dom'

/**
 * The history page renders its shell once and then patches only the list and
 * the metric values. Rebuilding the whole page on every `history:changed`
 * destroyed focus and the caret in the search box mid-typing.
 */
export function renderHistory(context: AppContext): { refresh: () => void } {
  context.setHeading('History', 'Everything you have dictated, stored on this PC.')

  let searchQuery = ''

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
    </section>
    <section class="history-section">
      <div class="section-toolbar">
        <div class="search-box"><span aria-hidden="true">⌕</span><input id="history-search" type="search" placeholder="Search your dictations" aria-label="Search your dictations" /></div>
        <span class="result-count" id="history-result-count"></span>
      </div>
      <div class="history-list" id="history-list"></div>
    </section>
  `

  const list = context.content.querySelector<HTMLDivElement>('#history-list')
  const resultCount = context.content.querySelector<HTMLSpanElement>('#history-result-count')
  const metricCount = context.content.querySelector<HTMLElement>('#metric-count')
  const metricWords = context.content.querySelector<HTMLElement>('#metric-words')
  const metricSaved = context.content.querySelector<HTMLElement>('#metric-saved')

  const renderMetrics = (): void => {
    const totalWords = context.history.reduce((sum, entry) => sum + wordCount(entry.text), 0)
    const spokenMinutes = context.history.reduce((sum, entry) => sum + entry.durationMs, 0) / 60_000
    const typingMinutes = totalWords / 45
    if (metricCount) metricCount.textContent = context.history.length.toLocaleString()
    if (metricWords) metricWords.textContent = totalWords.toLocaleString()
    if (metricSaved) {
      metricSaved.textContent = `${Math.max(0, Math.round(typingMinutes - spokenMinutes))} min`
    }
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

    for (const entry of filtered) {
      const article = document.createElement('article')
      article.className = 'history-card'

      const metadata = document.createElement('div')
      metadata.className = 'history-meta'
      metadata.textContent = `${formatDate(entry.createdAt)} · ${formatDuration(entry.durationMs)} · ${wordCount(entry.text)} words`

      const paragraph = document.createElement('p')
      paragraph.className = 'history-text'
      paragraph.textContent = entry.text

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
        context.history = await window.voiceHotkey.deleteHistoryEntry(entry.id)
        renderMetrics()
        renderList()
      })

      actions.append(copy, remove)
      article.append(metadata, paragraph, actions)
      list.append(article)
    }
  }

  context.content.querySelector('#open-setup')?.addEventListener('click', () => {
    context.navigate('settings')
  })

  context.content
    .querySelector<HTMLInputElement>('#history-search')
    ?.addEventListener('input', (event) => {
      searchQuery = (event.currentTarget as HTMLInputElement).value
      renderList()
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
