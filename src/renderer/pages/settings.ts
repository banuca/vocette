import type { AppContext } from '../app-context'
import { escapeHtml, friendlyError, keyChips } from '../dom'
import { chordLabel, keyLabel } from '../../shared/keycodes'
import {
  HOLD_DELAY_OPTIONS,
  SHORTCUT_PRESETS,
  chordEquals,
  validateChord
} from '../../shared/shortcuts'
import {
  LANGUAGE_OPTIONS,
  TRANSCRIPTION_MODELS,
  type PublicSettings,
  type SettingsUpdate
} from '../../shared/types'

/** Requesting the mic once per session is what makes device labels readable. */
let microphonePermissionRequested = false

const CUSTOM_MODEL_OPTION = '__custom__'
const MIC_TEST_DURATION_MS = 8000

function holdDelayLabel(ms: number): string {
  return ms === 0 ? 'Instantly' : `${ms} ms`
}

export interface SettingsView {
  apply(next: PublicSettings): void
  dispose(): void
}

interface MicTestAttempt {
  stream: MediaStream | null
  audioContext: AudioContext | null
  frame: number
  timeout: number | undefined
  cancelled: boolean
  cleaned: boolean
}

export function renderSettings(context: AppContext): SettingsView {
  context.setHeading('Settings', 'Set up your key, microphone, shortcut, and local history.')

  /** Fresh view of the settings; updated by `syncControlValues`. */
  let settings = context.settings
  /** Chord chosen but not yet saved. */
  let pendingKeys: number[] | null = null
  let capturing = false
  let releaseCaptureListener: (() => void) | null = null
  let micTestAttempt: MicTestAttempt | null = null
  let disposed = false

  const currentKeys = (): number[] => pendingKeys ?? settings.shortcut.keys
  const modelIsCustom = !TRANSCRIPTION_MODELS.includes(
    settings.model as (typeof TRANSCRIPTION_MODELS)[number]
  )

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
          <label class="field field-wide"><span>API endpoint <em>(optional)</em></span>
            <input id="api-endpoint" type="text" autocomplete="off" spellcheck="false" placeholder="https://api.openai.com/v1" value="${escapeHtml(settings.apiEndpoint)}" />
            <small>Leave empty for OpenAI. For another OpenAI-compatible provider, paste its base URL — for example <code>https://api.groq.com/openai/v1</code>, or <code>http://localhost:8080/v1</code> for a local transcription server.</small>
          </label>
          <label class="field"><span>Model</span>
            <select id="model">
              ${TRANSCRIPTION_MODELS.map(
                (model) => `<option value="${model}">${model}</option>`
              ).join('')}
              ${settings.apiEndpoint ? `<option value="${CUSTOM_MODEL_OPTION}">Custom model…</option>` : ''}
            </select>
            <input id="model-custom" class="model-custom-input ${modelIsCustom ? '' : 'is-hidden'}" type="text" spellcheck="false" placeholder="model name, e.g. whisper-large-v3" value="${modelIsCustom ? escapeHtml(settings.model) : ''}" />
          </label>
          <label class="field"><span>Language</span>
            <select id="language">
              ${LANGUAGE_OPTIONS.map(
                (option) =>
                  `<option value="${option.code}">${escapeHtml(option.label)}${option.code === 'auto' ? '' : ` (${option.code.toUpperCase()})`}</option>`
              ).join('')}
            </select>
          </label>
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
              <button class="secondary-button" id="mic-test" type="button">Test</button>
            </div>
            <div class="mic-meter" id="mic-meter"><div class="mic-meter-bar" id="mic-meter-bar"></div></div>
            <small id="microphone-feedback">Checking microphones…</small>
          </label>
        </div>

        <div class="toggle-list">
          <label class="toggle-row"><div><strong>Hold-to-talk enabled</strong><span>Turn the global shortcut off without quitting the app.</span></div><input id="hotkey-enabled" type="checkbox" /><i></i></label>
          <label class="toggle-row"><div><strong>Paste automatically</strong><span>Copy the transcript and press Ctrl + V in the active app.</span></div><input id="auto-paste" type="checkbox" /><i></i></label>
          <label class="toggle-row"><div><strong>Light cleanup</strong><span>Remove “um”, “uh”, “erm”, and repair spacing without rewriting you.</span></div><input id="remove-fillers" type="checkbox" /><i></i></label>
          <label class="toggle-row"><div><strong>Play sounds</strong><span>A short beep when recording starts, two when the transcript is ready.</span></div><input id="play-sounds" type="checkbox" /><i></i></label>
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
  const playSounds = query<HTMLInputElement>('#play-sounds')
  const launchAtLogin = query<HTMLInputElement>('#launch-at-login')
  const retention = query<HTMLSelectElement>('#history-retention')
  const modelSelect = query<HTMLSelectElement>('#model')
  const modelCustom = query<HTMLInputElement>('#model-custom')
  const languageSelect = query<HTMLSelectElement>('#language')
  const endpointInput = query<HTMLInputElement>('#api-endpoint')
  const keyBadge = query<HTMLElement>('#key-badge')
  const chips = query<HTMLSpanElement>('#shortcut-chips')
  const shortcutButton = query<HTMLButtonElement>('#shortcut-capture')
  const shortcutAction = query<HTMLSpanElement>('#shortcut-action')
  const shortcutFeedback = query<HTMLElement>('#shortcut-feedback')

  const syncControlValues = (next: PublicSettings): void => {
    settings = next
    if (holdDelay) holdDelay.value = String(next.holdDelayMs)
    if (hotkeyEnabled) hotkeyEnabled.checked = next.hotkeyEnabled
    if (autoPaste) autoPaste.checked = next.autoPaste
    if (removeFillers) removeFillers.checked = next.removeFillers
    if (playSounds) playSounds.checked = next.playSounds
    if (launchAtLogin) launchAtLogin.checked = next.launchAtLogin
    if (retention) retention.value = String(next.historyRetentionDays)
    if (languageSelect) languageSelect.value = next.language
    if (endpointInput) endpointInput.value = next.apiEndpoint
    if (keyBadge) {
      keyBadge.textContent = next.apiKeyConfigured ? 'Key configured' : 'Key required'
      keyBadge.className = `configured-badge ${next.apiKeyConfigured ? 'is-configured' : ''}`
    }
    paintChips(next.shortcut.keys)
    const custom = !TRANSCRIPTION_MODELS.includes(
      next.model as (typeof TRANSCRIPTION_MODELS)[number]
    )
    if (modelSelect) {
      // Rebuild the model options: the "Custom model…" entry only exists when
      // an endpoint is configured.
      modelSelect.replaceChildren(
        ...TRANSCRIPTION_MODELS.map((model) => new Option(model, model)),
        ...(next.apiEndpoint ? [new Option('Custom model…', CUSTOM_MODEL_OPTION)] : [])
      )
      modelSelect.value = custom ? CUSTOM_MODEL_OPTION : next.model
    }
    if (modelCustom) {
      modelCustom.classList.toggle('is-hidden', !custom)
      if (custom) modelCustom.value = next.model
    }
  }

  // --- Shortcut capture ---------------------------------------------------

  const paintChips = (keys: readonly number[]): void => {
    if (chips) chips.innerHTML = keyChips(keys.map(keyLabel))
  }

  // `syncControlValues` calls `paintChips`, so the initial sync must come
  // after both are initialised — calling it earlier threw a ReferenceError
  // (temporal dead zone), which killed every listener on the page: the Save
  // button looked fine but did nothing.
  syncControlValues(settings)

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

  // --- Model / language ---------------------------------------------------

  modelSelect?.addEventListener('change', () => {
    const custom = modelSelect.value === CUSTOM_MODEL_OPTION
    modelCustom?.classList.toggle('is-hidden', !custom)
    if (custom) modelCustom?.focus()
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

  // --- Microphone test ----------------------------------------------------

  const micMeter = query<HTMLElement>('#mic-meter')
  const micMeterBar = query<HTMLElement>('#mic-meter-bar')
  const micTestButton = query<HTMLButtonElement>('#mic-test')
  const microphoneSelect = query<HTMLSelectElement>('#microphone')
  const micFeedback = query<HTMLElement>('#microphone-feedback')

  const finishMicTest = (attempt: MicTestAttempt, feedback = 'Test finished.'): void => {
    if (attempt.cleaned) return
    attempt.cleaned = true
    attempt.cancelled = true
    if (attempt.timeout !== undefined) window.clearTimeout(attempt.timeout)
    attempt.timeout = undefined
    if (attempt.frame) cancelAnimationFrame(attempt.frame)
    attempt.frame = 0
    attempt.stream?.getTracks().forEach((track) => track.stop())
    attempt.stream = null
    if (attempt.audioContext) void attempt.audioContext.close().catch(() => undefined)
    attempt.audioContext = null

    if (micTestAttempt !== attempt) return
    micTestAttempt = null
    if (disposed) return
    if (micMeter) micMeter.classList.remove('is-active')
    if (micMeterBar) micMeterBar.style.width = '0%'
    if (micTestButton) micTestButton.textContent = 'Test'
    if (micFeedback) micFeedback.textContent = feedback
  }

  micTestButton?.addEventListener('click', async () => {
    if (micTestAttempt) {
      finishMicTest(micTestAttempt)
      return
    }

    // Claim the slot before microphone access begins so rapid clicks cannot
    // open overlapping streams.
    const attempt: MicTestAttempt = {
      stream: null,
      audioContext: null,
      frame: 0,
      timeout: undefined,
      cancelled: false,
      cleaned: false
    }
    micTestAttempt = attempt
    if (micTestButton) micTestButton.textContent = 'Cancel'
    if (micFeedback) micFeedback.textContent = 'Opening microphone…'

    try {
      const deviceId = microphoneSelect?.value ?? ''
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false
      })
      if (attempt.cancelled || disposed || micTestAttempt !== attempt) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      attempt.stream = stream

      const audioContext = new AudioContext()
      attempt.audioContext = audioContext
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 1024
      audioContext.createMediaStreamSource(stream).connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)

      const tick = (): void => {
        if (attempt.cancelled || micTestAttempt !== attempt) return
        analyser.getByteTimeDomainData(samples)
        let peak = 0
        for (const sample of samples) {
          const deviation = (sample - 128) / 128
          peak = Math.max(peak, Math.abs(deviation))
        }
        if (micMeterBar) micMeterBar.style.width = `${Math.min(100, Math.round(peak * 140))}%`
        attempt.frame = requestAnimationFrame(tick)
      }
      attempt.frame = requestAnimationFrame(tick)
      if (micMeter) micMeter.classList.add('is-active')
      if (micTestButton) micTestButton.textContent = 'Stop'
      if (micFeedback) micFeedback.textContent = 'Say something — the bar should move.'

      attempt.timeout = window.setTimeout(
        () => finishMicTest(attempt),
        MIC_TEST_DURATION_MS
      )
    } catch (error) {
      const message = friendlyError(error)
      finishMicTest(attempt, message)
    }
  })

  // --- Actions ------------------------------------------------------------

  query('#open-api-keys')?.addEventListener('click', () => {
    void window.voiceHotkey.openExternal('api-keys')
  })

  query('#clear-api-key')?.addEventListener('click', async () => {
    if (!window.confirm('Remove the saved API key from this computer?')) return
    const next = await window.voiceHotkey.clearApiKey()
    context.applySettings(next)
    syncControlValues(next)
    // The "Remove saved API key" link must disappear once there is no key.
    query('#clear-api-key')?.remove()
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
    const selectedModel = modelSelect?.value ?? settings.model
    const model =
      selectedModel === CUSTOM_MODEL_OPTION
        ? modelCustom?.value.trim() ?? ''
        : selectedModel

    const update: SettingsUpdate = {
      shortcut: { keys: currentKeys() },
      holdDelayMs: Number(holdDelay?.value ?? 250),
      hotkeyEnabled: hotkeyEnabled?.checked ?? true,
      microphoneId: microphoneSelect?.value ?? '',
      autoPaste: autoPaste?.checked ?? true,
      removeFillers: removeFillers?.checked ?? true,
      playSounds: playSounds?.checked ?? true,
      launchAtLogin: launchAtLogin?.checked ?? false,
      historyRetentionDays: Number(retention?.value ?? 0),
      model,
      language: languageSelect?.value ?? 'en',
      apiEndpoint: endpointInput?.value.trim() ?? '',
      ...(apiKey ? { apiKey } : {})
    }

    try {
      const next = await window.voiceHotkey.saveSettings(update)
      context.applySettings(next)
      pendingKeys = null
      // Update in place: a full re-render would drop the view reference the
      // shell holds and orphan the capture listener.
      syncControlValues(next)
      if (apiKey) {
        const keyInput = query<HTMLInputElement>('#api-key')
        if (keyInput) {
          keyInput.value = ''
          keyInput.placeholder = 'Enter a new key to replace the saved key'
        }
      }
      if (feedback) {
        feedback.textContent = 'Settings saved.'
        window.setTimeout(() => {
          if (feedback.textContent === 'Settings saved.') feedback.textContent = ''
        }, 2500)
      }
    } catch (error) {
      if (feedback) feedback.textContent = friendlyError(error)
    }
  })

  return {
    apply: (next) => {
      syncControlValues(next)
      // A tray toggle must not discard a chord the user picked but has not
      // saved yet — repaint the pending chips over the refreshed controls.
      if (pendingKeys) paintChips(pendingKeys)
    },
    dispose: () => {
      disposed = true
      releaseCaptureListener?.()
      releaseCaptureListener = null
      if (micTestAttempt) finishMicTest(micTestAttempt)
      if (capturing) {
        capturing = false
        // The main side owns the hook; make sure it is not left in capture
        // mode behind a page that no longer exists.
        void window.voiceHotkey.cancelShortcutCapture()
      }
    }
  }
}
