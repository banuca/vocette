import type { AppContext, NavigationIntent } from '../app-context'
import { BLUETOOTH_HEADSET_NOTE, looksLikeBluetoothHeadset } from '../bluetooth-headset'
import { escapeHtml, friendlyError, keyChips } from '../dom'
import { replacementsPlanNote, vocabularyPlanNote } from '../licence-text'
import { createModelRow, localLanguageNote } from '../model-download'
import type { EngineStatus } from '../../shared/engine'
import { vocabularyTermLimit } from '../../shared/entitlement'
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
  type LicenceStatus,
  type PasteLastStatus,
  type PublicSettings,
  type SettingsUpdate,
  type TranscriptionEngine,
  type WorkflowStatus
} from '../../shared/types'
import {
  MAX_KEYWORD_TERMS,
  MAX_PROMPT_TERM_CHARS,
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

/** What happens to the terms after recognition, on every engine. */
const VOCABULARY_CORRECTION_NOTE =
  'Murmur corrects near-misses of these words after it hears you — “data verse” becomes “Dataverse”.'

/** How to write a rule. The count that follows it in the note is live. */
const REPLACEMENTS_HELP =
  'One rule per line: what you say => what you want. Use \\n for a line break, ' +
  "{date} or {time} for today's date or the time. Rules apply after cleanup, " +
  'match whole words, and ignore capitals.'

const CUSTOM_MODEL_OPTION = '__custom__'
const MIC_TEST_DURATION_MS = 8000

/**
 * Why "Start listening as soon as the shortcut is held" is off where the
 * shortcut works but no key is watched: a desktop that registers the shortcut
 * itself (Wayland) says nothing until it has fired.
 */
const INSTANT_CAPTURE_NEEDS_KEYS =
  'This desktop tells Murmur about the shortcut only once it has fired, so listening cannot start any earlier.'

/** The Transcription card's subtitle; the cloud keeps the key's promise it always made. */
const LOCAL_SUMMARY = 'Where your speech becomes text.'
const CLOUD_SUMMARY =
  'Where your speech becomes text. Your key is encrypted by the operating system and never ' +
  'displayed again.'

/** Test connection's line while its one request is out. */
const TEST_SENDING = 'Sending one second of silence…'
/** Why Test connection waits while the cloud fields hold unsaved changes. */
const TEST_NEEDS_SAVE = 'Save settings first — the test uses the saved endpoint, model and key.'

/**
 * The badge over the card, from saved settings: a key in use, wherever it is
 * held — or, without one, whether the saved endpoint is OpenAI, which always
 * needs a key, or a server of the user's own, which may need none.
 */
function keyBadgeState(next: PublicSettings): { text: string; configured: boolean } {
  if (next.apiKeySource === 'stored') return { text: 'Key saved', configured: true }
  if (next.apiKeySource === 'session') return { text: 'Key for this session', configured: true }
  return next.apiEndpoint.trim() !== ''
    ? { text: 'No key needed for this server', configured: true }
    : { text: 'Key required', configured: false }
}

function holdDelayLabel(ms: number): string {
  return ms === 0 ? 'Instantly' : `${ms} ms`
}

export interface SettingsView {
  apply(next: PublicSettings): void
  /** The speech model's row follows the download without redrawing the page. */
  applyEngine(next: EngineStatus): void
  /** Removing the model waits for a dictation to finish. */
  applyWorkflow(status: WorkflowStatus): void
  /** The notes under the lists say how much of each the plan in force uses. */
  applyLicence(next: LicenceStatus): void
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

  const initialBadge = keyBadgeState(settings)

  const launchLabel =
    context.platform.platform === 'windows'
      ? 'Start with Windows'
      : context.platform.platform === 'macos'
        ? 'Open at login'
        : 'Start when I sign in'

  /**
   * Alt + Shift + V is registered on Windows only, for now. Elsewhere the row
   * is not drawn at all: a switch for something that cannot happen here would
   * be a promise the app does not keep.
   */
  const pasteLastOffered = context.platform.platform === 'windows'
  const pasteLastRow = pasteLastOffered
    ? '<label class="toggle-row" id="row-paste-last"><div><strong>Paste last dictation with Alt + Shift + V</strong><span>Handy when a paste went to the wrong place.</span><small class="capability-note" id="paste-last-note" hidden></small></div><input id="paste-last-shortcut" type="checkbox" /><i></i></label>'
    : ''

  context.content.innerHTML = `
    <div class="settings-stack">
      <section class="settings-card">
        <div class="settings-heading">
          <div><h2>Transcription</h2><p id="transcription-summary"></p></div>
          <span class="configured-badge ${initialBadge.configured ? 'is-configured' : ''}" id="key-badge">${initialBadge.text}</span>
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
            <div class="field field-wide">
              <label class="field-label" for="api-endpoint">API endpoint <em>(optional)</em></label>
              <div class="inline-control">
                <input id="api-endpoint" type="text" autocomplete="off" spellcheck="false" placeholder="https://api.openai.com/v1" value="${escapeHtml(settings.apiEndpoint)}" aria-describedby="api-endpoint-help" />
                <button class="secondary-button" id="test-connection" type="button" aria-describedby="connection-result">Test connection</button>
              </div>
              <small class="connection-result" id="connection-result" aria-live="polite" hidden></small>
              <small id="api-endpoint-help">Leave empty for OpenAI. For another OpenAI-compatible provider, paste its base URL — for example <code>https://api.groq.com/openai/v1</code>, or <code>http://localhost:8080/v1</code> for a local transcription server. With an endpoint here the key is optional: a server of your own may not need one.</small>
            </div>
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
          <div class="field">
            <label class="field-label" for="microphone">Microphone</label>
            <div class="inline-control">
              <select id="microphone" aria-describedby="microphone-feedback microphone-note"><option value="">System default microphone</option></select>
              <button class="icon-refresh" id="refresh-microphones" type="button" aria-label="Refresh microphones">↻</button>
              <button class="secondary-button" id="mic-test" type="button">Test</button>
            </div>
            <div class="mic-meter" id="mic-meter"><div class="mic-meter-bar" id="mic-meter-bar"></div></div>
            <small id="microphone-feedback">Checking microphones…</small>
            <small class="microphone-note" id="microphone-note" aria-live="polite" hidden></small>
          </div>
        </div>

        <div class="toggle-list">
          <label class="toggle-row" id="row-hotkey"><div><strong>Global shortcut enabled</strong><span>Turn the system-wide shortcut off without quitting the app.</span><small class="capability-note" id="hotkey-note" hidden></small></div><input id="hotkey-enabled" type="checkbox" /><i></i></label>
          <label class="toggle-row" id="row-instant-capture"><div><strong>Start listening as soon as the shortcut is held</strong><span>Helps catch your first word when you start speaking straight away. The microphone opens once the keys have been held for a moment, and anything captured before recording starts is thrown away unheard if you were pressing a different shortcut.</span><small class="capability-note" id="instant-capture-note" hidden></small></div><input id="instant-capture" type="checkbox" /><i></i></label>
          <label class="toggle-row" id="row-auto-paste"><div><strong>Paste automatically</strong><span>Copy the transcript and send ${escapeHtml(context.platform.pasteLabel)} to the app you were using.</span><small class="capability-note" id="auto-paste-note" hidden></small></div><input id="auto-paste" type="checkbox" /><i></i></label>
          <label class="toggle-row" id="row-restore-clipboard"><div><strong>Put my clipboard back</strong><span>After pasting, Murmur restores what you had copied. Turn off to keep each transcript on the clipboard.</span><small class="capability-note" id="restore-clipboard-note" hidden></small></div><input id="restore-clipboard" type="checkbox" /><i></i></label>
          ${pasteLastRow}
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
  const instantCapture = query<HTMLInputElement>('#instant-capture')
  const autoPaste = query<HTMLInputElement>('#auto-paste')
  const restoreClipboard = query<HTMLInputElement>('#restore-clipboard')
  const pasteLastShortcut = query<HTMLInputElement>('#paste-last-shortcut')
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
  const apiKeyInput = query<HTMLInputElement>('#api-key')
  const testButton = query<HTMLButtonElement>('#test-connection')
  const testLine = query<HTMLElement>('#connection-result')
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
   * most of a long list will not be sent. The on-device engine has neither
   * channel, so for it the note describes only the correction.
   */
  const paintVocabularyNote = (): void => {
    if (!vocabularyNote && !vocabularyBadge) return
    const terms = parseVocabulary(vocabulary?.value ?? '')
    // What a dictation uses on the plan in force: the first terms, up to its
    // limit. The list itself is never cut, so the badge counts all of it.
    const plan = context.licence.plan
    const limit = vocabularyTermLimit(plan !== 'free')
    const inUse = terms.slice(0, limit)
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

    const format = `One term per line, up to ${limit} terms of ${MAX_VOCABULARY_TERM_CHARS} characters.`
    // Said only when the plan changes what is used: a list inside Free's
    // limit is the same on every plan, and hears nothing about Pro.
    const planNote = vocabularyPlanNote(plan, terms.length)
    const lead = planNote ? `${format} ${planNote}` : format
    const describe = (): string => {
      // True of every engine: the correction runs on this computer, after
      // recognition. For the on-device engine it is the whole mechanism —
      // that engine takes no prompt, and nothing is sent anywhere.
      if (settings.engine === 'local') return `${lead} ${VOCABULARY_CORRECTION_NOTE}`
      const limits = `${lead} They are sent to your transcription provider with every dictation.`
      if (supportsKeywordList(model, endpoint)) {
        // One request carries no more keywords than it always did; a longer
        // Pro list still corrects near-misses after recognition.
        const keywords =
          inUse.length > MAX_KEYWORD_TERMS
            ? `${model} takes the first ${MAX_KEYWORD_TERMS} as a dedicated keyword list, and the rest still correct near-misses.`
            : `${model} takes them as a dedicated keyword list, so every term is used.`
        return `${limits} ${keywords} ${VOCABULARY_CORRECTION_NOTE}`
      }
      const sent = budgetPromptTerms(inUse).length
      const dropped = inUse.length - sent
      const fit =
        dropped > 0
          ? ` Only the first ${sent} fit, so ${dropped} ${dropped === 1 ? 'is' : 'are'} not being sent — shorten the list.`
          : ''
      return `${limits} ${model || 'This model'} has no keyword field, so they are added to the transcription prompt, which has room for about ${MAX_PROMPT_TERM_CHARS} characters of terms.${fit} ${VOCABULARY_CORRECTION_NOTE}`
    }
    // textContent, not innerHTML: the model name is user input and must not be
    // parsed as markup, and must not be double-escaped either. Written only
    // when it changes: the note is a live region, and a repaint that changes
    // nothing — the window coming back into focus — must not read it out again.
    const text = describe()
    if (vocabularyNote.textContent !== text) vocabularyNote.textContent = text
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
    const skipped =
      ignored === 0
        ? ''
        : `${ignored} ${ignored === 1 ? 'line' : 'lines'} ignored: a rule needs => with something on both sides, at most ${MAX_SPOKEN_CHARS} characters before it and ${MAX_WRITTEN_CHARS.toLocaleString('en-GB')} after`
    // A list longer than Free's limit hears how much of it the plan uses, in
    // place of the plain count, so the number is said once. Every rule stays
    // in the box whatever the plan.
    const planNote = replacementsPlanNote(context.licence.plan, rules.length)
    let text: string
    if (planNote) {
      text = `${REPLACEMENTS_HELP} ${planNote}${skipped ? ` ${skipped}.` : ''}`
    } else {
      const count =
        rules.length === 0 ? 'No rules yet' : rules.length === 1 ? '1 rule' : `${rules.length} rules`
      const full = rules.length >= MAX_REPLACEMENT_RULES ? ', the most Murmur will use' : ''
      text = `${REPLACEMENTS_HELP} ${count}${full}${skipped ? ` — ${skipped}` : ''}.`
    }
    // textContent, not innerHTML: the rules are user input, and `=>` must
    // read as typed. Written only when it changes, because the note is a live
    // region and would otherwise be read out in full on every keystroke.
    if (replacementsNote.textContent !== text) replacementsNote.textContent = text
  }

  /** True while Test connection's one request is out. */
  let testing = false
  /**
   * The last answer, and the saved connection it was about. It stays on show
   * through repaints and other saves, until that connection changes.
   */
  let testAnswer: { text: string; ok: boolean; about: string } | null = null

  /** What an answer is about: where the request goes, which model, and whether a key goes too. */
  const savedConnection = (): string =>
    JSON.stringify([settings.apiEndpoint, settings.model, settings.apiKeySource])

  /** The model the controls name, as Save would store it. */
  const modelFromControls = (): string => {
    const selected = modelSelect?.value ?? settings.model
    return selected === CUSTOM_MODEL_OPTION ? modelCustom?.value.trim() ?? '' : selected
  }

  /**
   * True while the endpoint, model or key fields hold something unsaved. The
   * test sends only saved settings — the saved key goes nowhere but the saved
   * endpoint — so rather than test something other than what is on screen, it
   * waits for Save and says so.
   */
  const connectionUnsaved = (): boolean =>
    (endpointInput?.value.trim() ?? settings.apiEndpoint) !== settings.apiEndpoint ||
    modelFromControls() !== settings.model ||
    (apiKeyInput?.value.trim() ?? '') !== ''

  /** The button and the line under the endpoint, from where the test stands. */
  const paintConnectionTest = (): void => {
    if (testAnswer && testAnswer.about !== savedConnection()) testAnswer = null
    const unsaved = connectionUnsaved()
    if (testButton) {
      testButton.disabled = testing || unsaved
      testButton.textContent = testing ? 'Testing…' : 'Test connection'
    }
    if (!testLine) return
    const line = testing
      ? { text: TEST_SENDING, tone: '' }
      : unsaved
        ? { text: TEST_NEEDS_SAVE, tone: '' }
        : testAnswer
          ? { text: testAnswer.text, tone: testAnswer.ok ? ' is-connected' : ' is-failed' }
          : null
    const text = line?.text ?? ''
    // Written only when it changes: the line is a live region, and every
    // keystroke in the endpoint repaints it.
    if (testLine.textContent !== text) testLine.textContent = text
    testLine.hidden = line === null
    testLine.className = `connection-result${line?.tone ?? ''}`
  }

  const syncControlValues = (next: PublicSettings): void => {
    settings = next
    if (holdDelay) holdDelay.value = String(next.holdDelayMs)
    if (hotkeyEnabled) hotkeyEnabled.checked = next.hotkeyEnabled
    if (instantCapture) instantCapture.checked = next.instantCapture
    if (autoPaste) autoPaste.checked = next.autoPaste
    if (restoreClipboard) restoreClipboard.checked = next.restoreClipboard
    if (pasteLastShortcut) pasteLastShortcut.checked = next.pasteLastShortcut
    if (removeFillers) removeFillers.checked = next.removeFillers
    if (spokenCorrections) spokenCorrections.checked = next.spokenCorrections
    if (spokenFormatting) spokenFormatting.checked = next.spokenFormatting
    if (playSounds) playSounds.checked = next.playSounds
    if (launchAtLogin) launchAtLogin.checked = next.launchAtLogin
    if (retention) retention.value = String(next.historyRetentionDays)
    if (languageSelect) languageSelect.value = next.language
    if (endpointInput) endpointInput.value = next.apiEndpoint
    if (keyBadge) {
      const badge = keyBadgeState(next)
      keyBadge.textContent = badge.text
      keyBadge.className = `configured-badge ${badge.configured ? 'is-configured' : ''}`
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
    // What is saved decides whether the last answer still applies, and the
    // fields just repainted from it decide whether the test must wait.
    paintConnectionTest()
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
    // Nothing is borrowed where nothing is pasted, so the clipboard switch has
    // nothing to do: disabled for the same reason, given in the same words.
    if (restoreClipboard) restoreClipboard.disabled = !autoPasteSupported(map)
    const restoreNote = query<HTMLElement>('#restore-clipboard-note')
    if (restoreNote) {
      const reason = clipboardOnlyReason(map)
      restoreNote.textContent = reason ?? ''
      restoreNote.hidden = reason === null
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

    // Listening early needs the key going down, which only a watched keyboard
    // reports. Without one the switch could do nothing, so it says why; the
    // saved choice underneath is kept for a session that can.
    if (instantCapture) instantCapture.disabled = !holdPossible
    const instantNote = query<HTMLElement>('#instant-capture-note')
    if (instantNote) {
      const text = holdPossible
        ? ''
        : shortcutUsable
          ? INSTANT_CAPTURE_NEEDS_KEYS
          : map.globalToggle.reason
      instantNote.textContent = text
      instantNote.hidden = text === ''
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

  /**
   * Says so when Alt + Shift + V is switched on but not in force. Asked of the
   * main process rather than inferred from the setting, because the usual
   * reason is another app that already owns the combination — and a switch
   * that shows as on while doing nothing is the failure to avoid.
   */
  const paintPasteLastNote = async (): Promise<void> => {
    const pasteLastNote = query<HTMLElement>('#paste-last-note')
    if (!pasteLastShortcut || !pasteLastNote) return
    let status: PasteLastStatus
    try {
      status = await window.murmur.getPasteLastStatus()
    } catch {
      // Unknown is not the same as refused: say nothing rather than guess.
      return
    }
    if (disposed) return
    const text =
      settings.pasteLastShortcut && !status.pasteLastRegistered
        ? 'Alt + Shift + V is in use by another app.'
        : ''
    pasteLastNote.textContent = text
    pasteLastNote.hidden = text === ''
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
  void paintPasteLastNote()

  const setFeedback =(text: string, tone: 'muted' | 'warn' | 'error' = 'muted'): void => {
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

  // --- Test connection ----------------------------------------------------

  // Each of these can make the fields differ from what is saved, which is
  // all the test will send.
  endpointInput?.addEventListener('input', paintConnectionTest)
  apiKeyInput?.addEventListener('input', paintConnectionTest)
  modelSelect?.addEventListener('change', paintConnectionTest)
  modelCustom?.addEventListener('input', paintConnectionTest)

  testButton?.addEventListener('click', async () => {
    if (testing || connectionUnsaved()) return
    testing = true
    const about = savedConnection()
    paintConnectionTest()
    let answer: { text: string; ok: boolean }
    try {
      const result = await window.murmur.testTranscription()
      answer = result.ok
        ? {
            ok: true,
            text: `Connected — the server answered in ${result.ms.toLocaleString('en-GB')} ms`
          }
        : { ok: false, text: result.error }
    } catch (error) {
      answer = { ok: false, text: friendlyError(error) }
    }
    testing = false
    if (disposed) return
    testAnswer = { ...answer, about }
    paintConnectionTest()
  })

  // --- Microphones --------------------------------------------------------

  /**
   * The operating system's name for each microphone last listed, by device
   * id. The `default` entry is kept here although the picker leaves it out:
   * its name is the only way to know which device "Windows default
   * microphone" will open.
   */
  let microphoneLabels = new Map<string, string>()

  /**
   * Opening a Bluetooth headset's microphone drops the user's headphones to
   * call quality until it closes, so the note says so while one is chosen —
   * before Save as well as after. With no name to go on (access not granted
   * yet, or a saved microphone that is not connected) it stays hidden rather
   * than guess. It sits outside the picker's <label>, as the Language note
   * does: inside, its three sentences would become part of the picker's
   * accessible name.
   */
  const paintMicrophoneNote = (): void => {
    const select = query<HTMLSelectElement>('#microphone')
    const microphoneNote = query<HTMLElement>('#microphone-note')
    if (!select || !microphoneNote) return
    // "Windows default microphone" is the empty value; the OS lists the
    // device it stands for under the id `default`.
    const label = microphoneLabels.get(select.value || 'default') ?? ''
    const text = looksLikeBluetoothHeadset(label) ? BLUETOOTH_HEADSET_NOTE : ''
    // Written only when it changes: the note is a live region, and a refresh
    // that finds the same headset should not read it out again.
    if (microphoneNote.textContent !== text) microphoneNote.textContent = text
    microphoneNote.hidden = text === ''
  }

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
      // Replaced together with the list, so the note and the picker never
      // disagree about which microphones exist.
      microphoneLabels = new Map(devices.map((device) => [device.deviceId, device.label] as const))

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
      paintMicrophoneNote()

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
  query('#microphone')?.addEventListener('change', paintMicrophoneNote)

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
      // Kept as saved when it cannot apply here: the switch is only disabled.
      instantCapture: instantCapture?.checked ?? settings.instantCapture,
      microphoneId: microphoneSelect?.value ?? '',
      autoPaste: autoPaste?.checked ?? true,
      restoreClipboard: restoreClipboard?.checked ?? true,
      // Not drawn on other desktops, where the saved choice is kept as it is.
      pasteLastShortcut: pasteLastShortcut?.checked ?? settings.pasteLastShortcut,
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
      // Saving is what registers or releases Alt + Shift + V.
      void paintPasteLastNote()
      if (apiKey) {
        const keyInput = query<HTMLInputElement>('#api-key')
        if (keyInput) {
          keyInput.value = ''
          keyInput.placeholder = 'Enter a new key to replace the current key'
        }
      }
      // The key box has just been emptied, so the test need not wait for it.
      paintConnectionTest()
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
    // Read from the context, which the shell has already updated; the trial
    // can end while this page is open.
    applyLicence: () => {
      paintVocabularyNote()
      paintReplacementsNote()
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
        void window.murmur.cancelShortcutCapture()
      }
    }
  }
}
