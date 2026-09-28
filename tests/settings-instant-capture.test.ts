import { afterEach, describe, expect, it, vi } from 'vitest'
import { licenceStatus } from './fixtures/licence-status'
import type { AppContext } from '../src/renderer/app-context'
import {
  available,
  needsPermission,
  unavailable,
  type CapabilityMap,
  type LinuxSession,
  type PlatformId,
  type PlatformStatus
} from '../src/shared/capabilities'
import type { EngineStatus } from '../src/shared/engine'
import type { PublicSettings } from '../src/shared/types'

/**
 * "Start listening as soon as the shortcut is held", driven through the same
 * render function the app uses: painted from what is saved, sent back on Save,
 * and disabled with a reason wherever no key going down can be seen — so the
 * switch never shows as doing something it cannot.
 */

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

function platform(
  id: PlatformId,
  patch: Partial<CapabilityMap> = {},
  session: LinuxSession | null = null
): PlatformStatus {
  return {
    platform: id,
    session,
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
    apiKeySource: 'stored',
    ...overrides
  }
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

async function makeHarness(
  options: { settings?: Partial<PublicSettings>; platform?: PlatformStatus } = {}
) {
  const status = options.platform ?? platform('windows')
  const elements = new Map<string, FakeElement>()
  for (const selector of [
    '#instant-capture',
    '#instant-capture-note',
    '#hotkey-enabled',
    '#hotkey-note',
    '#mode-escape',
    '#save-settings',
    '#settings-feedback'
  ]) {
    elements.set(selector, new FakeElement())
  }
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
    licence: licenceStatus(),
    setHeading: vi.fn(),
    applySettings: vi.fn(),
    applyPlatform: vi.fn(),
    applyEngine: vi.fn(),
    applyLicence: vi.fn(),
    navigate: vi.fn(),
    reloadHistory: vi.fn(async () => undefined)
  }

  const saveSettings = vi.fn(async (update: Record<string, unknown>) =>
    baseSettings({ ...options.settings, ...(update as Partial<PublicSettings>) })
  )
  vi.stubGlobal('window', {
    murmur: {
      onShortcutCapture: vi.fn(() => () => undefined),
      cancelShortcutCapture: vi.fn(async () => undefined),
      saveSettings,
      getPasteLastStatus: vi.fn(async () => ({ pasteLastRegistered: true }))
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

  return { view, at, content, save, saveSettings }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the "Start listening as soon as the shortcut is held" switch', () => {
  it('sits on the Recording card under "Global shortcut enabled", in its own words', async () => {
    const { content } = await makeHarness()
    const html = content.innerHTML
    // Honest about the moment the keys are held first: a shortcut typed at
    // speed never opens the microphone at all.
    expect(html).toContain(
      '<strong>Start listening as soon as the shortcut is held</strong><span>Helps catch your first word when you start speaking straight away. The microphone opens once the keys have been held for a moment, and anything captured before recording starts is thrown away unheard if you were pressing a different shortcut.</span>'
    )
    expect(html).not.toContain('as soon as the keys go down')
    const recording = html.indexOf('<h2>Recording</h2>')
    const hotkey = html.indexOf('id="row-hotkey"')
    const instant = html.indexOf('id="row-instant-capture"')
    const autoPaste = html.indexOf('id="row-auto-paste"')
    const history = html.indexOf('<h2>Local history</h2>')
    expect(recording).toBeGreaterThan(-1)
    expect(recording).toBeLessThan(hotkey)
    expect(hotkey).toBeLessThan(instant)
    expect(instant).toBeLessThan(autoPaste)
    expect(autoPaste).toBeLessThan(history)
  })

  it('shows what is saved, follows a change saved elsewhere, and saves what it shows', async () => {
    const { view, at, save, saveSettings } = await makeHarness({
      settings: { instantCapture: false }
    })
    expect(at('#instant-capture').checked).toBe(false)

    view.apply(baseSettings({ instantCapture: true }))
    expect(at('#instant-capture').checked).toBe(true)

    at('#instant-capture').checked = false
    await save()
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ instantCapture: false }))

    at('#instant-capture').checked = true
    await save()
    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ instantCapture: true }))
  })

  it('is offered, and says nothing, where the keyboard is watched', async () => {
    const { at } = await makeHarness()
    expect(at('#instant-capture').disabled).toBe(false)
    expect(at('#instant-capture-note').hidden).toBe(true)
    expect(at('#instant-capture-note').textContent).toBe('')
  })

  it('is disabled with a reason on a desktop that only reports a shortcut once it has fired', async () => {
    const { at, save, saveSettings } = await makeHarness({
      platform: platform(
        'linux',
        { globalHold: unavailable('Wayland does not let an application watch the keyboard.') },
        'wayland'
      )
    })
    expect(at('#instant-capture').disabled).toBe(true)
    expect(at('#instant-capture-note').hidden).toBe(false)
    expect(at('#instant-capture-note').textContent).toBe(
      'This desktop tells Murmur about the shortcut only once it has fired, so listening cannot start any earlier.'
    )
    // The shortcut itself still works there, so its own row says nothing.
    expect(at('#hotkey-note').hidden).toBe(true)

    // The saved choice is kept for a session that can use it.
    expect(at('#instant-capture').checked).toBe(true)
    await save()
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ instantCapture: true }))
  })

  it('gives the shortcut’s own reason where there is no shortcut at all', async () => {
    const reason =
      'The keyboard hook could not start, so system-wide shortcuts are off. ' +
      'You can still record from the Murmur window.'
    const noHook = await makeHarness({
      platform: platform('windows', {
        globalHold: unavailable(reason),
        globalToggle: unavailable(reason)
      })
    })
    expect(noHook.at('#instant-capture').disabled).toBe(true)
    expect(noHook.at('#instant-capture-note').textContent).toBe(reason)
    // One reason, said the same way on both rows.
    expect(noHook.at('#instant-capture-note').textContent).toBe(
      noHook.at('#hotkey-note').textContent
    )
    vi.unstubAllGlobals()

    const permission = 'Murmur needs Input Monitoring permission to see the shortcut.'
    const macos = await makeHarness({
      platform: platform('macos', {
        globalHold: needsPermission(permission, 'input-monitoring'),
        globalToggle: needsPermission(permission, 'input-monitoring')
      })
    })
    expect(macos.at('#instant-capture').disabled).toBe(true)
    expect(macos.at('#instant-capture-note').textContent).toBe(permission)
    expect(macos.at('#instant-capture-note').hidden).toBe(false)
  })
})

describe('the Esc line under "Press to start and stop"', () => {
  it('says Esc cancels, and that the app in front sees it too', async () => {
    const { content, at } = await makeHarness()
    expect(content.innerHTML).toContain(
      '<strong>Press to start and stop</strong><span>One press begins recording, the next ends it.</span><span id="mode-escape">Esc cancels. The app you are in sees that Esc too.</span>'
    )
    expect(at('#mode-escape').hidden).toBe(false)
  })

  it('is not there where the keyboard is not watched, since Esc cannot be seen', async () => {
    const wayland = await makeHarness({
      platform: platform(
        'linux',
        { globalHold: unavailable('Wayland does not let an application watch the keyboard.') },
        'wayland'
      )
    })
    expect(wayland.at('#mode-escape').hidden).toBe(true)
  })
})
