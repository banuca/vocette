import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../src/renderer/app-context'
import { available, type PlatformStatus } from '../src/shared/capabilities'
import type { PublicSettings } from '../src/shared/types'

/**
 * The vocabulary card, driven through the same render function the app uses.
 *
 * The existing Settings harness registers only the controls its own subject
 * needs, so without these the card silently exercises the null-guard path and
 * proves nothing. This file registers the card and asserts the behaviour that
 * no unit of pure logic can cover: that an unsaved list is not clobbered by a
 * settings change arriving from elsewhere, and that the note tells the truth
 * about which biasing channel the current model and endpoint will use.
 */

const TEST_PLATFORM: PlatformStatus = {
  platform: 'windows',
  session: null,
  pasteLabel: 'Ctrl + V',
  primaryModifierLabel: 'Ctrl',
  capabilities: {
    globalHold: available(),
    globalToggle: available(),
    targetVerification: available(),
    autoPaste: available(),
    launchAtLogin: available(),
    secureKeyStorage: available()
  }
}

class FakeClassList {
  add(): void {}
  remove(): void {}
  toggle(): void {}
}

class FakeElement {
  innerHTML = ''
  value = ''
  checked = false
  textContent: string | null = ''
  className = ''
  readonly dataset: Record<string, string> = {}
  readonly style = { width: '' }
  readonly classList = new FakeClassList()
  private readonly listeners = new Map<string, Array<(event: unknown) => unknown>>()

  constructor(private readonly elements?: Map<string, FakeElement>) {}

  querySelector<T>(selector: string): T | null {
    return (this.elements?.get(selector) ?? null) as T | null
  }

  querySelectorAll<T>(): T[] {
    return []
  }

  addEventListener(type: string, listener: (event: unknown) => unknown): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  emit(type: string): void {
    this.listeners.get(type)?.forEach((listener) => listener({ target: this }))
  }

  replaceChildren(): void {}
  add(): void {}
  focus(): void {}
  remove(): void {}
}

const SELECTORS = [
  '#hold-delay',
  '#hotkey-enabled',
  '#auto-paste',
  '#remove-fillers',
  '#play-sounds',
  '#launch-at-login',
  '#history-retention',
  '#model',
  '#model-custom',
  '#language',
  '#api-endpoint',
  '#api-key',
  '#api-key-session',
  '#key-badge',
  '#key-actions',
  '#key-scope',
  '#key-scope-note',
  '#shortcut-chips',
  '#shortcut-capture',
  '#shortcut-action',
  '#shortcut-feedback',
  '#shortcut-note',
  '#mode-hold',
  '#mode-toggle',
  '#mode-note',
  '#hotkey-note',
  '#auto-paste-note',
  '#launch-note',
  '#row-hotkey',
  '#row-auto-paste',
  '#row-launch',
  '#preset-row',
  '#microphone',
  '#microphone-feedback',
  '#refresh-microphones',
  '#mic-meter',
  '#mic-meter-bar',
  '#mic-test',
  '#open-api-keys',
  '#clear-history',
  '#save-settings',
  '#settings-feedback',
  '#vocabulary',
  '#vocabulary-note',
  '#vocabulary-badge'
]

function baseSettings(overrides: Partial<PublicSettings> = {}): PublicSettings {
  return {
    shortcut: { keys: [29, 42] },
    holdDelayMs: 250,
    recordingMode: 'hold',
    hotkeyEnabled: true,
    autoPaste: true,
    removeFillers: true,
    spokenCorrections: true,
    spokenFormatting: true,
    playSounds: false,
    launchAtLogin: false,
    theme: 'dark',
    microphoneId: '',
    historyRetentionDays: 0,
    model: 'gpt-transcribe',
    language: 'en',
    vocabulary: '',
    apiEndpoint: '',
    apiKeySource: 'none',
    ...overrides
  }
}

