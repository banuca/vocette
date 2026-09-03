import './styles.css'
import type { AppContext } from './app-context'
import { escapeHtml, friendlyError } from './dom'
import { renderAbout } from './pages/about'
import { renderHistory } from './pages/history'
import { renderSettings } from './pages/settings'
import { chordLabel } from '../shared/keycodes'
import type { AppInfo, HistoryEntry, Page, PublicSettings, WorkflowStatus } from '../shared/types'

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('Application root was not found.')
/** Non-null alias so closures inside `mount` keep the narrowed type. */
const appRoot: HTMLDivElement = root

async function mount(): Promise<void> {
  appRoot.innerHTML = `
    <div class="loading-screen">
      <div class="brand-mark" aria-hidden="true"><span></span></div>
      <p>Opening Voice Hotkey…</p>
    </div>
  `

  let settings: PublicSettings
  let history: HistoryEntry[]
  let appInfo: AppInfo
  try {
    ;[settings, history, appInfo] = await Promise.all([
      window.voiceHotkey.getSettings(),
      window.voiceHotkey.getHistory(),
      window.voiceHotkey.getAppInfo()
    ])
  } catch (error) {
    appRoot.innerHTML = `<div class="fatal-error"><h1>Voice Hotkey could not open</h1><p>${escapeHtml(friendlyError(error))}</p></div>`
    return
  }

  let activePage: Page = 'history'
  let workflowStatus: WorkflowStatus = { phase: 'idle', message: 'Ready' }
  let historyView: { refresh: () => void } | null = null
  let settingsView: { apply: (next: PublicSettings) => void; dispose: () => void } | null = null

  appRoot.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true"><span></span></div>
          <div><strong>Voice Hotkey</strong><small>Open dictation</small></div>
        </div>
        <nav class="navigation" aria-label="Primary navigation">
          <button class="nav-item active" data-page="history"><span class="nav-icon" aria-hidden="true">⌁</span><span>History</span></button>
          <button class="nav-item" data-page="settings"><span class="nav-icon" aria-hidden="true">⚙</span><span>Settings</span></button>
          <button class="nav-item" data-page="about"><span class="nav-icon" aria-hidden="true">i</span><span>About</span></button>
        </nav>
        <div class="sidebar-footer">
          <div class="live-status"><span class="status-dot" id="status-dot"></span><span id="sidebar-status">Ready</span></div>
          <div class="shortcut-hint"><kbd id="sidebar-shortcut"></kbd><small>Hold to talk</small></div>
        </div>
      </aside>
      <main class="main-panel">
        <header class="topbar">
          <div><h1 id="page-title">History</h1><p id="page-subtitle"></p></div>
          <button class="window-close" id="hide-window" aria-label="Hide to system tray">×</button>
        </header>
        <div class="page-content" id="page-content"></div>
      </main>
    </div>
  `

  const title = appRoot.querySelector<HTMLHeadingElement>('#page-title')
  const subtitle = appRoot.querySelector<HTMLParagraphElement>('#page-subtitle')
  const content = appRoot.querySelector<HTMLDivElement>('#page-content')
  if (!title || !subtitle || !content) throw new Error('Application layout failed to initialise.')

  const updateSidebar = (): void => {
    const status = appRoot.querySelector<HTMLElement>('#sidebar-status')
    const dot = appRoot.querySelector<HTMLElement>('#status-dot')
    const shortcut = appRoot.querySelector<HTMLElement>('#sidebar-shortcut')
    if (status) status.textContent = workflowStatus.message
    if (dot) {
      dot.className = `status-dot ${workflowStatus.phase}${context.settings.hotkeyEnabled ? '' : ' off'}`
    }
    if (shortcut) shortcut.textContent = chordLabel(context.settings.shortcut.keys)
  }

  const context: AppContext = {
    content,
    settings,
    history,
    appInfo,
    setHeading: (nextTitle, nextSubtitle) => {
      title.textContent = nextTitle
      subtitle.textContent = nextSubtitle
    },
    applySettings: (next) => {
      context.settings = next
      updateSidebar()
    },
    navigate: (page) => {
      activePage = page
      renderPage()
    },
    reloadHistory: async () => {
      context.history = await window.voiceHotkey.getHistory()
      historyView?.refresh()
    }
  }

  const renderPage = (): void => {
    appRoot.querySelectorAll<HTMLButtonElement>('.nav-item').forEach((button) => {
      button.classList.toggle('active', button.dataset.page === activePage)
    })
    // Tear down the previous page's subscriptions first: a settings page left
    // mid-shortcut-capture must not keep the hook hijacked from a dead UI.
    settingsView?.dispose()
    settingsView = null
    historyView = null
    try {
      if (activePage === 'history') historyView = renderHistory(context)
      if (activePage === 'settings') settingsView = renderSettings(context)
      if (activePage === 'about') renderAbout(context)
    } catch (error) {
      // A page bug must be visible — once, a render error after the HTML was
      // drawn left the page looking fine but with zero event listeners, so
      // the Save button silently did nothing.
      content.innerHTML = `<div class="fatal-error"><h1>This page could not open</h1><p>${escapeHtml(friendlyError(error))}</p></div>`
    }
    updateSidebar()
  }

  appRoot.querySelectorAll<HTMLButtonElement>('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.page
      if (page === 'history' || page === 'settings' || page === 'about') context.navigate(page)
    })
  })

  appRoot.querySelector('#hide-window')?.addEventListener('click', () => {
    void window.voiceHotkey.hideWindow()
  })

  window.voiceHotkey.onWorkflowStatus((status) => {
    workflowStatus = status
    updateSidebar()
  })

  window.voiceHotkey.onSettingsChanged((next) => {
    context.applySettings(next)
    // The tray can toggle hold-to-talk / launch-at-login while Settings is
    // open. Patch the controls in place — a full re-render here used to wipe
    // whatever the user had typed into the API-key field.
    if (activePage === 'settings') settingsView?.apply(next)
  })

  window.voiceHotkey.onHistoryChanged(() => {
    void context.reloadHistory()
  })

  window.voiceHotkey.onNavigate((page) => {
    context.navigate(page)
  })

  renderPage()
  // Tells the main process the renderer can receive navigation now, instead of
  // guessing with a timeout.
  void window.voiceHotkey.announceReady()
}

void mount()
