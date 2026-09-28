import type { AppContext } from '../app-context'
import { icon } from '../icons'
import { escapeHtml, formatDate, formatDuration, wordCount } from '../dom'
import { commandFailure, createModelRow, type ModelRowView } from '../model-download'
import { setupHeading, setupSteps, type SetupStep } from '../setup-guide'
import { createTrialEndNotice } from '../trial-end-notice'
import { effectiveRecordingMode, globalShortcutUsable } from '../../shared/capabilities'
import type { EngineStatus } from '../../shared/engine'
import { chordLabel } from '../../shared/keycodes'
import {
  EMPTY_EDIT_REFUSAL,
  MAX_HISTORY_TEXT_CHARS,
  originalTextOf,
  type HistoryEntry,
  type LicenceStatus
} from '../../shared/types'

/** Initial render cap; "Show more" reveals the rest in steps. */
const PAGE_SIZE = 200
/** How long a deleted dictation can be brought back. */
const UNDO_MS = 8000

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
    <div class="undo-slot" id="history-undo" role="status"></div>
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
  const undoSlot = context.content.querySelector<HTMLDivElement>('#history-undo')

  /**
   * The row being edited, if any — only ever one. While it is open the list is
   * not rebuilt, whatever asks for it: a rebuild would destroy the text area
   * and whatever has been typed into it. It is rebuilt once the edit closes.
   */
  let editingId: string | null = null
  /** Rows switched to their original text, by id, so that a rebuild keeps them so. */
  const showingOriginal = new Set<string>()
  /** The copy of a deleted entry that Undo would put back, and when the offer lapses. */
  let undo: { entry: HistoryEntry | null; timer: number } | null = null

  const textButton = (label: string, className: string): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `text-button ${className}`
    button.textContent = label
    return button
  }

  /** A copy button that says, for a moment, that it worked. */
  const copyButton = (label: string, text: string): HTMLButtonElement => {
    const button = textButton(label, 'copy-button')
    button.addEventListener('click', async () => {
      await window.murmur.copyText(text)
      button.textContent = 'Copied'
      window.setTimeout(() => {
        button.textContent = label
      }, 1200)
    })
    return button
  }

  const clearUndo = (): void => {
    if (undo) window.clearTimeout(undo.timer)
    // The copy goes with the offer: a deleted text is kept no longer than it
    // can still be brought back.
    undo = null
    undoSlot?.replaceChildren()
  }

  /**
   * The bar at the foot of the page, for `UNDO_MS`. Given an entry it offers
   * Undo; without one it only says why Undo did not work. A later delete
   * replaces it, and the one before can no longer be undone.
   */
  const showUndoBar = (message: string, entry: HistoryEntry | null): void => {
    clearUndo()
    if (!undoSlot) return
    const bar = document.createElement('div')
    bar.className = 'undo-bar'
    const text = document.createElement('span')
    text.textContent = message
    bar.append(text)
    if (entry) {
      const button = textButton('Undo', 'undo-button')
      button.addEventListener('click', () => void undoDelete())
      bar.append(button)
    }
    undoSlot.replaceChildren(bar)
    undo = { entry, timer: window.setTimeout(clearUndo, UNDO_MS) }
  }

  /** Puts the last deleted entry back, where it was among the rest by date. */
  const undoDelete = async (): Promise<void> => {
    const entry = undo?.entry
    if (!entry) return
    clearUndo()
    try {
      context.history = await window.murmur.restoreHistoryEntry(entry)
    } catch (error) {
      showUndoBar(`The dictation could not be put back. ${commandFailure(error)}`, null)
      // Whatever the store now holds is what the list should show.
      void context.reloadHistory()
      return
    }
    renderMetrics()
    renderList()
  }

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
    // Held until the edit closes; see `editingId`.
    if (editingId !== null) return
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
      article.dataset.entryId = entry.id

      const metadata = document.createElement('div')
      metadata.className = 'history-meta'
      metadata.textContent = `${formatDate(entry.createdAt)} · ${formatDuration(entry.durationMs)} · ${wordCount(entry.text)} words`
      if (entry.editedAt) {
        const edited = document.createElement('span')
        edited.textContent = 'Edited'
        edited.title = `Edited ${formatDate(entry.editedAt)}`
        metadata.append(' · ', edited)
      }

      const original = originalTextOf(entry)
      /** The row's text: what was delivered, or the original while that is switched on. */
      const textFor = (): HTMLParagraphElement => {
        const shown = original !== null && showingOriginal.has(entry.id) ? original : null
        const paragraph = highlight(shown ?? entry.text, needle)
        paragraph.classList.toggle('is-original', shown !== null)
        return paragraph
      }
      let paragraph = textFor()

      const actions = document.createElement('div')
      actions.className = 'history-actions'

      const edit = textButton('Edit', 'edit-button')
      edit.addEventListener('click', () => openEditor(entry, article))
      actions.append(edit, copyButton('Copy', entry.text))

      if (original !== null) {
        const toggle = textButton('', 'original-button')
        const labelToggle = (): void => {
          toggle.textContent = showingOriginal.has(entry.id) ? 'Hide original' : 'Show original'
        }
        labelToggle()
        toggle.addEventListener('click', () => {
          if (showingOriginal.has(entry.id)) showingOriginal.delete(entry.id)
          else showingOriginal.add(entry.id)
          // Only this row's text is swapped; nothing else in the list moves.
          const next = textFor()
          paragraph.replaceWith(next)
          paragraph = next
          labelToggle()
        })
        actions.append(toggle, copyButton('Copy original', original))
      }

      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'icon-button delete-button'
      remove.setAttribute('aria-label', 'Delete dictation')
      remove.innerHTML = icon('trash', 14)
      remove.addEventListener('click', async () => {
        // No confirmation: the entry is deleted on disk at once, and the bar
        // at the foot of the page offers it back for a few seconds.
        remove.disabled = true
        try {
          context.history = await window.murmur.deleteHistoryEntry(entry.id)
        } catch (error) {
          remove.disabled = false
          if (resultCount) resultCount.textContent = commandFailure(error)
          return
        }
        showUndoBar('Dictation deleted', entry)
        renderMetrics()
        renderList()
      })

      actions.append(remove)
      article.append(metadata, paragraph, actions)
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

  /**
   * Swaps a row's text for a text area in the same face and size, with Save
   * and Cancel. Esc cancels; Ctrl + Enter (Command + Enter on a Mac) saves.
   */
  const openEditor = (entry: HistoryEntry, article: HTMLElement): void => {
    const paragraph = article.querySelector('.history-text')
    const actions = article.querySelector('.history-actions')
    if (editingId !== null || !list || !paragraph || !actions) return
    editingId = entry.id
    // The rest of the list holds still until the edit closes: no other row
    // can be opened, deleted or paged in underneath it.
    list
      .querySelectorAll<HTMLButtonElement>('.edit-button, .delete-button, .show-more')
      .forEach((button) => {
        button.disabled = true
      })

    const box = document.createElement('textarea')
    box.className = 'history-edit'
    box.value = entry.text
    box.maxLength = MAX_HISTORY_TEXT_CHARS
    box.setAttribute('aria-label', 'Dictation text')

    const problem = document.createElement('p')
    problem.className = 'history-edit-problem'
    problem.setAttribute('role', 'alert')
    problem.hidden = true

    const save = textButton('Save', 'history-save')
    const cancel = textButton('Cancel', 'history-cancel')
    const hint = document.createElement('span')
    hint.className = 'history-edit-hint'
    hint.textContent = `${context.platform.primaryModifierLabel} + Enter to save · Esc to cancel`
    const editorActions = document.createElement('div')
    editorActions.className = 'history-actions'
    editorActions.append(save, cancel, hint)

    let saving = false
    const refuse = (message: string): void => {
      problem.textContent = message
      problem.hidden = false
      box.focus()
    }

    const finish = async (): Promise<void> => {
      if (saving) return
      const text = box.value
      if (!text.trim()) {
        refuse(EMPTY_EDIT_REFUSAL)
        return
      }
      // A text area hands line breaks back as \n whatever it was given, so an
      // untouched text is compared that way — and is not marked as edited.
      if (text === entry.text.replace(/\r\n?/gu, '\n')) {
        closeEditor()
        return
      }
      saving = true
      box.readOnly = true
      save.disabled = true
      cancel.disabled = true
      try {
        context.history = await window.murmur.updateHistoryEntry(entry.id, text)
      } catch (error) {
        // What was typed stays where it is, to be saved again or copied out.
        saving = false
        box.readOnly = false
        save.disabled = false
        cancel.disabled = false
        refuse(commandFailure(error))
        return
      }
      closeEditor()
    }

    save.addEventListener('click', () => void finish())
    cancel.addEventListener('click', () => closeEditor())
    box.addEventListener('input', () => {
      problem.hidden = true
    })
    // On the row rather than the text area, so the keys work from Save and
    // Cancel too. An input method composing text owns them meanwhile.
    article.addEventListener('keydown', (event) => {
      if (event.isComposing || saving) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeEditor()
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        void finish()
      }
    })

    article.classList.add('is-editing')
    paragraph.replaceWith(box)
    actions.replaceWith(editorActions)
    editorActions.before(problem)
    box.focus()
    box.setSelectionRange(box.value.length, box.value.length)
  }

  /** Ends the edit, saved or not, and catches the list up with anything that arrived meanwhile. */
  const closeEditor = (): void => {
    const id = editingId
    editingId = null
    renderMetrics()
    renderList()
    // Back to the row's own Edit button, so the keyboard carries on from there.
    const row = Array.from(list?.querySelectorAll<HTMLElement>('.history-card') ?? []).find(
      (card) => card.dataset.entryId === id
    )
    row?.querySelector<HTMLButtonElement>('.edit-button')?.focus()
  }

  context.content
    .querySelector<HTMLInputElement>('#history-search')
    ?.addEventListener('input', (event) => {
      searchQuery = (event.currentTarget as HTMLInputElement).value
      visibleCount = PAGE_SIZE
      if (editingId !== null) {
        // The list holds still while a row is open, so say when this applies.
        if (resultCount) resultCount.textContent = 'The search applies once you finish editing'
        return
      }
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