async function makeHarness(overrides: Partial<PublicSettings> = {}) {
  const elements = new Map<string, FakeElement>()
  SELECTORS.forEach((selector) => elements.set(selector, new FakeElement()))
  const content = new FakeElement(elements)
  const settings = baseSettings(overrides)

  const context: AppContext = {
    content: content as unknown as HTMLElement,
    settings,
    history: [],
    appInfo: { version: '0.4.0', platform: 'win32', platformStatus: TEST_PLATFORM },
    platform: TEST_PLATFORM,
    microphone: 'unknown',
    setHeading: vi.fn(),
    applySettings: vi.fn(),
    applyPlatform: vi.fn(),
    navigate: vi.fn(),
    reloadHistory: vi.fn(async () => undefined)
  }

  const saveSettings = vi.fn(async (update: Record<string, unknown>) =>
    baseSettings({ ...overrides, ...(update as Partial<PublicSettings>) })
  )

  vi.stubGlobal('window', {
    murmur: {
      onShortcutCapture: vi.fn(() => () => undefined),
      beginShortcutCapture: vi.fn(async () => undefined),
      cancelShortcutCapture: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      clearApiKey: vi.fn(async () => settings),
      clearSessionApiKey: vi.fn(async () => settings),
      clearHistory: vi.fn(async () => undefined),
      saveSettings
    },
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
    confirm: vi.fn(() => true)
  })
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn(), enumerateDevices: vi.fn(async () => []) }
  })
  vi.stubGlobal(
    'Option',
    class {
      constructor(
        public text: string,
        public value: string
      ) {}
    }
  )
  vi.stubGlobal('document', { createElement: () => new FakeElement() })

  const { renderSettings } = await import('../src/renderer/pages/settings')
  const view = renderSettings(context)

  const at = (selector: string): FakeElement => {
    const element = elements.get(selector)
    if (!element) throw new Error(`no fake element for ${selector}`)
    return element
  }

  return { view, at, saveSettings, settings }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the vocabulary card', () => {
  it('shows the saved list when the page opens', async () => {
    const { at } = await makeHarness({ vocabulary: 'Kirinde\nITU-T' })
    expect(at('#vocabulary').value).toBe('Kirinde\nITU-T')
    expect(at('#vocabulary-badge').textContent).toBe('2 terms')
  })

  it('says "No terms" for an empty list and does not claim it is configured', async () => {
    const { at } = await makeHarness()
    expect(at('#vocabulary-badge').textContent).toBe('No terms')
    expect(at('#vocabulary-badge').className).not.toContain('is-configured')
  })

  it('counts terms as they are typed, and marks them unsaved', async () => {
    const { at } = await makeHarness()
    const box = at('#vocabulary')
    box.value = 'Kirinde\nITU-T\nDataverse'
    box.emit('input')
    expect(at('#vocabulary-badge').textContent).toBe('3 terms — unsaved')
    // The green badge means "this is what Murmur will send", so unsaved text
    // must not wear it.
    expect(at('#vocabulary-badge').className).not.toContain('is-configured')
  })

  it('does not lose an unsaved list when settings change out of band', async () => {
    // The tray toggling the shortcut, or the theme switch saving, repaints
    // this page. That must not take back what the user has typed.
    const { view, at } = await makeHarness()
    const box = at('#vocabulary')
    box.value = 'Half a list I am still writing'
    box.emit('input')

    view.apply(baseSettings({ vocabulary: '', playSounds: true }))

    expect(box.value).toBe('Half a list I am still writing')
  })

  it('accepts the stored list again once the edit has been saved', async () => {
    const { view, at, saveSettings } = await makeHarness()
    const box = at('#vocabulary')
    box.value = 'Kirinde'
    box.emit('input')

    at('#save-settings').emit('click')
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ vocabulary: 'Kirinde' }))

    view.apply(baseSettings({ vocabulary: 'Kirinde\nITU-T' }))
    expect(box.value).toBe('Kirinde\nITU-T')
  })

  it('says the terms are sent, on both biasing paths', async () => {
    const { at } = await makeHarness({ vocabulary: 'Kirinde' })
    expect(at('#vocabulary-note').textContent).toContain('sent to your transcription provider')
  })

  it('names the keyword list for gpt-transcribe against OpenAI', async () => {
    const { at } = await makeHarness({ vocabulary: 'Kirinde' })
    expect(at('#vocabulary-note').textContent).toContain('dedicated keyword list')
  })

  it('names the prompt for a model with no keyword field', async () => {
    const { at } = await makeHarness({ vocabulary: 'Kirinde', model: 'whisper-1' })
    expect(at('#vocabulary-note').textContent).toContain('transcription prompt')
    expect(at('#vocabulary-note').textContent).not.toContain('dedicated keyword list')
  })

  it('changes the note when the model changes', async () => {
    const { at } = await makeHarness({ vocabulary: 'Kirinde' })
    const before = at('#vocabulary-note').textContent
    const model = at('#model')
    model.value = 'whisper-1'
    model.emit('change')
    expect(at('#vocabulary-note').textContent).not.toBe(before)
    expect(at('#vocabulary-note').textContent).toContain('transcription prompt')
  })

  it('drops the keyword claim once a custom endpoint is typed in', async () => {
    // The model name alone is not enough: a Groq or local server may reject
    // the field, so the request will use the prompt instead.
    const { at } = await makeHarness({ vocabulary: 'Kirinde' })
    expect(at('#vocabulary-note').textContent).toContain('dedicated keyword list')

    const endpoint = at('#api-endpoint')
    endpoint.value = 'https://api.groq.com/openai/v1'
    endpoint.emit('input')

    expect(at('#vocabulary-note').textContent).toContain('transcription prompt')
  })

  it('warns when the prompt budget cannot carry the whole list', async () => {
    const many = Array.from({ length: 100 }, (_, i) => `term-number-${i}`).join('\n')
    const { at } = await makeHarness({ vocabulary: many, model: 'whisper-1' })
    expect(at('#vocabulary-note').textContent).toContain('not being sent')
  })

  it('does not warn when every term fits', async () => {
    const { at } = await makeHarness({ vocabulary: 'Kirinde\nITU-T', model: 'whisper-1' })
    expect(at('#vocabulary-note').textContent).not.toContain('not being sent')
  })
})
