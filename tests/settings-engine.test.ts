import { afterEach, describe, expect, it, vi } from 'vitest'
import { licenceStatus } from './fixtures/licence-status'
import type { AppContext, NavigationIntent } from '../src/renderer/app-context'
import { available, type PlatformStatus } from '../src/shared/capabilities'
import {
  MODEL_NOT_READY_REASON,
  REMOVE_WHILE_DICTATING,
  type EngineStatus,
  type ModelState
} from '../src/shared/engine'
import type { PublicSettings, WorkflowStatus } from '../src/shared/types'

/**
 * The Transcription card, driven through the same render function the app
 * uses: the engine choice, the section each choice reveals, the speech
 * model's row, and the language note. The choice is a saved setting, so it
 * must be painted from the store, survive a repaint while unsaved, and go
 * back on Save.
 */

const TOTAL = 670_478_772

function engineStatus(state: ModelState, patch: Partial<EngineStatus['model']> = {}): EngineStatus {
  const ready = state === 'installed'
  return {
    engine: 'local',
    model: {
      id: 'parakeet-tdt-0.6b-v3-int8',
      state,
      receivedBytes: ready ? TOTAL : 0,
      totalBytes: TOTAL,
      error: null,
      ...patch
    },
    ready,
    notReadyReason: ready ? null : MODEL_NOT_READY_REASON
  }
}

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
  hidden = false
  disabled = false
  textContent: string | null = ''
  className = ''
  placeholder = ''
  readonly dataset: Record<string, string> = {}
  readonly style = { width: '' }
  readonly classList = new FakeClassList()
  readonly attributes = new Map<string, string>()
  private readonly listeners = new Map<string, Array<(event: unknown) => unknown>>()

  constructor(private readonly elements?: Map<string, FakeElement>) {}

  querySelector<T>(selector: string): T | null {
    return (this.elements?.get(selector) ?? null) as T | null
  }

  querySelectorAll<T>(): T[] {
    return []
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  addEventListener(type: string, listener: (event: unknown) => unknown): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  emit(type: string): void {
    if (type === 'click' && this.disabled) return
    this.listeners.get(type)?.forEach((listener) => listener({ target: this }))
  }

  replaceChildren(): void {}
  append(): void {}
  add(): void {}
  focus(): void {}
  remove(): void {}
}

/** The model row's host: it holds only the parts its markup actually has. */
class FakeRowHost extends FakeElement {
  private readonly parts = new Map<string, FakeElement>()

  override querySelector<T>(selector: string): T | null {
    const name = /^\[data-model="([a-z]+)"\]$/u.exec(selector)?.[1]
    if (!name || !this.innerHTML.includes(`data-model="${name}"`)) return null
    const part = this.parts.get(name) ?? new FakeElement()
    this.parts.set(name, part)
    return part as T
  }

  part(name: string): FakeElement {
    const element = this.querySelector<FakeElement>(`[data-model="${name}"]`)
    if (!element) throw new Error(`the model row has no ${name}`)
    return element
  }
}

const SELECTORS = [
  '#hold-delay',
  '#hotkey-enabled',
  '#auto-paste',
  '#remove-fillers',
  '#spoken-corrections',
  '#spoken-formatting',
  '#play-sounds',
  '#launch-at-login',
  '#history-retention',
  '#model',
  '#model-custom',
  '#language',
  '#language-note',
  '#api-endpoint',
  '#api-key',
  '#api-key-session',
  '#key-badge',
  '#key-actions',
  '#key-scope-note',
  '#engine-local',
  '#engine-cloud',
  '#local-fields',
  '#cloud-fields',
  '#transcription-summary',
  '#save-settings',
  '#settings-feedback',
  '#vocabulary',
  '#vocabulary-note',
  '#vocabulary-badge',
  '#replacements',
  '#replacements-note'
]

function baseSettings(overrides: Partial<PublicSettings> = {}): PublicSettings {
  return {
    engine: 'local',
    shortcut: { keys: [29, 42] },
    holdDelayMs: 250,
    recordingMode: 'hold',
    hotkeyEnabled: true,
    instantCapture: true,
    autoPaste: true,
    restoreClipboard: true,
    pasteLastShortcut: true,
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
    replacements: '',
    apiEndpoint: '',
    apiKeySource: 'none',
    ...overrides
  }
}

