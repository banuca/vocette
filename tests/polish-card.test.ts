import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  POLISH_NOT_PRO,
  POLISH_PRIVACY,
  POLISH_TEST_NEEDS_SAVE,
  createPolishCard,
  polishCardMarkup
} from '../src/renderer/polish-card'
import { DEFAULT_POLISH, type PolishSettings, type PolishTestResult } from '../src/shared/polish'
import type { PublicSettings } from '../src/shared/types'

/** Just enough of an element for the card: values, flags, text and listeners. */
class FakeElement {
  value = ''
  checked = false
  disabled = false
  hidden = false
  placeholder = ''
  className = ''
  textContent: string | null = ''
  children: FakeElement[] = []
  private readonly listeners = new Map<string, Array<() => void>>()

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  emit(type: string): void {
    this.listeners.get(type)?.forEach((listener) => listener())
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = children
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children)
  }
}

const IDS = [
  'polish-enabled',
  'polish-note',
  'polish-badge',
  'polish-instructions',
  'polish-provider',
  'polish-model',
  'polish-endpoint-field',
  'polish-endpoint',
  'polish-key-field',
  'polish-key',
  'polish-key-note',
  'polish-budget',
  'polish-test',
  'polish-test-result',
  'polish-privacy',
  'polish-key-actions',
  'polish-style-clean',
  'polish-style-professional',
  'polish-style-casual',
  'polish-style-notes'
]

