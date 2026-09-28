import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../src/renderer/app-context'
import { BLUETOOTH_HEADSET_NOTE } from '../src/renderer/bluetooth-headset'
import { available, type PlatformStatus } from '../src/shared/capabilities'
import type { EngineStatus } from '../src/shared/engine'
import type { PublicSettings } from '../src/shared/types'

/**
 * The Bluetooth note under the microphone picker, driven through the same
 * render function the app uses, with the microphones Chromium lists on
 * Windows: a `default` entry named after the device it stands for, then the
 * devices themselves.
 */

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

const HEADSET = 'Headset (WH-1000XM4 Hands-Free AG Audio)'
const BUILT_IN = 'Microphone Array (Realtek(R) Audio)'

function device(deviceId: string, label: string, kind: MediaDeviceKind = 'audioinput') {
  return { deviceId, label, kind, groupId: `group-${deviceId}` } as MediaDeviceInfo
}

/** The system default is the headset. */
const HEADSET_IS_DEFAULT = [
  device('default', `Default - ${HEADSET}`),
  device('headset-id', HEADSET),
  device('built-in-id', BUILT_IN),
  device('camera-id', 'Integrated Camera', 'videoinput')
]

/** The system default is the laptop's own microphone. */
const BUILT_IN_IS_DEFAULT = [
  device('default', `Default - ${BUILT_IN}`),
  device('headset-id', HEADSET),
  device('built-in-id', BUILT_IN)
]

class FakeOption {
  constructor(
    readonly text: string,
    readonly value: string
  ) {}
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

/** The picker keeps what the page adds to it, so the list can be read back. */
class FakeSelect extends FakeElement {
  options: FakeOption[] = []

  replaceChildren(): void {
    this.options = []
  }

  add(option: FakeOption): void {
    this.options.push(option)
  }
}

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
    instantCapture: true,
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

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

async function makeHarness(options: { devices: MediaDeviceInfo[]; microphoneId?: string }) {
  let devices = options.devices
  const select = new FakeSelect()
  const note = new FakeElement()
  // As drawn: hidden until the list says otherwise.
  note.hidden = true
  const refreshButton = new FakeElement()
  const elements = new Map<string, FakeElement>([
    ['#microphone', select],
    ['#microphone-feedback', new FakeElement()],
    ['#microphone-note', note],
    ['#refresh-microphones', refreshButton]
  ])
  const content = new FakeElement(elements)

  const context: AppContext = {
    content: content as unknown as HTMLElement,
    settings: baseSettings({ microphoneId: options.microphoneId ?? '' }),
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

  vi.stubGlobal('window', {
    murmur: {
      onShortcutCapture: vi.fn(() => () => undefined),
      cancelShortcutCapture: vi.fn(async () => undefined)
    },
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn()
  })
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
      enumerateDevices: vi.fn(async () => devices)
    }
  })
  vi.stubGlobal('Option', FakeOption)

  const { renderSettings } = await import('../src/renderer/pages/settings')
  const view = renderSettings(context)
  await flush()

  return {
    view,
    content,
    note,
    /** What the picker offers, by value. */
    listed: (): string[] => select.options.map((option) => option.value),
    /** Picks a microphone the way the picker does, before any Save. */
    choose: (deviceId: string): void => {
      select.value = deviceId
      select.emit('change')
    },
    /** The ↻ button, after the OS has changed what it lists. */
    refresh: async (next: MediaDeviceInfo[]): Promise<void> => {
      devices = next
      refreshButton.emit('click')
      await flush()
    }
  }
}

const shown = (note: FakeElement): boolean => !note.hidden && note.textContent === BLUETOOTH_HEADSET_NOTE
const gone = (note: FakeElement): boolean => note.hidden && note.textContent === ''

describe('the Bluetooth note under the microphone picker', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is drawn outside the picker’s label, hidden, and tied to the picker for screen readers', async () => {
    const { content } = await makeHarness({ devices: BUILT_IN_IS_DEFAULT })
    const html = content.innerHTML
    expect(html).toContain('<label class="field-label" for="microphone">Microphone</label>')
    expect(html).toContain(
      '<select id="microphone" aria-describedby="microphone-feedback microphone-note">'
    )
    expect(html).toContain(
      '<small class="microphone-note" id="microphone-note" aria-live="polite" hidden></small>'
    )
    expect(html.indexOf('id="microphone-note"')).toBeGreaterThan(html.indexOf('id="microphone"'))
  })

  it('shows for the system default when the default device is a headset, which is still not listed', async () => {
    const { note, listed } = await makeHarness({ devices: HEADSET_IS_DEFAULT })
    expect(listed()).toEqual(['', 'headset-id', 'built-in-id'])
    expect(shown(note)).toBe(true)
  })

  it('stays hidden for the system default when the default device is the built-in microphone', async () => {
    const { note } = await makeHarness({ devices: BUILT_IN_IS_DEFAULT })
    expect(gone(note)).toBe(true)
  })

  it('follows the picker before Save', async () => {
    const { note, choose } = await makeHarness({ devices: BUILT_IN_IS_DEFAULT })

    choose('headset-id')
    expect(shown(note)).toBe(true)
    choose('built-in-id')
    expect(gone(note)).toBe(true)
    choose('')
    expect(gone(note)).toBe(true)
  })

  it('shows for a saved headset as soon as the list arrives', async () => {
    const { note } = await makeHarness({ devices: BUILT_IN_IS_DEFAULT, microphoneId: 'headset-id' })
    expect(shown(note)).toBe(true)
  })

  it('is worked out again after a refresh', async () => {
    const { note, refresh } = await makeHarness({ devices: BUILT_IN_IS_DEFAULT })
    expect(gone(note)).toBe(true)

    // The headset connected and Windows made it the default.
    await refresh(HEADSET_IS_DEFAULT)
    expect(shown(note)).toBe(true)

    await refresh(BUILT_IN_IS_DEFAULT)
    expect(gone(note)).toBe(true)
  })

  it('stays hidden with no name to go on', async () => {
    // A saved microphone that is not connected has no entry, so no name.
    const unplugged = await makeHarness({ devices: BUILT_IN_IS_DEFAULT, microphoneId: 'gone-id' })
    expect(unplugged.listed()).toContain('gone-id')
    expect(gone(unplugged.note)).toBe(true)

    vi.resetModules()
    vi.unstubAllGlobals()
    // Names stay blank until the microphone has been allowed.
    const unnamed = await makeHarness({
      devices: [device('default', ''), device('headset-id', ''), device('built-in-id', '')]
    })
    unnamed.choose('headset-id')
    expect(gone(unnamed.note)).toBe(true)
  })
})