async function makeHarness(
  options: {
    settings?: Partial<PublicSettings>
    engine?: EngineStatus
    workflow?: WorkflowStatus
    intent?: NavigationIntent
  } = {}
) {
  const elements = new Map<string, FakeElement>()
  SELECTORS.forEach((selector) => elements.set(selector, new FakeElement()))
  const rowHost = new FakeRowHost()
  elements.set('#model-row', rowHost)
  const content = new FakeElement(elements)
  const settings = baseSettings(options.settings)

  const applyEngine = vi.fn<(next: EngineStatus) => void>()
  const context: AppContext = {
    content: content as unknown as HTMLElement,
    settings,
    history: [],
    appInfo: { version: '0.4.0', platform: 'win32', platformStatus: TEST_PLATFORM },
    platform: TEST_PLATFORM,
    engine: options.engine ?? engineStatus('missing'),
    workflow: options.workflow ?? { phase: 'idle', message: 'Ready' },
    microphone: 'unknown',
    licence: licenceStatus(),
    setHeading: vi.fn(),
    applySettings: vi.fn(),
    applyPlatform: vi.fn(),
    applyEngine,
    applyLicence: vi.fn(),
    navigate: vi.fn(),
    reloadHistory: vi.fn(async () => undefined)
  }

  const saveSettings = vi.fn(async (update: Record<string, unknown>) =>
    baseSettings({ ...options.settings, ...(update as Partial<PublicSettings>) })
  )
  const downloadModel = vi.fn(async () => engineStatus('downloading'))

  vi.stubGlobal('window', {
    murmur: {
      onShortcutCapture: vi.fn(() => () => undefined),
      beginShortcutCapture: vi.fn(async () => undefined),
      cancelShortcutCapture: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      clearApiKey: vi.fn(async () => settings),
      clearSessionApiKey: vi.fn(async () => settings),
      clearHistory: vi.fn(async () => undefined),
      downloadModel,
      cancelModelDownload: vi.fn(async () => engineStatus('partial')),
      removeModel: vi.fn(async () => engineStatus('missing')),
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
  const view = renderSettings(context, options.intent)

  const at = (selector: string): FakeElement => {
    const element = elements.get(selector)
    if (!element) throw new Error(`no fake element for ${selector}`)
    return element
  }

  /** Picks an engine the way a click on its option card does. */
  const choose = (engine: 'local' | 'cloud'): void => {
    at('#engine-local').checked = engine === 'local'
    at('#engine-cloud').checked = engine === 'cloud'
    at(engine === 'local' ? '#engine-local' : '#engine-cloud').emit('change')
  }

  const save = async (): Promise<void> => {
    at('#save-settings').emit('click')
    await new Promise<void>((resolve) => setImmediate(resolve))
  }

  return { view, at, content, rowHost, choose, save, saveSettings, downloadModel, applyEngine }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Which of the two sections is on show. */
function shown(at: (selector: string) => FakeElement): 'local' | 'cloud' | 'both' | 'neither' {
  const local = !at('#local-fields').hidden
  const cloud = !at('#cloud-fields').hidden
  return local && cloud ? 'both' : local ? 'local' : cloud ? 'cloud' : 'neither'
}

describe('the Transcription card', () => {
  it('offers the two engines as a choice styled like the recording mode', async () => {
    const { content } = await makeHarness()
    expect(content.innerHTML).toContain('<h2>Transcription</h2>')
    expect(content.innerHTML).toContain('<strong>On this PC</strong>')
    expect(content.innerHTML).toContain(
      'Private and offline. Nothing is sent anywhere. Uses about 1 GB of memory while ' +
        'dictating, released after 5 minutes of rest.'
    )
    expect(content.innerHTML).toContain('<strong>Cloud, with your API key</strong>')
    expect(content.innerHTML).toContain(
      'OpenAI, Groq, Azure or any OpenAI-compatible server. Audio is sent to that provider.'
    )
    expect(content.innerHTML).toContain('class="mode-choice engine-choice"')
    expect(content.innerHTML).not.toContain('Transcription API')
  })

  it('shows only the on-device section to a user of this PC', async () => {
    const { at } = await makeHarness({ settings: { engine: 'local' } })
    expect(at('#engine-local').checked).toBe(true)
    expect(at('#engine-cloud').checked).toBe(false)
    expect(shown(at)).toBe('local')
    // A key has nothing to do with this engine, so no badge demands one.
    expect(at('#key-badge').hidden).toBe(true)
    expect(at('#key-actions').hidden).toBe(true)
    expect(at('#transcription-summary').textContent).toBe('Where your speech becomes text.')
  })

  it('shows only the cloud fields, as before, to a cloud user', async () => {
    const { at } = await makeHarness({ settings: { engine: 'cloud', apiKeySource: 'stored' } })
    expect(at('#engine-cloud').checked).toBe(true)
    expect(shown(at)).toBe('cloud')
    expect(at('#key-badge').hidden).toBe(false)
    expect(at('#key-badge').textContent).toBe('Key saved')
    expect(at('#language-note').hidden).toBe(true)
    expect(at('#transcription-summary').textContent).toContain(
      'Your key is encrypted by the operating system'
    )
  })

  it('switches the section as soon as the other option is picked, saving nothing', async () => {
    const { at, choose, saveSettings } = await makeHarness({ settings: { engine: 'local' } })
    choose('cloud')
    expect(shown(at)).toBe('cloud')
    choose('local')
    expect(shown(at)).toBe('local')
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('saves the chosen engine with Save settings', async () => {
    const { choose, save, saveSettings } = await makeHarness({ settings: { engine: 'local' } })
    choose('cloud')
    await save()
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ engine: 'cloud' }))
  })

  it('saves this PC just the same, even before the model is there', async () => {
    const { choose, save, saveSettings } = await makeHarness({
      settings: { engine: 'cloud', apiKeySource: 'stored' },
      engine: engineStatus('missing')
    })
    choose('local')
    await save()
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ engine: 'local' }))
  })

  it('does not take back an unsaved choice when settings change out of band', async () => {
    const { view, at, choose } = await makeHarness({ settings: { engine: 'local' } })
    choose('cloud')
    view.apply(baseSettings({ engine: 'local', playSounds: true }))
    expect(at('#engine-cloud').checked).toBe(true)
    expect(shown(at)).toBe('cloud')
  })

  it('follows the stored engine again once the choice is saved', async () => {
    const { view, at, choose, save } = await makeHarness({ settings: { engine: 'local' } })
    choose('cloud')
    await save()
    view.apply(baseSettings({ engine: 'local' }))
    expect(shown(at)).toBe('local')
  })

  it('opens with the cloud picked, unsaved, when the setup card sends the user here', async () => {
    const { view, at, saveSettings } = await makeHarness({
      settings: { engine: 'local' },
      intent: { engine: 'cloud' }
    })
    expect(at('#engine-cloud').checked).toBe(true)
    expect(shown(at)).toBe('cloud')
    expect(saveSettings).not.toHaveBeenCalled()
    // A repaint from elsewhere must not whisk the key fields away mid-typing.
    view.apply(baseSettings({ engine: 'local' }))
    expect(shown(at)).toBe('cloud')
  })
})