function settingsWith(polish: Partial<PolishSettings> = {}): PublicSettings {
  return { polish: { ...DEFAULT_POLISH, keySource: 'none', ...polish } } as PublicSettings
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function mount(polish: Partial<PolishSettings> = {}, pro = true) {
  const elements = new Map(IDS.map((id) => [`#${id}`, new FakeElement()]))
  const at = (id: string): FakeElement => {
    const element = elements.get(`#${id}`)
    if (!element) throw new Error(`no ${id}`)
    return element
  }
  const testPolish = vi.fn(
    async (): Promise<PolishTestResult> => ({
      ok: true,
      text: 'This is a test of the polish.',
      ms: 640,
      error: null
    })
  )
  const clearPolishKey = vi.fn(async () => settingsWith({ ...polish, keySource: 'none' }))
  const onSettings = vi.fn()
  const card = createPolishCard(
    (selector) => (elements.get(selector) ?? null) as never,
    { testPolish, clearPolishKey },
    settingsWith(polish),
    pro,
    onSettings
  )
  return { card, at, testPolish, clearPolishKey, onSettings }
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => new FakeElement() })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the AI polish card', () => {
  it('is drawn with a switch, four styles, a provider list and a time limit', () => {
    const html = polishCardMarkup()
    expect(html).toContain('<h2>AI polish</h2>')
    expect(html).toContain('<strong>Polish my dictation</strong>')
    for (const style of ['Clean', 'Professional', 'Casual', 'Notes']) {
      expect(html).toContain(`<strong>${style}</strong>`)
    }
    expect(html).toContain('OpenAI (uses your OpenAI key)')
    expect(html).toContain('Ollama on this PC')
    expect(html).toContain('LM Studio on this PC')
    expect(html).toContain('<option value="custom">Custom</option>')
    expect(html).toContain('<option value="4000">4 s</option>')
    expect(html).toContain('If polishing takes longer, Vocette pastes your text unpolished and says so.')
  })

  it('shows what is saved, and names the preset it belongs to', () => {
    const { at } = mount({ enabled: true, style: 'casual', endpoint: 'http://localhost:11434/v1', model: 'llama3.2:3b' })
    expect(at('polish-enabled').checked).toBe(true)
    expect(at('polish-style-casual').checked).toBe(true)
    expect(at('polish-style-clean').checked).toBe(false)
    expect(at('polish-provider').value).toBe('ollama')
    expect(at('polish-model').value).toBe('llama3.2:3b')
    // A preset fills the endpoint itself, and a model on this PC needs no key.
    expect(at('polish-endpoint-field').hidden).toBe(true)
    expect(at('polish-key-field').hidden).toBe(true)
    expect(at('polish-privacy').hidden).toBe(false)
    expect(at('polish-privacy').textContent).toBe(POLISH_PRIVACY)
  })

  it('fills the endpoint and model from a preset, and shows both for Custom', () => {
    const { at, card } = mount()
    at('polish-provider').value = 'groq'
    at('polish-provider').emit('change')
    expect(at('polish-endpoint').value).toBe('https://api.groq.com/openai/v1')
    expect(at('polish-model').value).toBe('llama-3.1-8b-instant')
    expect(at('polish-key-field').hidden).toBe(false)
    expect(at('polish-key-note').textContent).toBe('Groq needs a key of its own.')

    at('polish-provider').value = 'custom'
    at('polish-provider').emit('change')
    expect(at('polish-endpoint-field').hidden).toBe(false)
    expect(card.collect().polish.endpoint).toBe('https://api.groq.com/openai/v1')
  })

  it('hands Save every field, and the key only when one was typed', () => {
    const { at, card } = mount()
    at('polish-enabled').checked = true
    at('polish-style-professional').checked = true
    at('polish-style-clean').checked = false
    at('polish-instructions').value = 'British spelling.'
    at('polish-budget').value = '8000'
    expect(card.collect()).toEqual({
      polish: {
        enabled: true,
        style: 'professional',
        instructions: 'British spelling.',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
        budgetMs: 8000
      }
    })
    at('polish-key').value = '  sk-polish  '
    expect(card.collect().polishKey).toBe('sk-polish')
  })

  it('is Pro’s: without it the switch and Test are off, with a note and a badge', () => {
    const { at, card } = mount({}, false)
    expect(at('polish-enabled').disabled).toBe(true)
    expect(at('polish-note').hidden).toBe(false)
    expect(at('polish-note').textContent).toBe(POLISH_NOT_PRO)
    expect(at('polish-badge').hidden).toBe(false)
    expect(at('polish-test').disabled).toBe(true)

    card.applyPlan(true)
    expect(at('polish-enabled').disabled).toBe(false)
    expect(at('polish-note').hidden).toBe(true)
    expect(at('polish-badge').hidden).toBe(true)
    expect(at('polish-test').disabled).toBe(false)
  })

  it('tests only what is saved, and says what came back', async () => {
    const { at, card, testPolish } = mount()
    at('polish-model').value = 'gpt-4.1'
    at('polish-model').emit('input')
    expect(at('polish-test').disabled).toBe(true)
    expect(at('polish-test-result').textContent).toBe(POLISH_TEST_NEEDS_SAVE)

    card.saved(settingsWith({ model: 'gpt-4.1' }))
    expect(at('polish-test').disabled).toBe(false)
    at('polish-test').emit('click')
    await flush()
    expect(testPolish).toHaveBeenCalledTimes(1)
    expect(at('polish-test-result').textContent).toBe(
      'Polished in 640 ms: “This is a test of the polish.”'
    )
    expect(at('polish-test-result').className).toBe('connection-result is-connected')
  })

  it('keeps an edit in progress when the saved settings are repainted', () => {
    const { at, card } = mount()
    at('polish-instructions').value = 'Half typed'
    at('polish-instructions').emit('input')
    card.apply(settingsWith({ instructions: 'Something else' }))
    expect(at('polish-instructions').value).toBe('Half typed')
  })

  it('offers to remove a saved key, and repaints once it is gone', async () => {
    const { at, clearPolishKey, onSettings } = mount({ keySource: 'stored' })
    const [remove] = at('polish-key-actions').children
    expect(remove?.textContent).toBe('Remove polish key')
    remove?.emit('click')
    await flush()
    expect(clearPolishKey).toHaveBeenCalledTimes(1)
    expect(onSettings).toHaveBeenCalledTimes(1)
    expect(at('polish-key-actions').children).toEqual([])
  })
})
