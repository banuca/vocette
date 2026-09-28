import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../src/renderer/app-context'
import { available, type PlatformStatus } from '../src/shared/capabilities'
import type { EngineStatus } from '../src/shared/engine'
import type { PublicSettings } from '../src/shared/types'

/**
 * The three cleanup switches on the Recording card, driven through the same
 * render function the app uses. Each is a saved setting: it must be painted
 * from the stored value and sent back on Save. A handle that silently
 * resolved to nothing would save the default instead of the user's choice,
 * and no test of the settings store could see that.
 */

/** Cloud, with a key in use: these pages are exercised as they were before the on-device engine. */
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

class FakeElement {
  innerHTML = ''
  value = ''
  checked = false
  textContent: string | null = ''
  private readonly listeners = new Map<string, Array<(event: unknown) => unknown>>()

  constructor(private readonly elements?: Map<string, FakeElement>) {}

  querySelector<T>(selector: string): T | null {
    return (this.elements?.get(selector) ?? null) as T | null
  }

  addEventListener(type: string, listener: (event: unknown) => unknown): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  emit(type: string): void {
    this.listeners.get(type)?.forEach((listener) => listener({ target: this }))
  }
}

const SWITCHES = ['#remove-fillers', '#spoken-corrections', '#spoken-formatting'] as const

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
    language: 'auto',
    vocabulary: '',
    replacements: '',
    apiEndpoint: '',
    apiKeySource: 'stored',
    ...overrides
  }
}

async function makeHarness(overrides: Partial<PublicSettings> = {}) {
  const elements = new Map<string, FakeElement>()
  for (const selector of [...SWITCHES, '#save-settings', '#settings-feedback']) {
    elements.set(selector, new FakeElement())
  }
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
    setHeading: vi.fn(),
    applySettings: vi.fn(),
    applyPlatform: vi.fn(),
    applyEngine: vi.fn(),
    navigate: vi.fn(),
    reloadHistory: vi.fn(async () => undefined)
  }

  const saveSettings = vi.fn(async (update: Record<string, unknown>) =>
    baseSettings({ ...overrides, ...(update as Partial<PublicSettings>) })
  )
  vi.stubGlobal('window', {
    murmur: {
      onShortcutCapture: vi.fn(() => () => undefined),
      cancelShortcutCapture: vi.fn(async () => undefined),
      saveSettings
    },
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn()
  })

  const { renderSettings } = await import('../src/renderer/pages/settings')
  const view = renderSettings(context)

  const at = (selector: string): FakeElement => {
    const element = elements.get(selector)
    if (!element) throw new Error(`no fake element for ${selector}`)
    return element
  }

  return { view, at, content, saveSettings }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the cleanup switches', () => {
  it('replace the single "Light cleanup" row with three rows of their own', async () => {
    const { content } = await makeHarness()
    expect(content.innerHTML).not.toContain('Light cleanup')
    expect(content.innerHTML).toContain('<strong>Remove filler words</strong>')
    expect(content.innerHTML).toContain('<strong>Follow spoken corrections</strong>')
    expect(content.innerHTML).toContain('<strong>Spoken line breaks</strong>')
    for (const selector of SWITCHES) {
      expect(content.innerHTML).toContain(`id="${selector.slice(1)}"`)
    }
  })

  it('show what is saved', async () => {
    // A fake checkbox starts unticked, so "on" is the value that proves the
    // page painted it; the next test proves "off".
    const { at } = await makeHarness({
      removeFillers: false,
      spokenCorrections: true,
      spokenFormatting: true
    })
    expect(at('#remove-fillers').checked).toBe(false)
    expect(at('#spoken-corrections').checked).toBe(true)
    expect(at('#spoken-formatting').checked).toBe(true)
  })

  it('follow a change saved elsewhere', async () => {
    const { view, at } = await makeHarness()
    expect(at('#spoken-corrections').checked).toBe(true)
    view.apply(baseSettings({ spokenCorrections: false, spokenFormatting: false }))
    expect(at('#spoken-corrections').checked).toBe(false)
    expect(at('#spoken-formatting').checked).toBe(false)
  })

  it('save what they show', async () => {
    const { at, saveSettings } = await makeHarness()
    at('#remove-fillers').checked = false
    at('#spoken-corrections').checked = false
    at('#spoken-formatting').checked = true

    at('#save-settings').emit('click')
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        removeFillers: false,
        spokenCorrections: false,
        spokenFormatting: true
      })
    )
  })
})
