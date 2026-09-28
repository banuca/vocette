import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../src/renderer/app-context'
import {
  available,
  unavailable,
  type CapabilityMap,
  type PlatformId,
  type PlatformStatus
} from '../src/shared/capabilities'
import type { EngineStatus } from '../src/shared/engine'
import type { PasteLastStatus, PublicSettings } from '../src/shared/types'

/** Cloud with a key in use, so the page is exercised without the model row in the way. */
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

/**
 * "Put my clipboard back" and "Paste last dictation", driven through the same
 * render function the app uses: painted from what is saved, sent back on
 * Save, disabled with a reason where they can do nothing, and honest when the
 * shortcut is switched on but another app owns the combination.
 */

function platform(id: PlatformId, patch: Partial<CapabilityMap> = {}): PlatformStatus {
  return {
    platform: id,
    session: null,
    pasteLabel: 'Ctrl + V',
    primaryModifierLabel: 'Ctrl',
    capabilities: {
      globalHold: available(),
      globalToggle: available(),
      targetVerification: available(),
      autoPaste: available(),
      launchAtLogin: available(),
      secureKeyStorage: available(),
      ...patch
    }
  }
}

class FakeElement {
  innerHTML = ''
  value = ''
  checked = false
  disabled = false
  hidden = false
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

const CLIPBOARD_ROWS = ['#auto-paste', '#auto-paste-note', '#restore-clipboard', '#restore-clipboard-note']
const PASTE_LAST_ROW = ['#paste-last-shortcut', '#paste-last-note']

function baseSettings(overrides: Partial<PublicSettings> = {}): PublicSettings {
  return {
    engine: 'cloud',
    shortcut: { keys: [29, 42] },
    holdDelayMs: 250,
    recordingMode: 'hold',
    hotkeyEnabled: true,
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
    apiKeySource: 'stored',
    ...overrides
  }
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

async function makeHarness(
  options: {
    settings?: Partial<PublicSettings>
    platform?: PlatformStatus
    status?: PasteLastStatus
  } = {}
) {
  const status = options.platform ?? platform('windows')
  const elements = new Map<string, FakeElement>()
  // The fake parses no markup, so a row the page does not draw is simply not
  // there to be found — as in the real window.
  const selectors = [
    ...CLIPBOARD_ROWS,
    ...(status.platform === 'windows' ? PASTE_LAST_ROW : []),
    '#save-settings',
    '#settings-feedback'
  ]
  for (const selector of selectors) elements.set(selector, new FakeElement())
  const content = new FakeElement(elements)

  const context: AppContext = {
    content: content as unknown as HTMLElement,
    settings: baseSettings(options.settings),
    history: [],
    appInfo: { version: '0.4.0', platform: 'win32', platformStatus: status },
    platform: status,
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
    baseSettings({ ...options.settings, ...(update as Partial<PublicSettings>) })
  )
  const getPasteLastStatus = vi.fn(
    async (): Promise<PasteLastStatus> => options.status ?? { pasteLastRegistered: true }
  )
  vi.stubGlobal('window', {
    murmur: {
      onShortcutCapture: vi.fn(() => () => undefined),
      cancelShortcutCapture: vi.fn(async () => undefined),
      saveSettings,
      getPasteLastStatus
    },
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn()
  })

  const { renderSettings } = await import('../src/renderer/pages/settings')
  const view = renderSettings(context)
  await flush()

  const at = (selector: string): FakeElement => {
    const element = elements.get(selector)
    if (!element) throw new Error(`no fake element for ${selector}`)
    return element
  }
  const save = async (): Promise<void> => {
    at('#save-settings').emit('click')
    await flush()
  }

  return { view, at, content, save, saveSettings, getPasteLastStatus }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the clipboard switches', () => {
  it('sit directly under "Paste automatically", in their own words', async () => {
    const { content } = await makeHarness()
    const html = content.innerHTML
    expect(html).toContain(
      '<strong>Put my clipboard back</strong><span>After pasting, Murmur restores what you had copied. Turn off to keep each transcript on the clipboard.</span>'
    )
    expect(html).toContain(
      '<strong>Paste last dictation with Alt + Shift + V</strong><span>Handy when a paste went to the wrong place.</span>'
    )
    const autoPaste = html.indexOf('id="row-auto-paste"')
    const restore = html.indexOf('id="row-restore-clipboard"')
    const pasteLast = html.indexOf('id="row-paste-last"')
    const fillers = html.indexOf('id="remove-fillers"')
    expect(autoPaste).toBeGreaterThan(-1)
    expect(autoPaste).toBeLessThan(restore)
    expect(restore).toBeLessThan(pasteLast)
    expect(pasteLast).toBeLessThan(fillers)
  })

  it('show what is saved, follow a change saved elsewhere, and save what they show', async () => {
    const { view, at, save, saveSettings } = await makeHarness({
      settings: { restoreClipboard: false, pasteLastShortcut: true }
    })
    expect(at('#restore-clipboard').checked).toBe(false)
    expect(at('#paste-last-shortcut').checked).toBe(true)

    view.apply(baseSettings({ restoreClipboard: true, pasteLastShortcut: false }))
    expect(at('#restore-clipboard').checked).toBe(true)
    expect(at('#paste-last-shortcut').checked).toBe(false)

    at('#restore-clipboard').checked = false
    at('#paste-last-shortcut').checked = true
    await save()
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ restoreClipboard: false, pasteLastShortcut: true })
    )
  })

  it('disable "Put my clipboard back", with the paste reason, where nothing can be pasted', async () => {
    const working = await makeHarness()
    expect(working.at('#restore-clipboard').disabled).toBe(false)
    expect(working.at('#restore-clipboard-note').hidden).toBe(true)
    vi.unstubAllGlobals()

    const { at } = await makeHarness({
      platform: platform('windows', {
        autoPaste: unavailable('The keyboard hook could not start.')
      })
    })
    expect(at('#restore-clipboard').disabled).toBe(true)
    expect(at('#restore-clipboard-note').hidden).toBe(false)
    expect(at('#restore-clipboard-note').textContent).toBe('The keyboard hook could not start.')
    // The same words as the row above it: one reason, said once in each place.
    expect(at('#restore-clipboard-note').textContent).toBe(at('#auto-paste-note').textContent)
  })
})

