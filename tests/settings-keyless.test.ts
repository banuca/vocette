import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_POLISH } from '../src/shared/polish'
import type { AppContext } from '../src/renderer/app-context'
import { licenceStatus } from './fixtures/licence-status'
import { available, type PlatformStatus } from '../src/shared/capabilities'
import type { EngineStatus } from '../src/shared/engine'
import type { PublicSettings, TranscriptionTestResult } from '../src/shared/types'

/**
 * The cloud section of the Transcription card, driven through the same
 * render function the app uses: the badge that says whether a key is needed,
 * and Test connection beside the endpoint — which sends only saved settings,
 * so it waits for Save while the fields say something else.
 */

const LOCAL_SERVER = 'http://localhost:8080/v1'

const TEST_ENGINE: EngineStatus = {
  engine: 'cloud',
  model: {
    id: 'parakeet-tdt-0.6b-v3-int8',
    state: 'missing',
    receivedBytes: 0,
    totalBytes: 670_478_772,
    error: null
  },
  ready: true,
  notReadyReason: null
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
    // As in a browser, a disabled button is not clicked.
    if (type === 'click' && this.disabled) return
    this.listeners.get(type)?.forEach((listener) => listener({ target: this }))
  }

  replaceChildren(): void {}
  append(): void {}
  add(): void {}
  focus(): void {}
  remove(): void {}
}

const SELECTORS = [
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
  '#test-connection',
  '#connection-result',
  '#save-settings',
  '#settings-feedback'
]

