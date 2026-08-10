import type { AppContext } from '../app-context'
import { escapeHtml, friendlyError, keyChips } from '../dom'
import { chordLabel, keyLabel } from '../../shared/keycodes'
import {
  HOLD_DELAY_OPTIONS,
  SHORTCUT_PRESETS,
  chordEquals,
  validateChord
} from '../../shared/shortcuts'
import type { SettingsUpdate } from '../../shared/types'

/** Requesting the mic once per session is what makes device labels readable. */
let microphonePermissionRequested = false
/** Unsubscribe for the capture stream, so re-rendering cannot stack listeners. */
let releaseCaptureListener: (() => void) | null = null

function holdDelayLabel(ms: number): string {
  return ms === 0 ? 'Instantly' : `${ms} ms`
}

export function renderSettings(context: AppContext): void {
  context.setHeading('Settings', 'Set up your key, microphone, shortcut, and local history.')

  const settings = context.settings
  /** Chord chosen but not yet saved. */
  let pendingKeys: number[] | null = null
  let capturing = false

  const currentKeys = (): number[] => pendingKeys ?? settings.shortcut.keys

  context.content.innerHTML = `
    <div class="settings-stack">
      <section class="settings-card">
        <div class="settings-heading">
          <div><h2>Transcription API</h2><p>Your key is encrypted by Windows and never displayed again.</p></div>
          <span class="configured-badge ${settings.apiKeyConfigured ? 'is-configured' : ''}" id="key-badge">${settings.apiKeyConfigured ? 'Key configured' : 'Key required'}</span>
        </div>
        <div class="form-grid">
          <label class="field field-wide"><span>OpenAI API key</span>
            <div class="password-row">
              <input id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="${settings.apiKeyConfigured ? 'Enter a new key to replace the saved key' : 'sk-…'}" />
              <button class="secondary-button" id="open-api-keys" type="button">Get a key</button>
            </div>
            <small>The app sends each completed recording directly to OpenAI using your key.</small>
          </label>
          <label class="field"><span>Model</span><input type="text" value="${escapeHtml(settings.model)}" disabled /></label>
          <label class="field"><span>Language</span><input type="text" value="${escapeHtml(settings.language === 'auto' ? 'Automatic' : settings.language.toUpperCase())}" disabled /></label>
        </div>
        ${settings.apiKeyConfigured ? '<button class="danger-link" id="clear-api-key" type="button">Remove saved API key</button>' : ''}
      </section>

      <section class="settings-card">
        <div class="settings-heading"><div><h2>Hold-to-talk</h2><p>The shortcut works system-wide while Voice Hotkey is in the tray.</p></div></div>

        <div class="shortcut-editor">
          <div class="shortcut-current">
            <span class="field-label">Shortcut</span>
            <button class="shortcut-button" id="shortcut-capture" type="button">
              <span class="chips" id="shortcut-chips">${keyChips(currentKeys().map(keyLabel))}</span>
              <span class="shortcut-action" id="shortcut-action">Change</span>
            </button>
            <small id="shortcut-feedback">Click Change, then hold the keys you want.</small>
          </div>
          <div class="shortcut-presets">
            <span class="field-label">Quick picks</span>
            <div class="preset-row" id="preset-row">
              ${SHORTCUT_PRESETS.map(
                (preset) =>
                  `<button class="preset-button" type="button" data-keys="${preset.keys.join(',')}">${escapeHtml(chordLabel(preset.keys))}</button>`
              ).join('')}
            </div>
          </div>
        </div>

        <div class="form-grid">
          <label class="field"><span>Start after holding for</span>
            <select id="hold-delay">
              ${HOLD_DELAY_OPTIONS.map(
                (option) => `<option value="${option}">${holdDelayLabel(option)}</option>`
              ).join('')}
            </select>
            <small>A short delay stops shortcuts like Ctrl + Shift + T from triggering dictation.</small>
          </label>
          <label class="field"><span>Microphone</span>
            <div class="inline-control">
              <select id="microphone"><option value="">Windows default microphone</option></select>
              <button class="icon-refresh" id="refresh-microphones" type="button" aria-label="Refresh microphones">↻</button>
            </div>
            <small id="microphone-feedback">Checking microphones…</small>
          </label>
        </div>

        <div class="toggle-list">
          <label class="toggle-row"><div><strong>Hold-to-talk enabled</strong><span>Turn the global shortcut off without quitting the app.</span></div><input id="hotkey-enabled" type="checkbox" /><i></i></label>
          <label class="toggle-row"><div><strong>Paste automatically</strong><span>Copy the transcript and press Ctrl + V in the active app.</span></div><input id="auto-paste" type="checkbox" /><i></i></label>
          <label class="toggle-row"><div><strong>Light cleanup</strong><span>Remove “um”, “uh”, “erm”, and repair spacing without rewriting you.</span></div><input id="remove-fillers" type="checkbox" /><i></i></label>
          <label class="toggle-row"><div><strong>Start with Windows</strong><span>Keep hold-to-talk ready after you sign in.</span></div><input id="launch-at-login" type="checkbox" /><i></i></label>
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-heading"><div><h2>Local history</h2><p>Only transcript text and basic timing are stored. Original audio is not saved.</p></div></div>
        <div class="form-grid">
          <label class="field"><span>Keep transcripts</span>
            <select id="history-retention">
              <option value="0">Until I delete them</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </select>
          </label>
        </div>
        <button class="danger-link" id="clear-history" type="button">Delete all transcript history</button>
      </section>

      <div class="settings-savebar"><span id="settings-feedback"></span><button class="primary-button" id="save-settings" type="button">Save settings</button></div>
    </div>
  `

  const query = <T extends HTMLElement>(selector: string): T | null =>
    context.content.querySelector<T>(selector)

  const holdDelay = query<HTMLSelectElement>('#hold-delay')
  const hotkeyEnabled = query<HTMLInputElement>('#hotkey-enabled')
  const autoPaste = query<HTMLInputElement>('#auto-paste')
  const removeFillers = query<HTMLInputElement>('#remove-fillers')
  const launchAtLogin = query<HTMLInputElement>('#launch-at-login')
  const retention = query<HTMLSelectElement>('#history-retention')
  const chips = query<HTMLSpanElement>('#shortcut-chips')
  const shortcutButton = query<HTMLButtonElement>('#shortcut-capture')
  const shortcutAction = query<HTMLSpanElement>('#shortcut-action')
  const shortcutFeedback = query<HTMLElement>('#shortcut-feedback')

  if (holdDelay) holdDelay.value = String(settings.holdDelayMs)
  if (hotkeyEnabled) hotkeyEnabled.checked = settings.hotkeyEnabled
  if (autoPaste) autoPaste.checked = settings.autoPaste
  if (removeFillers) removeFillers.checked = settings.removeFillers
  if (launchAtLogin) launchAtLogin.checked = settings.launchAtLogin
  if (retention) retention.value = String(settings.historyRetentionDays)

  // --- Shortcut capture ---------------------------------------------------

  const paintChips = (keys: readonly number[]): void => {
    if (chips) chips.innerHTML = keyChips(keys.map(keyLabel))
  }

  const setFeedback = (text: string, tone: 'muted' | 'warn' | 'error' = 'muted'): void => {
    if (!shortcutFeedback) return
    shortcutFeedback.textContent = text
    shortcutFeedback.className = `shortcut-feedback tone-${tone}`
  }

  const endCapture = (): void => {
    capturing = false
    shortcutButton?.classList.remove('is-capturing')
    if (shortcutAction) shortcutAction.textContent = 'Change'
  }

  const commitCapture = (keys: number[]): void => {
    const validation = validateChord(keys)
    if (!validation.ok) {
      paintChips(currentKeys())
      setFeedback(validation.error ?? 'That shortcut cannot be used.', 'error')
      return
    }
    pendingKeys = keys
    paintChips(keys)
    if (validation.warning) {
      setFeedback(validation.warning, 'warn')
    } else if (chordEquals(keys, settings.shortcut.keys)) {
      setFeedback('That is already your shortcut.')
    } else {
      setFeedback(`${chordLabel(keys)} — press Save settings to apply.`)
    }
  }

  releaseCaptureListener?.()
  releaseCaptureListener = window.voiceHotkey.onShortcutCapture(({ keys, done }) => {
    if (!capturing) return
    if (!done) {
      paintChips(keys)
      return
    }
    endCapture()
    if (!keys.length) {
      paintChips(currentKeys())
      setFeedback('Shortcut unchanged.')
      return
    }
    commitCapture(keys)
  })

  shortcutButton?.addEventListener('click', async () => {
    if (capturing) {
      await window.voiceHotkey.cancelShortcutCapture()
      endCapture()
      paintChips(currentKeys())
      setFeedback('Shortcut unchanged.')
      return
    }
    capturing = true
    shortcutButton.classList.add('is-capturing')
    if (shortcutAction) shortcutAction.textContent = 'Cancel'
    paintChips([])
    setFeedback('Hold the keys you want, then let go.')
    await window.voiceHotkey.beginShortcutCapture()
  })

  query<HTMLDivElement>('#preset-row')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.preset-button')
    if (!button?.dataset.keys) return
    if (capturing) {
      void window.voiceHotkey.cancelShortcutCapture()
      endCapture()
    }
    commitCapture(button.dataset.keys.split(',').map(Number))
  })

  // --- Microphones --------------------------------------------------------

  const populateMicrophones = async (requestPermission: boolean): Promise<void> => {
    const select = query<HTMLSelectElement>('#microphone')
    const feedback = query<HTMLElement>('#microphone-feedback')
    if (!select) return

    let temporaryStream: MediaStream | null = null
    try {
      // Device labels stay blank until this document has been granted the
      // microphone once, which is why the list used to read "Microphone 1".
      if (requestPermission) {
        temporaryStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        microphonePermissionRequested = true
      }

      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === 'audioinput'
      )

      select.replaceChildren()
      select.add(new Option('Windows default microphone', ''))
      devices.forEach((device, index) => {
        if (device.deviceId === 'default') return
        select.add(new Option(device.label || `Microphone ${index + 1}`, device.deviceId))
      })

      // A saved microphone that is currently unplugged must stay selected,
      // otherwise saving settings silently discards the choice.
      const saved = context.settings.microphoneId
      if (saved && !devices.some((device) => device.deviceId === saved)) {
        select.add(new Option('Saved microphone (not connected)', saved))
      }
      select.value = saved

      if (feedback) {
        feedback.textContent = devices.length
          ? `${devices.length} found`
          : 'Using Windows default'
      }
    } catch (error) {
      if (feedback) feedback.textContent = friendlyError(error)
    } finally {
      temporaryStream?.getTracks().forEach((track) => track.stop())
    }
  }

  void populateMicrophones(!microphonePermissionRequested)
  query('#refresh-microphones')?.addEventListener('click', () => {
    void populateMicrophones(true)
  })

  // --- Actions ------------------------------------------------------------

  query('#open-api-keys')?.addEventListener('click', () => {
    void window.voiceHotkey.openExternal('api-keys')
  })

  query('#clear-api-key')?.addEventListener('click', async () => {
    if (!window.confirm('Remove the saved API key from this computer?')) return
    context.applySettings(await window.voiceHotkey.clearApiKey())
    renderSettings(context)
  })

  query('#clear-history')?.addEventListener('click', async () => {
    if (!window.confirm('Permanently delete every saved transcript? This cannot be undone.')) return
    await window.voiceHotkey.clearHistory()
    await context.reloadHistory()
    const feedback = query('#settings-feedback')
    if (feedback) feedback.textContent = 'Transcript history deleted.'
  })

  query('#save-settings')?.addEventListener('click', async () => {
    const feedback = query('#settings-feedback')
    if (capturing) {
      await window.voiceHotkey.cancelShortcutCapture()
      endCapture()
    }

    const apiKey = query<HTMLInputElement>('#api-key')?.value.trim() ?? ''
    const update: SettingsUpdate = {
      shortcut: { keys: currentKeys() },
      holdDelayMs: Number(holdDelay?.value ?? 250),
      hotkeyEnabled: hotkeyEnabled?.checked ?? true,
      microphoneId: query<HTMLSelectElement>('#microphone')?.value ?? '',
      autoPaste: autoPaste?.checked ?? true,
      removeFillers: removeFillers?.checked ?? true,
      launchAtLogin: launchAtLogin?.checked ?? false,
      historyRetentionDays: Number(retention?.value ?? 0),
      ...(apiKey ? { apiKey } : {})
    }

    try {
      context.applySettings(await window.voiceHotkey.saveSettings(update))
      pendingKeys = null
      // Re-render so the key badge and shortcut chips reflect what was saved —
      // the old build left "Key required" on screen after a successful save.
      renderSettings(context)
      const savedFeedback = query('#settings-feedback')
      if (savedFeedback) {
        savedFeedback.textContent = 'Settings saved.'
        window.setTimeout(() => {
          if (savedFeedback.textContent === 'Settings saved.') savedFeedback.textContent = ''
        }, 2500)
      }
    } catch (error) {
      if (feedback) feedback.textContent = friendlyError(error)
    }
  })
}
