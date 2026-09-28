import type { AppContext, NavigationIntent } from '../app-context'
import { escapeHtml, friendlyError, keyChips } from '../dom'
import { createModelRow, localLanguageNote } from '../model-download'
import type { EngineStatus } from '../../shared/engine'
import {
  autoPasteSupported,
  clipboardOnlyReason,
  globalShortcutUsable,
  isAvailable,
  recordingModeIsForced,
  type Capability
} from '../../shared/capabilities'
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
  dictationIsBusy,
  type PublicSettings,
  type SettingsUpdate,
  type TranscriptionEngine,
  type WorkflowStatus
} from '../../shared/types'
import {
  MAX_PROMPT_TERM_CHARS,
  MAX_VOCABULARY_TERMS,
  MAX_VOCABULARY_TERM_CHARS,
  budgetPromptTerms,
  parseVocabulary,
  supportsKeywordList
} from '../../shared/vocabulary'
import {
  MAX_REPLACEMENT_RULES,
  MAX_SPOKEN_CHARS,
  MAX_WRITTEN_CHARS,
  parseReplacements
} from '../../shared/replacements'

/** Requesting the mic once per session is what makes device labels readable. */
let microphonePermissionRequested = false

/** How to write a rule. The count that follows it in the note is live. */
const REPLACEMENTS_HELP =
  'One rule per line: what you say => what you want. Use \\n for a line break, ' +
  "{date} or {time} for today's date or the time. Rules apply after cleanup, " +
  'match whole words, and ignore capitals.'

const CUSTOM_MODEL_OPTION = '__custom__'
const MIC_TEST_DURATION_MS = 8000

/** The Transcription card's subtitle; the cloud keeps the key's promise it always made. */
const LOCAL_SUMMARY = 'Where your speech becomes text.'
const CLOUD_SUMMARY =
  'Where your speech becomes text. Your key is encrypted by the operating system and never ' +
  'displayed again.'

function holdDelayLabel(ms: number): string {
  return ms === 0 ? 'Instantly' : `${ms} ms`
}