function baseSettings(overrides: Partial<PublicSettings> = {}): PublicSettings {
  return {
    engine: 'cloud',
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
    polish: { ...DEFAULT_POLISH, keySource: 'none' },
    ...overrides
  }
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

async function makeHarness(
  overrides: Partial<PublicSettings> = {},
  test: () => Promise<TranscriptionTestResult> = async () => ({ ok: true, ms: 180, error: null })
) {
  const elements = new Map<string, FakeElement>()
  SELECTORS.forEach((selector) => elements.set(selector, new FakeElement()))
  // As drawn: the answer line starts hidden.
  const line = elements.get('#connection-result')
  if (line) line.hidden = true
  const content = new FakeElement(elements)
  const settings = baseSettings(overrides)

  const context: AppContext = {
    content: content as unknown as HTMLElement,
    settings,
    history: [],
    appInfo: { version: '0.4.0', platform: 'win32', platformStatus: TEST_PLATFORM },
    platform: TEST_PLATFORM,
    engine: TEST_ENGINE,
    workflow: { phase: 'idle', message: 'Ready' },
    microphone: 'unknown',
    licence: licenceStatus(),
    setHeading: vi.fn(),
    applySettings: vi.fn(),
    applyPlatform: vi.fn(),
    applyEngine: vi.fn(),
    applyLicence: vi.fn(),
    navigate: vi.fn(),
    reloadHistory: vi.fn(async () => undefined)
  }

  // Saving stores what the page sent, as the main process would.
  const saveSettings = vi.fn(async (update: Record<string, unknown>) =>
    baseSettings({ ...overrides, ...(update as Partial<PublicSettings>) })
  )
  const testTranscription = vi.fn(test)

  vi.stubGlobal('window', {
    murmur: {
      onShortcutCapture: vi.fn(() => () => undefined),
      beginShortcutCapture: vi.fn(async () => undefined),
      cancelShortcutCapture: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      clearApiKey: vi.fn(async () => settings),
      clearSessionApiKey: vi.fn(async () => settings),
      saveSettings,
      testTranscription
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

  const save = async (): Promise<void> => {
    at('#save-settings').emit('click')
    await flush()
  }

  /** Types into a field, the way the page hears it. */
  const type = (selector: string, value: string, event = 'input'): void => {
    at(selector).value = value
    at(selector).emit(event)
  }

  return { view, at, content, save, type, saveSettings, testTranscription }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the key badge', () => {
  it('asks for a key only when the endpoint is OpenAI', async () => {
    const { at } = await makeHarness({ apiKeySource: 'none', apiEndpoint: '' })
    expect(at('#key-badge').textContent).toBe('Key required')
    expect(at('#key-badge').className).not.toContain('is-configured')
  })

  it('says no key is needed for a server of the user’s own', async () => {
    const { at, content } = await makeHarness({ apiKeySource: 'none', apiEndpoint: LOCAL_SERVER })
    expect(at('#key-badge').textContent).toBe('No key needed for this server')
    expect(at('#key-badge').className).toContain('is-configured')
    // The page is drawn saying so too, not only repainted to.
    expect(content.innerHTML).toContain(
      '<span class="configured-badge is-configured" id="key-badge">No key needed for this server</span>'
    )
  })

  it('still names a key in use, whatever the endpoint', async () => {
    for (const apiEndpoint of ['', LOCAL_SERVER]) {
      const stored = await makeHarness({ apiKeySource: 'stored', apiEndpoint })
      expect(stored.at('#key-badge').textContent).toBe('Key saved')
      const session = await makeHarness({ apiKeySource: 'session', apiEndpoint })
      expect(session.at('#key-badge').textContent).toBe('Key for this session')
    }
  })

  it('follows the saved endpoint rather than the one being typed, and changes on Save', async () => {
    const { at, save, type } = await makeHarness({ apiKeySource: 'none', apiEndpoint: '' })
    type('#api-endpoint', LOCAL_SERVER)
    // Until it is saved, Record still needs a key, and the badge says so.
    expect(at('#key-badge').textContent).toBe('Key required')

    await save()
    expect(at('#key-badge').textContent).toBe('No key needed for this server')
  })

  it('tells the user the key is optional with an endpoint', async () => {
    const { content } = await makeHarness()
    expect(content.innerHTML).toContain(
      'With an endpoint here the key is optional: a server of your own may not need one.'
    )
  })
})

describe('Test connection', () => {
  it('sits beside the endpoint, outside its label, with its answer tied to the button', async () => {
    const { content } = await makeHarness()
    const html = content.innerHTML
    expect(html).toContain(
      '<label class="field-label" for="api-endpoint">API endpoint <em>(optional)</em></label>'
    )
    expect(html).toContain(
      '<button class="secondary-button" id="test-connection" type="button" aria-describedby="connection-result">Test connection</button>'
    )
    expect(html).toContain(
      '<small class="connection-result" id="connection-result" aria-live="polite" hidden></small>'
    )
    expect(html.indexOf('id="test-connection"')).toBeGreaterThan(html.indexOf('id="api-endpoint"'))
  })

  it('says it is sending, then how long the server took to answer', async () => {
    let finish: (result: TranscriptionTestResult) => void = () => undefined
    const { at, testTranscription } = await makeHarness(
      { apiEndpoint: LOCAL_SERVER },
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const button = at('#test-connection')
    const line = at('#connection-result')
    expect(button.disabled).toBe(false)
    expect(line.hidden).toBe(true)

    button.emit('click')
    expect(testTranscription).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('Testing…')
    expect(line.hidden).toBe(false)
    expect(line.textContent).toBe('Sending one second of silence…')

    finish({ ok: true, ms: 180, error: null })
    await flush()
    expect(line.textContent).toBe('Connected — the server answered in 180 ms')
    expect(line.className).toBe('connection-result is-connected')
    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Test connection')
  })

  it('shows the sentence of a failure, marked as one', async () => {
    const refusal =
      'The server at localhost:8080 refused the request (HTTP 401). If it needs a key, add one in Settings.'
    const { at } = await makeHarness({ apiEndpoint: LOCAL_SERVER }, async () => ({
      ok: false,
      ms: null,
      error: refusal
    }))
    at('#test-connection').emit('click')
    await flush()
    expect(at('#connection-result').textContent).toBe(refusal)
    expect(at('#connection-result').className).toBe('connection-result is-failed')
  })

  it('shows a failure of the bridge itself as a sentence too', async () => {
    const { at } = await makeHarness({ apiEndpoint: LOCAL_SERVER }, () =>
      Promise.reject(new Error('Forbidden.'))
    )
    at('#test-connection').emit('click')
    await flush()
    expect(at('#connection-result').textContent).toBe('Forbidden.')
    expect(at('#connection-result').className).toBe('connection-result is-failed')
    expect(at('#test-connection').disabled).toBe(false)
  })

  it('waits for Save while the endpoint says something unsaved, and says why', async () => {
    const { at, save, type, testTranscription } = await makeHarness({ apiEndpoint: '' })
    type('#api-endpoint', LOCAL_SERVER)
    expect(at('#test-connection').disabled).toBe(true)
    expect(at('#connection-result').hidden).toBe(false)
    expect(at('#connection-result').textContent).toBe(
      'Save settings first — the test uses the saved endpoint, model and key.'
    )
    at('#test-connection').emit('click')
    expect(testTranscription).not.toHaveBeenCalled()

    await save()
    expect(at('#test-connection').disabled).toBe(false)
    expect(at('#connection-result').hidden).toBe(true)
  })

  it('waits for Save while a key is typed, and goes ahead once the box is emptied by it', async () => {
    const { at, save, type } = await makeHarness({ apiEndpoint: LOCAL_SERVER })
    type('#api-key', 'gsk-new')
    expect(at('#test-connection').disabled).toBe(true)

    await save()
    expect(at('#api-key').value).toBe('')
    expect(at('#test-connection').disabled).toBe(false)
  })

  it('waits for Save while another model is chosen, and not once it is chosen back', async () => {
    const { at, type } = await makeHarness({ apiEndpoint: LOCAL_SERVER, model: 'gpt-transcribe' })
    type('#model', 'whisper-1', 'change')
    expect(at('#test-connection').disabled).toBe(true)
    type('#model', 'gpt-transcribe', 'change')
    expect(at('#test-connection').disabled).toBe(false)
    expect(at('#connection-result').hidden).toBe(true)
  })

  it('keeps its answer through a repaint, but drops it once the saved endpoint changes', async () => {
    const { at, view } = await makeHarness({ apiEndpoint: LOCAL_SERVER }, async () => ({
      ok: true,
      ms: 42,
      error: null
    }))
    at('#test-connection').emit('click')
    await flush()
    expect(at('#connection-result').textContent).toBe('Connected — the server answered in 42 ms')

    // The tray or the theme switch repaints the page; the connection is the same.
    view.apply(baseSettings({ apiEndpoint: LOCAL_SERVER, playSounds: true }))
    expect(at('#connection-result').textContent).toBe('Connected — the server answered in 42 ms')

    // A different saved endpoint is not the one that answered.
    view.apply(baseSettings({ apiEndpoint: 'http://localhost:9000/v1' }))
    expect(at('#connection-result').hidden).toBe(true)
  })

  it('writes a long wait the way the rest of the page writes numbers', async () => {
    const { at } = await makeHarness({ apiEndpoint: LOCAL_SERVER }, async () => ({
      ok: true,
      ms: 1240,
      error: null
    }))
    at('#test-connection').emit('click')
    await flush()
    expect(at('#connection-result').textContent).toBe(
      'Connected — the server answered in 1,240 ms'
    )
  })

  it('paints nothing more once the page has gone', async () => {
    let finish: (result: TranscriptionTestResult) => void = () => undefined
    const { at, view } = await makeHarness(
      { apiEndpoint: LOCAL_SERVER },
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    at('#test-connection').emit('click')
    view.dispose()
    finish({ ok: true, ms: 5, error: null })
    await flush()
    expect(at('#connection-result').textContent).toBe('Sending one second of silence…')
  })
})
