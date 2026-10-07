import { escapeHtml } from './dom'
import {
  MAX_POLISH_INSTRUCTIONS_CHARS,
  POLISH_BUDGETS_MS,
  POLISH_PRESETS,
  POLISH_STYLES,
  STYLE_LABELS,
  presetForEndpoint,
  type PolishBudgetMs,
  type PolishSettings,
  type PolishSettingsUpdate,
  type PolishStyle,
  type PolishTestResult
} from '../shared/polish'
import type { PublicSettings } from '../shared/types'

/** Shown whenever polish is on: what goes where. */
export const POLISH_PRIVACY =
  'Your transcript text (never audio) is sent to the provider above. Choose Ollama or ' +
  'LM Studio to keep it on this PC.'
export const POLISH_NOT_PRO = 'Part of Pro.'
export const POLISH_TEST_NEEDS_SAVE = 'Save settings first — the test uses what is saved.'
export const POLISH_TEST_SENDING = 'Sending one short sentence…'

const CUSTOM = 'custom'

/** The card, drawn after "Your words". */
export function polishCardMarkup(): string {
  const styles = POLISH_STYLES.map(
    (style) =>
      `<label class="mode-option"><input type="radio" name="polish-style" value="${style}" id="polish-style-${style}" /><div><strong>${STYLE_LABELS[style].name}</strong><span>${escapeHtml(STYLE_LABELS[style].description)}</span></div></label>`
  ).join('')
  const presets = POLISH_PRESETS.map(
    (preset) => `<option value="${preset.id}">${escapeHtml(preset.label)}</option>`
  ).join('')
  const budgets = POLISH_BUDGETS_MS.map(
    (ms) => `<option value="${ms}">${ms / 1000} s</option>`
  ).join('')
  return `
      <section class="settings-card polish-card" id="polish-card">
        <div class="settings-heading">
          <div><h2>AI polish</h2><p>Turns what you said into finished text, in the style you choose.</p></div>
          <span class="configured-badge" id="polish-badge" hidden>Pro</span>
        </div>
        <div class="toggle-list polish-switch">
          <label class="toggle-row" id="row-polish"><div><strong>Polish my dictation</strong><span>A language model rewrites each dictation before it is pasted. If it takes too long or its reply looks wrong, your text is pasted as it was.</span><small class="capability-note" id="polish-note" hidden></small></div><input id="polish-enabled" type="checkbox" /><i></i></label>
        </div>
        <div class="mode-choice polish-styles" role="radiogroup" aria-label="Polish style">${styles}</div>
        <label class="field field-wide"><span>Extra instructions <em>(optional)</em></span>
          <textarea id="polish-instructions" class="polish-instructions" rows="2" maxlength="${MAX_POLISH_INSTRUCTIONS_CHARS}" placeholder="e.g. British spelling; never use exclamation marks."></textarea>
        </label>
        <div class="form-grid polish-provider">
          <label class="field"><span>Provider</span><select id="polish-provider">${presets}<option value="${CUSTOM}">Custom</option></select></label>
          <label class="field"><span>Model</span><input id="polish-model" type="text" spellcheck="false" autocomplete="off" placeholder="model name" /></label>
          <label class="field field-wide" id="polish-endpoint-field"><span>Endpoint</span><input id="polish-endpoint" type="text" spellcheck="false" autocomplete="off" placeholder="https://… or http://localhost:…/v1" /></label>
          <label class="field field-wide" id="polish-key-field"><span>Key</span>
            <input id="polish-key" type="password" autocomplete="off" spellcheck="false" />
            <small id="polish-key-note"></small>
          </label>
          <label class="field"><span>Wait at most</span><select id="polish-budget">${budgets}</select></label>
        </div>
        <small class="field-note">If polishing takes longer, Vocette pastes your text unpolished and says so.</small>
        <div class="polish-test-row">
          <button class="secondary-button" id="polish-test" type="button">Test</button>
          <small class="connection-result" id="polish-test-result" aria-live="polite" hidden></small>
        </div>
        <p class="field-note polish-privacy" id="polish-privacy" hidden></p>
        <div class="key-actions" id="polish-key-actions"></div>
      </section>`
}

