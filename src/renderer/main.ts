import './styles.css'
import type { AppContext, NavigationIntent } from './app-context'
import { escapeHtml, friendlyError } from './dom'
import { createHistorySaveWarning, trackHistorySaveStatus } from './history-save-warning'
import { createRecordingControl } from './recording-control'
import { icon } from './icons'
import { applyTheme, createThemeToggle, type ThemeToggle } from './theme'
import type { MicrophoneAccess } from './setup-guide'
import { renderAbout } from './pages/about'
import { renderHistory, type HistoryView } from './pages/history'
import { renderSettings, type SettingsView } from './pages/settings'
import { effectiveRecordingMode, globalShortcutUsable } from '../shared/capabilities'
import type { EngineStatus } from '../shared/engine'
import { chordLabel } from '../shared/keycodes'
import type { AppInfo, HistoryEntry, Page, PublicSettings } from '../shared/types'

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('Application root was not found.')
/** Non-null alias so closures inside `mount` keep the narrowed type. */
const appRoot: HTMLDivElement = root

/**
 * Reads microphone permission without asking for it.
 *
 * Asking here would pop a prompt on every launch. The Permissions API answers
 * silently where it is supported, and where it is not the answer is honestly
 * "unknown" rather than an assumption in either direction.
 */
async function microphoneAccess(): Promise<MicrophoneAccess> {
  try {
    const status = await navigator.permissions.query({
      name: 'microphone' as PermissionName
    })
    if (status.state === 'granted') return 'granted'
    if (status.state === 'denied') return 'denied'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

async function mount(): Promise<void> {
  appRoot.innerHTML = `
    <div class="loading-screen">
      <div class="brand-mark" aria-hidden="true"><span></span></div>
      <p>Opening Murmur…</p>
    </div>
  `

  // Started before anything is awaited, so a save that fails while this window
  // is loading is already known by the time the shell can show it.
  const saveStatus = trackHistorySaveStatus(window.murmur)

  let settings: PublicSettings
  let history: HistoryEntry[]
  let appInfo: AppInfo
  let engine: EngineStatus
  try {
    ;[settings, history, appInfo, engine] = await Promise.all([
      window.murmur.getSettings(),
      window.murmur.getHistory(),
      window.murmur.getAppInfo(),
      window.murmur.getEngineStatus()
    ])
  } catch (error) {
    appRoot.innerHTML = `<div class="fatal-error"><h1>Murmur could not open</h1><p>${escapeHtml(friendlyError(error))}</p></div>`
    return
  }

  // Applied before the shell is drawn, so a light user never sees the window
  // paint dark first.
  applyTheme(document.documentElement, settings.theme)

  let activePage: Page = 'history'
  let historyView: HistoryView | null = null
  let settingsView: SettingsView | null = null

  appRoot.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true"><span></span></div>
          <div><strong>Murmur</strong><small>Open dictation</small></div>
        </div>
        <nav class="navigation" aria-label="Primary navigation">
          <button class="nav-item active" data-page="history" title="History"><span class="nav-icon">${icon('history')}</span><span>History</span></button>
          <button class="nav-item" data-page="settings" title="Settings"><span class="nav-icon">${icon('settings')}</span><span>Settings</span></button>
          <button class="nav-item" data-page="about" title="About"><span class="nav-icon">${icon('info')}</span><span>About</span></button>
        </nav>
        <div class="sidebar-footer">
          <div class="live-status"><span class="status-dot" id="status-dot"></span><span id="sidebar-status">Ready</span></div>
          <div class="shortcut-hint"><kbd id="sidebar-shortcut"></kbd><small id="sidebar-shortcut-mode">Hold to talk</small></div>
        </div>
        <div class="sidebar-theme" id="theme-host"></div>
      </aside>
      <main class="main-panel">
        <header class="topbar">
          <div class="topbar-heading"><h1 id="page-title">History</h1><p id="page-subtitle"></p></div>
          <div class="topbar-actions" id="record-slot"></div>
          <button class="window-close" id="hide-window" aria-label="Hide to system tray" title="Hide to system tray">${icon('close', 15)}</button>
        </header>
        <div id="history-save-warning"></div>
        <div class="page-content" id="page-content"></div>
      </main>
    </div>
  `

  const title = appRoot.querySelector<HTMLHeadingElement>('#page-title')
  const subtitle = appRoot.querySelector<HTMLParagraphElement>('#page-subtitle')
  const content = appRoot.querySelector<HTMLDivElement>('#page-content')
  const warningHost = appRoot.querySelector<HTMLDivElement>('#history-save-warning')
  const recordSlot = appRoot.querySelector<HTMLDivElement>('#record-slot')
  const themeHost = appRoot.querySelector<HTMLDivElement>('#theme-host')
  if (!title || !subtitle || !content || !warningHost || !recordSlot || !themeHost) {
    throw new Error('Application layout failed to initialise.')
  }

  saveStatus.attach(createHistorySaveWarning(warningHost))
  // Built once and moved, never rebuilt: History shows it large at the head of
  // the page, every other page keeps the compact pill in the top bar.
  const recordHost = document.createElement('div')
  recordHost.id = 'record-host'
  recordSlot.appendChild(recordHost)
  const recordControl = createRecordingControl(recordHost, window.murmur)
  let themeToggle: ThemeToggle | null = null

  const updateRecordControl = (): void => {
    recordControl.apply({
      status: context.workflow,
      platform: context.platform,
      ready: context.engine.ready,
      notReadyReason: context.engine.notReadyReason
    })
  }

  const updateSidebar = (): void => {
    const status = appRoot.querySelector<HTMLElement>('#sidebar-status')
    const dot = appRoot.querySelector<HTMLElement>('#status-dot')
    const shortcut = appRoot.querySelector<HTMLElement>('#sidebar-shortcut')
    const mode = appRoot.querySelector<HTMLElement>('#sidebar-shortcut-mode')
    const usable = globalShortcutUsable(context.platform.capabilities)
    // "Ready" beside a green dot while nothing can be transcribed yet reads as
    // a contradiction of the setup card right next to it.
    const idleButNotReady = context.workflow.phase === 'idle' && !context.engine.ready
    if (status) status.textContent = idleButNotReady ? 'Not set up yet' : context.workflow.message
    if (dot) {
      const off = context.settings.hotkeyEnabled && usable && !idleButNotReady ? '' : ' off'
      dot.className = `status-dot ${context.workflow.phase}${off}`
    }
    if (shortcut) {
      shortcut.textContent = usable ? chordLabel(context.settings.shortcut.keys) : 'Not available'
    }
    if (mode) {
      mode.textContent = !usable
        ? 'Use the Record button'
        : effectiveRecordingMode(context.settings.recordingMode, context.platform.capabilities) ===
            'toggle'
          ? 'Press to start and stop'
          : 'Hold to talk'
    }
    updateRecordControl()
  }

  const context: AppContext = {
    content,
    settings,
    history,
    appInfo,
    platform: appInfo.platformStatus,
    engine,
    workflow: { phase: 'idle', message: 'Ready' },
    microphone: 'unknown',
    setHeading: (nextTitle, nextSubtitle) => {
      title.textContent = nextTitle
      subtitle.textContent = nextSubtitle
    },
    applySettings: (next) => {
      context.settings = next
      // Settings saved on the Settings page can carry a theme too.
      themeToggle?.apply(next.theme)
      updateSidebar()
    },
    applyPlatform: (next) => {
      context.platform = next
      updateSidebar()
      // Capability changes alter what History and Settings are allowed to
      // promise, so both are refreshed rather than left showing stale claims.
      historyView?.refresh()
      settingsView?.apply(context.settings)
    },
    applyEngine: (next) => {
      const stepsChanged =
        next.engine !== context.engine.engine ||
        next.ready !== context.engine.ready ||
        next.notReadyReason !== context.engine.notReadyReason
      context.engine = next
      // The sidebar says "Not set up yet" until the engine is ready.
      if (stepsChanged) updateSidebar()
      else updateRecordControl()
      // Download progress arrives several times a second. The setup steps
      // only change with the engine or its readiness, so History is redrawn
      // only then; in between, just the model rows follow the download.
      if (stepsChanged) historyView?.refresh()
      else historyView?.applyEngine(next)
      settingsView?.applyEngine(next)
    },
    navigate: (page, intent) => {
      activePage = page
      renderPage(intent)
    },
    reloadHistory: async () => {
      context.history = await window.murmur.getHistory()
      historyView?.refresh()
    }
  }

  themeToggle = createThemeToggle(
    themeHost,
    document.documentElement,
    window.murmur,
    context.settings.theme,
    (saved) => {
      // Keep the cached settings honest: the store is what decides.
      context.settings = saved
      settingsView?.apply(saved)
    }
  )

  const renderPage = (intent?: NavigationIntent): void => {
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
      if (activePage === 'settings') settingsView = renderSettings(context, intent)
      if (activePage === 'about') renderAbout(context)
    } catch (error) {
      // A page bug must be visible — once, a render error after the HTML was
      // drawn left the page looking fine but with zero event listeners, so
      // the Save button silently did nothing.
      content.innerHTML = `<div class="fatal-error"><h1>This page could not open</h1><p>${escapeHtml(friendlyError(error))}</p></div>`
    }
    // Moving the element keeps its listeners and its current state; building a
    // second control per page would let two of them disagree.
    const hero = content.querySelector<HTMLElement>('#hero-record')
    ;(hero ?? recordSlot).appendChild(recordHost)
    recordHost.classList.toggle('is-hero', hero !== null)
    updateSidebar()
  }

  appRoot.querySelectorAll<HTMLButtonElement>('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.page
      if (page === 'history' || page === 'settings' || page === 'about') context.navigate(page)
    })
  })

  appRoot.querySelector('#hide-window')?.addEventListener('click', () => {
    void window.murmur.hideWindow()
  })

  window.murmur.onWorkflowStatus((status) => {
    context.workflow = status
    updateSidebar()
    // Removing the speech model waits for a dictation to finish.
    settingsView?.applyWorkflow(status)
  })

  window.murmur.onSettingsChanged((next) => {
    context.applySettings(next)
    // The tray can toggle the shortcut or launch-at-login while Settings is
    // open. Patch the controls in place — a full re-render here used to wipe
    // whatever the user had typed into the API-key field.
    if (activePage === 'settings') settingsView?.apply(next)
  })

  window.murmur.onPlatformStatus((next) => {
    context.applyPlatform(next)
  })

  window.murmur.onEngineStatus((next) => {
    context.applyEngine(next)
  })

  window.murmur.onHistoryChanged(() => {
    void context.reloadHistory()
  })

  window.murmur.onNavigate((page) => {
    context.navigate(page)
  })

  renderPage()
  // Tells the main process the renderer can receive navigation now, instead of
  // guessing with a timeout.
  void window.murmur.announceReady()

  // None of these may hold up the window: they only refine what is shown.
  void microphoneAccess().then((access) => {
    context.microphone = access
    historyView?.refresh()
  })
  void window.murmur
    .getPlatformStatus()
    .then((next) => context.applyPlatform(next))
    .catch(() => undefined)
  // A change broadcast while this window was loading, before it subscribed,
  // would otherwise be missed until the next one.
  void window.murmur
    .getEngineStatus()
    .then((next) => context.applyEngine(next))
    .catch(() => undefined)
}

void mount()