describe('the language note on this PC', () => {
  it('says the setting only tunes cleanup for one of the model’s languages', async () => {
    const { at } = await makeHarness({ settings: { engine: 'local', language: 'de' } })
    expect(at('#language-note').hidden).toBe(false)
    expect(at('#language-note').textContent).toBe(
      'The on-device model recognises its 25 languages by itself; this setting only tunes cleanup.'
    )
    expect(at('#language-note').className).not.toContain('is-warning')
  })

  it('warns, by name, when the language is one the model cannot recognise', async () => {
    const { at } = await makeHarness({ settings: { engine: 'local', language: 'ja' } })
    expect(at('#language-note').textContent).toBe(
      'Parakeet does not support Japanese. Choose Cloud for Japanese.'
    )
    expect(at('#language-note').className).toContain('is-warning')
  })

  it('follows the select as it changes, before any save', async () => {
    const { at } = await makeHarness({ settings: { engine: 'local', language: 'en' } })
    const language = at('#language')
    language.value = 'ko'
    language.emit('change')
    expect(at('#language-note').textContent).toBe(
      'Parakeet does not support Korean. Choose Cloud for Korean.'
    )
  })

  it('goes away when the cloud is chosen, which has no such limit', async () => {
    const { at, choose } = await makeHarness({ settings: { engine: 'local', language: 'ja' } })
    choose('cloud')
    expect(at('#language-note').hidden).toBe(true)
  })
})

describe('the speech model row in Settings', () => {
  it('shows where the model stands, and follows the download', async () => {
    const { view, rowHost } = await makeHarness({ engine: engineStatus('missing') })
    expect(rowHost.part('name').textContent).toBe('Parakeet v3 · 25 European languages')
    expect(rowHost.part('badge').textContent).toBe('Not downloaded')
    expect(rowHost.part('download').textContent).toBe('Download')

    view.applyEngine(engineStatus('downloading', { receivedBytes: 412_000_000 }))
    expect(rowHost.part('detail').textContent).toBe('412 of 670 MB')
    expect(rowHost.part('cancel').hidden).toBe(false)

    view.applyEngine(engineStatus('installed'))
    expect(rowHost.part('badge').textContent).toBe('Ready')
    expect(rowHost.part('remove').hidden).toBe(false)
  })

  it('starts the download and tells the shell what came back', async () => {
    const { rowHost, downloadModel, applyEngine } = await makeHarness({
      engine: engineStatus('missing')
    })
    rowHost.part('download').emit('click')
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(downloadModel).toHaveBeenCalledTimes(1)
    expect(applyEngine).toHaveBeenCalledWith(engineStatus('downloading'))
  })

  it('keeps Remove disabled, and says why, while a dictation runs', async () => {
    const { view, rowHost } = await makeHarness({
      engine: engineStatus('installed'),
      workflow: { phase: 'recording', message: 'Listening…' }
    })
    expect(rowHost.part('remove').disabled).toBe(true)
    expect(rowHost.part('note').textContent).toBe(REMOVE_WHILE_DICTATING)

    view.applyWorkflow({ phase: 'idle', message: 'Ready' })
    expect(rowHost.part('remove').disabled).toBe(false)
    expect(rowHost.part('note').hidden).toBe(true)
  })
})