describe('the Alt + Shift + V switch', () => {
  it('says so when another app owns the combination', async () => {
    const { at } = await makeHarness({ status: { pasteLastRegistered: false } })
    expect(at('#paste-last-note').textContent).toBe('Alt + Shift + V is in use by another app.')
    expect(at('#paste-last-note').hidden).toBe(false)
  })

  it('says nothing when the shortcut is in force, or switched off', async () => {
    const working = await makeHarness({ status: { pasteLastRegistered: true } })
    expect(working.at('#paste-last-note').hidden).toBe(true)
    vi.unstubAllGlobals()

    // Off and therefore not registered: nothing is wrong, so nothing is said.
    const off = await makeHarness({
      settings: { pasteLastShortcut: false },
      status: { pasteLastRegistered: false }
    })
    expect(off.at('#paste-last-note').hidden).toBe(true)
    expect(off.at('#paste-last-note').textContent).toBe('')
  })

  it('asks again after Save, which is what registers or releases it', async () => {
    const { at, save, getPasteLastStatus } = await makeHarness({
      settings: { pasteLastShortcut: false },
      status: { pasteLastRegistered: false }
    })
    expect(getPasteLastStatus).toHaveBeenCalledTimes(1)

    at('#paste-last-shortcut').checked = true
    await save()
    expect(getPasteLastStatus).toHaveBeenCalledTimes(2)
    expect(at('#paste-last-note').textContent).toBe('Alt + Shift + V is in use by another app.')
  })

  it('is left out on other desktops, where the saved choice is kept as it is', async () => {
    const { content, save, saveSettings, getPasteLastStatus } = await makeHarness({
      platform: platform('macos'),
      settings: { pasteLastShortcut: false }
    })
    expect(content.innerHTML).not.toContain('Alt + Shift + V')
    expect(content.innerHTML).toContain('<strong>Put my clipboard back</strong>')
    expect(getPasteLastStatus).not.toHaveBeenCalled()

    await save()
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ pasteLastShortcut: false }))
  })
})