export interface SettingsView {
  apply(next: PublicSettings): void
  /** The speech model's row follows the download without redrawing the page. */
  applyEngine(next: EngineStatus): void
  /** Removing the model waits for a dictation to finish. */
  applyWorkflow(status: WorkflowStatus): void
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

export function renderSettings(
  context: AppContext,
  intent: NavigationIntent = {}
): SettingsView {
  context.setHeading('Settings', 'Set up transcription, your microphone, shortcut, and local history.')

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

  const capabilities = (): AppContext['platform']['capabilities'] =>
    context.platform.capabilities
  /** Secure storage unfit for a credential means the key stays in memory. */
  const storageUnusable = (): boolean => !isAvailable(capabilities().secureKeyStorage)

  const keyBadgeText = (source: PublicSettings['apiKeySource']): string =>
    source === 'stored' ? 'Key saved' : source === 'session' ? 'Key for this session' : 'Key required'

  const launchLabel =
    context.platform.platform === 'windows'
      ? 'Start with Windows'
      : context.platform.platform === 'macos'
        ? 'Open at login'
        : 'Start when I sign in'

  context.content.innerHTML = `
    <div class="settings-stack">
      <section class="settings-card">
        <div class="settings-heading">
          <div><h2>Transcription</h2><p id="transcription-summary"></p></div>
          <span class="configured-badge ${settings.apiKeySource !== 'none' ? 'is-configured' : ''}" id="key-badge">${keyBadgeText(settings.apiKeySource)}</span>
        </div>

        <div class="mode-choice engine-choice" role="radiogroup" aria-label="Where transcription runs">
          <label class="mode-option">
            <input type="radio" name="engine" value="local" id="engine-local" />
            <div><strong>On this PC</strong><span>Private and offline. Nothing is sent anywhere. Uses about 1 GB of memory while dictating, released after 5 minutes of rest.</span></div>
          </label>
          <label class="mode-option">
            <input type="radio" name="engine" value="cloud" id="engine-cloud" />
            <div><strong>Cloud, with your API key</strong><span>OpenAI, Groq, Azure or any OpenAI-compatible server. Audio is sent to that provider.</span></div>
          </label>
        </div>

        <div class="engine-local-fields" id="local-fields">
          <div class="model-row" id="model-row"></div>
        </div>
        <div class="form-grid">
          <div class="engine-cloud-fields" id="cloud-fields">
            <label class="field field-wide"><span>API key</span>
              <div class="password-row">
                <input id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="${settings.apiKeySource !== 'none' ? 'Enter a new key to replace the current key' : 'sk-…'}" />
                <button class="secondary-button" id="open-api-keys" type="button">Get a key</button>
              </div>
              <small>The app sends each completed recording directly to your provider using your key.</small>
            </label>
            <div class="field field-wide key-scope" id="key-scope">
              <label class="checkbox-row">
                <input id="api-key-session" type="checkbox" />
                <span>Keep this key for this session only</span>
              </label>
              <small id="key-scope-note"></small>
            </div>
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
          </div>
          <div class="field">
            <label class="field-label" for="language">Language</label>
            <select id="language" aria-describedby="language-note">
              ${LANGUAGE_OPTIONS.map(
                (option) =>
                  `<option value="${option.code}">${escapeHtml(option.label)}${option.code === 'auto' ? '' : ` (${option.code.toUpperCase()})`}</option>`
              ).join('')}
            </select>
            <small class="language-note" id="language-note" aria-live="polite" hidden></small>
          </div>
        </div>
        <div class="key-actions" id="key-actions"></div>
      </section>

      <section class="settings-card">
        <div class="settings-heading">
          <div><h2>Your words</h2><p>Names, acronyms and product terms Murmur should expect to hear.</p></div>
          <span class="configured-badge" id="vocabulary-badge"></span>
        </div>
        <label class="field field-wide"><span>Vocabulary</span>
          <textarea id="vocabulary" class="vocabulary-input" rows="6" spellcheck="false" autocomplete="off" aria-describedby="vocabulary-note" placeholder="Kirinde&#10;ITU-T&#10;Dataverse&#10;koffi"></textarea>
        </label>
        <small class="field-note" id="vocabulary-note" aria-live="polite"></small>
        <label class="field field-wide replacements-field"><span>Replacements and snippets</span>
          <textarea id="replacements" class="replacements-input" rows="6" spellcheck="false" autocomplete="off" aria-describedby="replacements-note" placeholder="itu =&gt; ITU&#10;console log =&gt; console.log()&#10;my email =&gt; name@example.com&#10;sign off =&gt; Best regards,\\nAlex&#10;today's date =&gt; {date}"></textarea>
        </label>
        <small class="field-note" id="replacements-note" aria-live="polite"></small>
      </section>

      <section class="settings-card">
        <div class="settings-heading"><div><h2>Recording</h2><p>How a dictation starts, and which microphone it uses.</p></div></div>

        <div class="mode-choice" role="radiogroup" aria-label="Recording mode">
          <label class="mode-option">
            <input type="radio" name="recording-mode" value="hold" id="mode-hold" />
            <div><strong>Hold to talk</strong><span>Hold the shortcut while you speak, release to finish.</span></div>
          </label>
          <label class="mode-option">
            <input type="radio" name="recording-mode" value="toggle" id="mode-toggle" />
            <div><strong>Press to start and stop</strong><span>One press begins recording, the next ends it.</span></div>
          </label>
        </div>
        <p class="capability-note" id="mode-note" hidden></p>

        <div class="shortcut-editor">
          <div class="shortcut-current">
            <span class="field-label">Shortcut</span>
            <button class="shortcut-button" id="shortcut-capture" type="button">
              <span class="chips" id="shortcut-chips">${keyChips(currentKeys().map(keyLabel))}</span>
              <span class="shortcut-action" id="shortcut-action">Change</span>
            </button>
            <small id="shortcut-feedback">Click Change, then hold the keys you want.</small>
            <p class="capability-note" id="shortcut-note" hidden></p>
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
              <select id="microphone"><option value="">System default microphone</option></select>
              <button class="icon-refresh" id="refresh-microphones" type="button" aria-label="Refresh microphones">↻</button>
              <button class="secondary-button" id="mic-test" type="button">Test</button>
            </div>
            <div class="mic-meter" id="mic-meter"><div class="mic-meter-bar" id="mic-meter-bar"></div></div>
            <small id="microphone-feedback">Checking microphones…</small>
          </label>
        </div>

        <div class="toggle-list">
          <label class="toggle-row" id="row-hotkey"><div><strong>Global shortcut enabled</strong><span>Turn the system-wide shortcut off without quitting the app.</span><small class="capability-note" id="hotkey-note" hidden></small></div><input id="hotkey-enabled" type="checkbox" /><i></i></label>
          <label class="toggle-row" id="row-auto-paste"><div><strong>Paste automatically</strong><span>Copy the transcript and send ${escapeHtml(context.platform.pasteLabel)} to the app you were using.</span><small class="capability-note" id="auto-paste-note" hidden></small></div><input id="auto-paste" type="checkbox" /><i></i></label>
          <label class="toggle-row"><div><strong>Remove filler words</strong><span>Drops “um”, “uh”, stutters like “I I”, and a filler “like” or “you know” set off by commas. Your own words are never rewritten.</span></div><input id="remove-fillers" type="checkbox" /><i></i></label>
          <label class="toggle-row"><div><strong>Follow spoken corrections</strong><span>Say “scratch that” to drop the last sentence, or fix a word as you go: “Tuesday, no sorry, Wednesday” becomes “Wednesday”. English.</span></div><input id="spoken-corrections" type="checkbox" /><i></i></label>
          <label class="toggle-row"><div><strong>Spoken line breaks</strong><span>Say “new line” or “new paragraph”. English.</span></div><input id="spoken-formatting" type="checkbox" /><i></i></label>
          <label class="toggle-row"><div><strong>Play sounds</strong><span>A short beep when recording starts, two when the transcript is ready.</span></div><input id="play-sounds" type="checkbox" /><i></i></label>
          <label class="toggle-row" id="row-launch"><div><strong>${escapeHtml(launchLabel)}</strong><span>Keep the shortcut ready after you sign in.</span><small class="capability-note" id="launch-note" hidden></small></div><input id="launch-at-login" type="checkbox" /><i></i></label>
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
  const spokenCorrections = query<HTMLInputElement>('#spoken-corrections')
  const spokenFormatting = query<HTMLInputElement>('#spoken-formatting')
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
  const modeHold = query<HTMLInputElement>('#mode-hold')
  const modeToggle = query<HTMLInputElement>('#mode-toggle')
  const sessionScope = query<HTMLInputElement>('#api-key-session')
  const keyActions = query<HTMLElement>('#key-actions')
  const vocabulary = query<HTMLTextAreaElement>('#vocabulary')
  const vocabularyNote = query<HTMLElement>('#vocabulary-note')
  const vocabularyBadge = query<HTMLElement>('#vocabulary-badge')
  const replacements = query<HTMLTextAreaElement>('#replacements')
  const replacementsNote = query<HTMLElement>('#replacements-note')
  const engineLocal = query<HTMLInputElement>('#engine-local')
  const engineCloud = query<HTMLInputElement>('#engine-cloud')
  const localFields = query<HTMLElement>('#local-fields')
  const cloudFields = query<HTMLElement>('#cloud-fields')
  const languageNote = query<HTMLElement>('#language-note')
  const transcriptionSummary = query<HTMLElement>('#transcription-summary')

  /**
   * The engine shown as chosen. It can run ahead of the saved one: the setup
   * card's "use your own API key instead" opens this page with the cloud
   * picked, and clicking either option picks it. Neither switches anything
   * until Save settings, like every other control here.
   */
  let chosenEngine: TranscriptionEngine = intent.engine ?? settings.engine
  /**
   * True while that choice differs from what is saved. An out-of-band repaint
   * must not take it back from under the fields it revealed — the promise
   * `vocabularyDirty` makes for the word list, made for the engine.
   */
  let engineDirty = chosenEngine !== settings.engine

  /**
   * On this PC the language only tunes cleanup — unless the model cannot
   * recognise it at all, which is a warning. Stated from the control, so it
   * is true before Save; the cloud has no such limit, so says nothing.
   */
  const paintLanguageNote = (): void => {
    if (!languageNote) return
    const note =
      chosenEngine === 'local'
        ? localLanguageNote(languageSelect?.value || settings.language)
        : null
    languageNote.textContent = note?.text ?? ''
    languageNote.hidden = note === null
    languageNote.className = `language-note${note?.warning ? ' is-warning' : ''}`
  }

  /** Shows the section for the chosen engine, and only that one. */
  const syncEngineChoice = (): void => {
    const local = chosenEngine === 'local'
    if (engineLocal) engineLocal.checked = local
    if (engineCloud) engineCloud.checked = !local
    if (localFields) localFields.hidden = !local
    if (cloudFields) cloudFields.hidden = local
    // A key is none of the on-device engine's business; "Key required" over
    // it would simply be untrue.
    if (keyBadge) keyBadge.hidden = local
    if (keyActions) keyActions.hidden = local
    if (transcriptionSummary) {
      transcriptionSummary.textContent = local ? LOCAL_SUMMARY : CLOUD_SUMMARY
    }
    paintLanguageNote()
  }

  /**
   * True once the user has typed in the box and not yet saved.
   *
   * Settings can change out of band — the tray toggles the shortcut, the theme
   * switch saves — and each of those repaints this page. Without this flag,
   * `syncControlValues` would overwrite a half-written vocabulary with the
   * saved one. The shortcut editor already makes the same promise through
   * `pendingKeys`; this is the same promise for a free-text field long
   * enough to hurt when it is lost.
   */
  let vocabularyDirty = false

  /**
   * The count and the mechanism, stated from the control values rather than
   * from saved settings, so the line is true while the user is still typing.
   *
   * Honesty matters more here than brevity: the two biasing channels behave
   * differently, and a user whose terms are riding the prompt should know that
   * most of a long list will not be sent.
   */
  const paintVocabularyNote = (): void => {
    if (!vocabularyNote && !vocabularyBadge) return
    const terms = parseVocabulary(vocabulary?.value ?? '')
    const selected = modelSelect?.value ?? settings.model
    const model =
      selected === CUSTOM_MODEL_OPTION ? modelCustom?.value.trim() ?? '' : selected
    const endpoint = endpointInput?.value.trim() ?? settings.apiEndpoint

    if (vocabularyBadge) {
      const count =
        terms.length === 0 ? 'No terms' : terms.length === 1 ? '1 term' : `${terms.length} terms`
      // Never claim saved state for text that has not been saved: the green
      // badge means "this is what Murmur will send", not "this is typed".
      vocabularyBadge.textContent = vocabularyDirty ? `${count} — unsaved` : count
      vocabularyBadge.className = `configured-badge ${
        terms.length > 0 && !vocabularyDirty ? 'is-configured' : ''
      }`
    }
    if (!vocabularyNote) return

    const limits = `One term per line, up to ${MAX_VOCABULARY_TERMS} terms of ${MAX_VOCABULARY_TERM_CHARS} characters. They are sent to your transcription provider with every dictation.`
    if (supportsKeywordList(model, endpoint)) {
      vocabularyNote.textContent = `${limits} ${model} takes them as a dedicated keyword list, so every term is used.`
      return
    }
    const sent = budgetPromptTerms(terms).length
    const dropped = terms.length - sent
    const fit =
      dropped > 0
        ? ` Only the first ${sent} fit, so ${dropped} ${dropped === 1 ? 'is' : 'are'} not being sent — shorten the list.`
        : ''
    // textContent, not innerHTML: the model name is user input and must not be
    // parsed as markup, and must not be double-escaped either.
    vocabularyNote.textContent = `${limits} ${model || 'This model'} has no keyword field, so they are added to the transcription prompt, which has room for about ${MAX_PROMPT_TERM_CHARS} characters of terms.${fit}`
  }

  /**
   * The same promise as `vocabularyDirty`, for the rules box: a list of rules
   * and snippets is the other free-text field long enough to hurt when an
   * out-of-band repaint takes it back.
   */
  let replacementsDirty = false

  /**
   * How to write a rule, then how many the box holds right now — counted by
   * the parser the dictation uses, so the number is the one that will apply.
   * A line that cannot be a rule is reported rather than left to fail in
   * silence; the reason covers every way a line can fail, because the count
   * does not say which one it was.
   */
  const paintReplacementsNote = (): void => {
    if (!replacementsNote) return
    const { rules, ignored } = parseReplacements(replacements?.value ?? '')
    const count =
      rules.length === 0 ? 'No rules yet' : rules.length === 1 ? '1 rule' : `${rules.length} rules`
    const full = rules.length >= MAX_REPLACEMENT_RULES ? ', the most Murmur will use' : ''
    const skipped =
      ignored === 0
        ? ''
        : ` — ${ignored} ${ignored === 1 ? 'line' : 'lines'} ignored: a rule needs => with something on both sides, at most ${MAX_SPOKEN_CHARS} characters before it and ${MAX_WRITTEN_CHARS.toLocaleString('en-GB')} after`
    // textContent, not innerHTML: the rules are user input, and `=>` must
    // read as typed. Written only when it changes, because the note is a live
    // region and would otherwise be read out in full on every keystroke.
    const text = `${REPLACEMENTS_HELP} ${count}${full}${skipped}.`
    if (replacementsNote.textContent !== text) replacementsNote.textContent = text
  }

  const syncControlValues = (next: PublicSettings): void => {
    settings = next
    if (holdDelay) holdDelay.value = String(next.holdDelayMs)
    if (hotkeyEnabled) hotkeyEnabled.checked = next.hotkeyEnabled
    if (autoPaste) autoPaste.checked = next.autoPaste
    if (removeFillers) removeFillers.checked = next.removeFillers
    if (spokenCorrections) spokenCorrections.checked = next.spokenCorrections
    if (spokenFormatting) spokenFormatting.checked = next.spokenFormatting
    if (playSounds) playSounds.checked = next.playSounds
    if (launchAtLogin) launchAtLogin.checked = next.launchAtLogin
    if (retention) retention.value = String(next.historyRetentionDays)
    if (languageSelect) languageSelect.value = next.language
    if (endpointInput) endpointInput.value = next.apiEndpoint
    if (keyBadge) {
      keyBadge.textContent = keyBadgeText(next.apiKeySource)
      keyBadge.className = `configured-badge ${next.apiKeySource !== 'none' ? 'is-configured' : ''}`
    }
    if (modeHold) modeHold.checked = next.recordingMode === 'hold'
    if (modeToggle) modeToggle.checked = next.recordingMode === 'toggle'
    renderKeyActions(next)
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
    // An unsaved edit outranks the stored value, exactly as a pending chord
    // outranks the stored shortcut.
    if (vocabulary && !vocabularyDirty) vocabulary.value = next.vocabulary
    paintVocabularyNote()
    if (replacements && !replacementsDirty) replacements.value = next.replacements
    paintReplacementsNote()
    // An unsaved engine choice outranks the stored one, as a pending chord
    // does — until the store catches up with it.
    if (chosenEngine === next.engine) engineDirty = false
    if (!engineDirty) chosenEngine = next.engine
    syncEngineChoice()
  }

  // --- Capability-driven state --------------------------------------------

  /**
   * Removing a key means different things depending on where it lives, so the
   * actions are rebuilt from the current source rather than guessed at once
   * when the page is drawn.
   */
  const renderKeyActions = (next: PublicSettings): void => {
    if (!keyActions) return
    keyActions.replaceChildren()
    const action = (label: string, run: () => Promise<void>): void => {
      const button = document.createElement('button')
      button.className = 'danger-link'
      button.type = 'button'
      button.textContent = label
      button.addEventListener('click', () => void run())
      keyActions.append(button)
    }
    if (next.apiKeySource === 'session') {
      action('Forget the session key', async () => {
        const updated = await window.murmur.clearSessionApiKey()
        context.applySettings(updated)
        syncControlValues(updated)
      })
    }
    if (next.apiKeySource === 'stored') {
      action('Remove saved API key', async () => {
        if (!window.confirm('Remove the saved API key from this computer?')) return
        const feedback = query('#settings-feedback')
        try {
          const updated = await window.murmur.clearApiKey()
          context.applySettings(updated)
          syncControlValues(updated)
        } catch (error) {
          if (feedback) feedback.textContent = friendlyError(error)
        }
      })
    }
  }

  const note = (element: HTMLElement | null, capability: Capability | null): void => {
    if (!element) return
    const text = capability && capability.state !== 'available' ? capability.reason : ''
    element.textContent = text
    element.hidden = text === ''
  }

  /**
   * Reflects what this system will actually allow.
   *
   * A control that cannot do anything is disabled and says why, instead of
   * silently doing nothing when it is used. The stored preference underneath
   * is never rewritten — only what is shown.
   */
  const syncCapabilities = (): void => {
    const map = capabilities()
    const shortcutUsable = globalShortcutUsable(map)

    if (hotkeyEnabled) hotkeyEnabled.disabled = !shortcutUsable
    note(query<HTMLElement>('#hotkey-note'), shortcutUsable ? null : map.globalToggle)

    if (autoPaste) autoPaste.disabled = !autoPasteSupported(map)
    const pasteNote = query<HTMLElement>('#auto-paste-note')
    if (pasteNote) {
      const reason = clipboardOnlyReason(map)
      pasteNote.textContent = reason ?? ''
      pasteNote.hidden = reason === null
    }

    if (launchAtLogin) launchAtLogin.disabled = !isAvailable(map.launchAtLogin)
    note(query<HTMLElement>('#launch-note'), map.launchAtLogin)

    // Holding needs a key-up the platform may never report.
    const holdPossible = isAvailable(map.globalHold)
    if (modeHold) modeHold.disabled = !holdPossible
    const modeNote = query<HTMLElement>('#mode-note')
    if (modeNote) {
      const forced = recordingModeIsForced(settings.recordingMode, map)
      const text = forced
        ? `${map.globalHold.reason} Your preference is kept for a system that can.`
        : !holdPossible
          ? map.globalHold.reason
          : ''
      modeNote.textContent = text
      modeNote.hidden = text === ''
    }

    // A desktop-registered shortcut cannot be recorded from live keystrokes.
    const canCapture = shortcutUsable && context.platform.session !== 'wayland'
    if (shortcutButton) shortcutButton.disabled = !canCapture
    const shortcutNote = query<HTMLElement>('#shortcut-note')
    if (shortcutNote) {
      const text = !shortcutUsable
        ? map.globalToggle.reason
        : canCapture
          ? ''
          : 'This desktop cannot record a shortcut from your keystrokes. Choose one of ' +
            'the quick picks instead — it must include a letter, number or function key.'
      shortcutNote.textContent = text
      shortcutNote.hidden = text === ''
    }

    // The offer of a session-only key is the whole answer to a system with no
    // usable keyring, so it is forced on and explained rather than merely
    // failing when Save is pressed.
    const unusable = storageUnusable()
    if (sessionScope) {
      if (unusable) sessionScope.checked = true
      sessionScope.disabled = unusable
    }
    const scopeNote = query<HTMLElement>('#key-scope-note')
    if (scopeNote) {
      scopeNote.textContent = unusable
        ? map.secureKeyStorage.reason
        : 'Leave this off to keep the key on this computer, encrypted by the operating system.'
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
  syncCapabilities()

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

  releaseCaptureListener = window.murmur.onShortcutCapture(({ keys, done }) => {
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
      await window.murmur.cancelShortcutCapture()
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
    await window.murmur.beginShortcutCapture()
  })

  query<HTMLDivElement>('#preset-row')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.preset-button')
    if (!button?.dataset.keys) return
    if (capturing) {
      void window.murmur.cancelShortcutCapture()
      endCapture()
    }
    commitCapture(button.dataset.keys.split(',').map(Number))
  })

  // --- Engine and the speech model ----------------------------------------

  const chooseEngine = (engine: TranscriptionEngine): void => {
    chosenEngine = engine
    engineDirty = engine !== settings.engine
    syncEngineChoice()
  }
  engineLocal?.addEventListener('change', () => {
    if (engineLocal.checked) chooseEngine('local')
  })
  engineCloud?.addEventListener('change', () => {
    if (engineCloud.checked) chooseEngine('cloud')
  })

  // The same row as History's setup step, drawn by the same module. Choosing
  // this PC while the model is missing is allowed: the row offers the
  // download, and the Record button says what it is waiting for.
  const modelHost = query<HTMLElement>('#model-row')
  const modelRow = modelHost
    ? createModelRow(modelHost, {
        variant: 'settings',
        bridge: window.murmur,
        onStatus: (status) => context.applyEngine(status),
        confirm: (message) => window.confirm(message)
      })
    : null
  modelRow?.setDictating(dictationIsBusy(context.workflow.phase))
  modelRow?.apply(context.engine)

  // --- Model / language ---------------------------------------------------

  modelSelect?.addEventListener('change', () => {
    const custom = modelSelect.value === CUSTOM_MODEL_OPTION
    modelCustom?.classList.toggle('is-hidden', !custom)
    if (custom) modelCustom?.focus()
    // Which biasing channel the terms take depends on the model, so the note
    // under the vocabulary box is part of this control's state.
    paintVocabularyNote()
  })

  modelCustom?.addEventListener('input', paintVocabularyNote)

  // Whether the on-device model can hear the language is part of this
  // control's state too.
  languageSelect?.addEventListener('change', paintLanguageNote)

  // --- Vocabulary ---------------------------------------------------------

  vocabulary?.addEventListener('input', () => {
    vocabularyDirty = true
    paintVocabularyNote()
  })

  // Whether the keyword field is available depends on the endpoint as well as
  // the model, so the note is part of this control's state too.
  endpointInput?.addEventListener('input', paintVocabularyNote)

  // --- Replacements -------------------------------------------------------

  replacements?.addEventListener('input', () => {
    replacementsDirty = true
    paintReplacementsNote()
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
    void window.murmur.openExternal('api-keys')
  })

  query('#clear-history')?.addEventListener('click', async () => {
    if (!window.confirm('Permanently delete every saved transcript? This cannot be undone.')) return
    const feedback = query('#settings-feedback')
    try {
      await window.murmur.clearHistory()
      await context.reloadHistory()
      if (feedback) feedback.textContent = 'Transcript history deleted.'
    } catch (error) {
      if (feedback) feedback.textContent = friendlyError(error)
    }
  })

  query('#save-settings')?.addEventListener('click', async () => {
    const feedback = query('#settings-feedback')
    if (capturing) {
      await window.murmur.cancelShortcutCapture()
      endCapture()
    }

    const apiKey = query<HTMLInputElement>('#api-key')?.value.trim() ?? ''
    const selectedModel = modelSelect?.value ?? settings.model
    const model =
      selectedModel === CUSTOM_MODEL_OPTION
        ? modelCustom?.value.trim() ?? ''
        : selectedModel

    const update: SettingsUpdate = {
      // Saved like everything else. Choosing this PC before the model is
      // there is allowed; the model row and the Record button say what is
      // still missing.
      engine: chosenEngine,
      shortcut: { keys: currentKeys() },
      holdDelayMs: Number(holdDelay?.value ?? 250),
      // Saved as chosen. A platform that cannot hold downgrades it at use
      // time, so the preference survives a move to one that can.
      recordingMode: modeToggle?.checked ? 'toggle' : 'hold',
      hotkeyEnabled: hotkeyEnabled?.checked ?? true,
      microphoneId: microphoneSelect?.value ?? '',
      autoPaste: autoPaste?.checked ?? true,
      removeFillers: removeFillers?.checked ?? true,
      spokenCorrections: spokenCorrections?.checked ?? true,
      spokenFormatting: spokenFormatting?.checked ?? true,
      playSounds: playSounds?.checked ?? true,
      launchAtLogin: launchAtLogin?.checked ?? false,
      historyRetentionDays: Number(retention?.value ?? 0),
      model,
      language: languageSelect?.value ?? 'en',
      vocabulary: vocabulary?.value ?? '',
      replacements: replacements?.value ?? '',
      apiEndpoint: endpointInput?.value.trim() ?? '',
      ...(apiKey
        ? { apiKey, apiKeyScope: sessionScope?.checked ? ('session' as const) : ('persist' as const) }
        : {})
    }

    try {
      const next = await window.murmur.saveSettings(update)
      context.applySettings(next)
      pendingKeys = null
      // Saved: the boxes may now be repainted from the stored values again,
      // and a clamp is shown by repainting them from what actually persisted.
      vocabularyDirty = false
      replacementsDirty = false
      engineDirty = false
      // Update in place: a full re-render would drop the view reference the
      // shell holds and orphan the capture listener.
      syncControlValues(next)
      if (apiKey) {
        const keyInput = query<HTMLInputElement>('#api-key')
        if (keyInput) {
          keyInput.value = ''
          keyInput.placeholder = 'Enter a new key to replace the current key'
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
      syncCapabilities()
      // A tray toggle must not discard a chord the user picked but has not
      // saved yet — repaint the pending chips over the refreshed controls.
      if (pendingKeys) paintChips(pendingKeys)
    },
    applyEngine: (next) => modelRow?.apply(next),
    applyWorkflow: (status) => modelRow?.setDictating(dictationIsBusy(status.phase)),
    dispose: () => {
      disposed = true
      releaseCaptureListener?.()
      releaseCaptureListener = null
      if (micTestAttempt) finishMicTest(micTestAttempt)
      if (capturing) {
        capturing = false
        // The main side owns the hook; make sure it is not left in capture
        // mode behind a page that no longer exists.
        void window.murmur.cancelShortcutCapture()
      }
    }
  }
}