/** What the card needs from the preload bridge. */
export interface PolishCardApi {
  testPolish(): Promise<PolishTestResult>
  clearPolishKey(): Promise<PublicSettings>
}

export interface PolishCard {
  /** Paints the saved settings, unless the user is part-way through an edit. */
  apply(next: PublicSettings): void
  /** Pro or not: the switch and Test are Pro's; the rest can be set up any time. */
  applyPlan(pro: boolean): void
  /** What Save sends for this card. */
  collect(): { polish: PolishSettingsUpdate; polishKey?: string }
  /** Saved: the fields follow the store again, and the key box is emptied. */
  saved(next: PublicSettings): void
}

type Query = <T extends HTMLElement = HTMLElement>(selector: string) => T | null

export function createPolishCard(
  query: Query,
  api: PolishCardApi,
  initial: PublicSettings,
  pro: boolean,
  onSettings: (next: PublicSettings) => void
): PolishCard {
  const enabled = query<HTMLInputElement>('#polish-enabled')
  const note = query<HTMLElement>('#polish-note')
  const badge = query<HTMLElement>('#polish-badge')
  const instructions = query<HTMLTextAreaElement>('#polish-instructions')
  const provider = query<HTMLSelectElement>('#polish-provider')
  const model = query<HTMLInputElement>('#polish-model')
  const endpointField = query<HTMLElement>('#polish-endpoint-field')
  const endpoint = query<HTMLInputElement>('#polish-endpoint')
  const keyField = query<HTMLElement>('#polish-key-field')
  const key = query<HTMLInputElement>('#polish-key')
  const keyNote = query<HTMLElement>('#polish-key-note')
  const budget = query<HTMLSelectElement>('#polish-budget')
  const testButton = query<HTMLButtonElement>('#polish-test')
  const testLine = query<HTMLElement>('#polish-test-result')
  const privacy = query<HTMLElement>('#polish-privacy')
  const keyActions = query<HTMLElement>('#polish-key-actions')
  const styleInputs = POLISH_STYLES.map((style) => query<HTMLInputElement>(`#polish-style-${style}`))

  let saved: PolishSettings = initial.polish
  let isPro = pro
  /** Something typed or chosen here since the last save. */
  let dirty = false
  let testing = false
  let answer: { text: string; ok: boolean } | null = null

  const chosenStyle = (): PolishStyle => {
    const index = styleInputs.findIndex((input) => input?.checked)
    return POLISH_STYLES[index] ?? saved.style
  }

  /** Which fields the chosen provider needs. */
  const paintProvider = (): void => {
    const choice = provider?.value ?? CUSTOM
    const preset = POLISH_PRESETS.find((entry) => entry.id === choice) ?? null
    if (endpointField) endpointField.hidden = preset !== null
    const local = preset !== null && !preset.needsKey
    if (keyField) keyField.hidden = local
    if (key) {
      key.placeholder =
        saved.keySource === 'stored' ? 'Enter a new key to replace the saved one' : 'Paste a key'
    }
    if (keyNote) {
      keyNote.textContent =
        preset?.id === 'openai'
          ? 'Optional. Without one, your OpenAI transcription key is used — but only when transcription goes to OpenAI too.'
          : preset?.id === 'groq'
            ? 'Groq needs a key of its own.'
            : 'Only if the server needs one.'
    }
  }

  const paintKeyActions = (): void => {
    if (!keyActions) return
    keyActions.replaceChildren()
    if (saved.keySource !== 'stored') return
    const button = document.createElement('button')
    button.className = 'danger-link'
    button.type = 'button'
    button.textContent = 'Remove polish key'
    button.addEventListener('click', () => {
      void api.clearPolishKey().then((next) => {
        onSettings(next)
        saved = next.polish
        paintKeyActions()
        paintProvider()
      })
    })
    keyActions.append(button)
  }

  const paintPlan = (): void => {
    if (enabled) enabled.disabled = !isPro
    if (note) {
      note.textContent = isPro ? '' : POLISH_NOT_PRO
      note.hidden = isPro
    }
    if (badge) badge.hidden = isPro
  }

  const paintTest = (): void => {
    const blocked = dirty || (key?.value.trim() ?? '') !== ''
    if (testButton) {
      testButton.disabled = testing || blocked || !isPro
      testButton.textContent = testing ? 'Testing…' : 'Test'
    }
    if (!testLine) return
    const line = testing
      ? { text: POLISH_TEST_SENDING, tone: '' }
      : blocked
        ? { text: POLISH_TEST_NEEDS_SAVE, tone: '' }
        : answer
          ? { text: answer.text, tone: answer.ok ? ' is-connected' : ' is-failed' }
          : null
    const text = line?.text ?? ''
    if (testLine.textContent !== text) testLine.textContent = text
    testLine.hidden = line === null
    testLine.className = `connection-result${line?.tone ?? ''}`
  }

  const paintPrivacy = (): void => {
    if (!privacy) return
    const on = enabled?.checked ?? false
    privacy.textContent = on ? POLISH_PRIVACY : ''
    privacy.hidden = !on
  }

  const paintSaved = (next: PolishSettings): void => {
    if (enabled) enabled.checked = next.enabled
    styleInputs.forEach((input, index) => {
      if (input) input.checked = POLISH_STYLES[index] === next.style
    })
    if (instructions) instructions.value = next.instructions
    if (provider) provider.value = presetForEndpoint(next.endpoint)?.id ?? CUSTOM
    if (endpoint) endpoint.value = next.endpoint
    if (model) model.value = next.model
    if (budget) budget.value = String(next.budgetMs)
    paintProvider()
    paintKeyActions()
    paintPrivacy()
  }

  const edited = (): void => {
    dirty = true
    answer = null
    paintPrivacy()
    paintTest()
  }

  provider?.addEventListener('change', () => {
    const preset = POLISH_PRESETS.find((entry) => entry.id === provider.value)
    if (preset) {
      if (endpoint) endpoint.value = preset.endpoint
      if (model) model.value = preset.model
    }
    paintProvider()
    edited()
  })
  for (const control of [enabled, instructions, model, endpoint, key, budget, ...styleInputs]) {
    control?.addEventListener('input', edited)
    control?.addEventListener('change', edited)
  }

  testButton?.addEventListener('click', () => {
    if (testing) return
    testing = true
    answer = null
    paintTest()
    void api
      .testPolish()
      .then((result) => {
        answer = result.ok
          ? { ok: true, text: `Polished in ${result.ms} ms: “${result.text}”` }
          : { ok: false, text: result.error }
      })
      .catch(() => {
        answer = { ok: false, text: 'Polish could not be tested.' }
      })
      .finally(() => {
        testing = false
        paintTest()
      })
  })

  paintSaved(saved)
  paintPlan()
  paintTest()

  return {
    apply: (next) => {
      saved = next.polish
      if (!dirty) paintSaved(next.polish)
      else paintKeyActions()
      paintTest()
    },
    applyPlan: (next) => {
      isPro = next
      paintPlan()
      paintTest()
    },
    collect: () => {
      const typedKey = key?.value.trim() ?? ''
      const budgetMs = Number(budget?.value ?? saved.budgetMs)
      return {
        polish: {
          enabled: enabled?.checked ?? saved.enabled,
          style: chosenStyle(),
          instructions: instructions?.value ?? saved.instructions,
          endpoint: endpoint?.value.trim() ?? saved.endpoint,
          model: model?.value.trim() ?? saved.model,
          budgetMs: (POLISH_BUDGETS_MS as readonly number[]).includes(budgetMs)
            ? (budgetMs as PolishBudgetMs)
            : saved.budgetMs
        },
        ...(typedKey ? { polishKey: typedKey } : {})
      }
    },
    saved: (next) => {
      dirty = false
      saved = next.polish
      if (key) key.value = ''
      paintSaved(next.polish)
      paintTest()
    }
  }
}
