import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../src/renderer/app-context'
import { available, type PlatformStatus } from '../src/shared/capabilities'
import type { EngineStatus } from '../src/shared/engine'

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

/** A fully capable desktop, so these tests exercise the microphone only. */
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
import type { PublicSettings } from '../src/shared/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
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

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

type AudioSetupFailure = 'construct' | 'source' | null

async function makeFocusedMicHarness() {
  const permission = makeStream()
  const getUserMedia = vi
    .fn<(constraints?: MediaStreamConstraints) => Promise<MediaStream>>()
    .mockResolvedValueOnce(permission.stream)
  const elements = new Map<string, FakeElement>()
  const selectors = [
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
    '#key-badge',
    '#shortcut-chips',
    '#shortcut-capture',
    '#shortcut-action',
    '#shortcut-feedback',
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
  selectors.forEach((selector) => elements.set(selector, new FakeElement()))

  const settings: PublicSettings = {
    engine: 'cloud',
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
    apiKeySource: 'none'
  }
  const context: AppContext = {
    content: new FakeElement(elements) as unknown as HTMLElement,
    settings,
    history: [],
    appInfo: { version: '0.3.1', platform: 'win32', platformStatus: TEST_PLATFORM },
    platform: TEST_PLATFORM,
    engine: TEST_ENGINE,
    microphone: 'unknown',
    setHeading: vi.fn(),
    applySettings: vi.fn(),
    applyPlatform: vi.fn(),
    applyEngine: vi.fn(),
    navigate: vi.fn(),
    reloadHistory: vi.fn(async () => undefined)
  }

  let timeoutId = 0
  let frameId = 0
  const setTimeoutMock = vi.fn(() => ++timeoutId)
  const clearTimeoutMock = vi.fn()
  const requestAnimationFrameMock = vi.fn(() => ++frameId)
  const cancelAnimationFrameMock = vi.fn()
  vi.stubGlobal('window', {
    murmur: {
      onShortcutCapture: vi.fn(() => () => undefined),
      beginShortcutCapture: vi.fn(async () => undefined),
      cancelShortcutCapture: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      clearApiKey: vi.fn(async () => settings),
      clearHistory: vi.fn(async () => undefined),
      saveSettings: vi.fn(async () => settings)
    },
    setTimeout: setTimeoutMock,
    clearTimeout: clearTimeoutMock,
    confirm: vi.fn(() => true)
  })
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => [])
    }
  })
  vi.stubGlobal(
    'Option',
    class {
      constructor(
        readonly text: string,
        readonly value: string
      ) {}
    }
  )

  let audioSetupFailure: AudioSetupFailure = null
  const audioContexts: TestAudioContext[] = []
  class TestAudioContext {
    readonly close = vi.fn(async () => undefined)

    constructor() {
      if (audioSetupFailure === 'construct') throw new Error('context construction failed')
      audioContexts.push(this)
    }

    createAnalyser() {
      return { fftSize: 0, getByteTimeDomainData: vi.fn() }
    }

    createMediaStreamSource() {
      if (audioSetupFailure === 'source') throw new Error('source setup failed')
      return { connect: vi.fn() }
    }
  }
  vi.stubGlobal('AudioContext', TestAudioContext)
  vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock)
  vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock)

  const { renderSettings } = await import('../src/renderer/pages/settings')
  const view = renderSettings(context)
  await flushPromises()

  return {
    view,
    getUserMedia,
    permission,
    micTestButton: elements.get('#mic-test'),
    audioContexts,
    setAudioSetupFailure: (failure: AudioSetupFailure) => {
      audioSetupFailure = failure
    },
    setTimeoutMock,
    clearTimeoutMock,
    requestAnimationFrameMock,
    cancelAnimationFrameMock
  }
}

function makeStream() {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  return { stream, track }
}

describe('settings microphone test ownership', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prevents overlapping tests and cleans up late streams and recoverable failures', async () => {
    const permissionTrack = { stop: vi.fn() }
    const permissionStream = {
      getTracks: () => [permissionTrack]
    } as unknown as MediaStream
    const firstOpen = deferred<MediaStream>()
    const disposedOpen = deferred<MediaStream>()
    const firstTrack = { stop: vi.fn() }
    const disposedTrack = { stop: vi.fn() }
    const firstStream = { getTracks: () => [firstTrack] } as unknown as MediaStream
    const disposedStream = { getTracks: () => [disposedTrack] } as unknown as MediaStream
    const getUserMedia = vi
      .fn<(constraints?: MediaStreamConstraints) => Promise<MediaStream>>()
      .mockResolvedValueOnce(permissionStream)

    const elements = new Map<string, FakeElement>()
    const selectors = [
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
      '#key-badge',
      '#shortcut-chips',
      '#shortcut-capture',
      '#shortcut-action',
      '#shortcut-feedback',
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
    selectors.forEach((selector) => elements.set(selector, new FakeElement()))
    const content = new FakeElement(elements)

    const settings: PublicSettings = {
      engine: 'cloud',
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
      apiKeySource: 'none'
    }
    const context: AppContext = {
      content: content as unknown as HTMLElement,
      settings,
      history: [],
      appInfo: { version: '0.3.1', platform: 'win32', platformStatus: TEST_PLATFORM },
      platform: TEST_PLATFORM,
      engine: TEST_ENGINE,
      microphone: 'unknown',
      setHeading: vi.fn(),
      applySettings: vi.fn(),
      applyPlatform: vi.fn(),
      applyEngine: vi.fn(),
      navigate: vi.fn(),
      reloadHistory: vi.fn(async () => undefined)
    }

    let timeoutId = 0
    let frameId = 0
    vi.stubGlobal('window', {
      murmur: {
        onShortcutCapture: vi.fn(() => () => undefined),
        beginShortcutCapture: vi.fn(async () => undefined),
        cancelShortcutCapture: vi.fn(async () => undefined),
        openExternal: vi.fn(async () => undefined),
        clearApiKey: vi.fn(async () => settings),
        clearHistory: vi.fn(async () => undefined),
        saveSettings: vi.fn(async () => settings)
      },
      setTimeout: vi.fn(() => ++timeoutId),
      clearTimeout: vi.fn(),
      confirm: vi.fn(() => true)
    })
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia,
        enumerateDevices: vi.fn(async () => [])
      }
    })
    vi.stubGlobal(
      'Option',
      class {
        constructor(
          readonly text: string,
          readonly value: string
        ) {}
      }
    )
    vi.stubGlobal(
      'AudioContext',
      class {
        createAnalyser() {
          return { fftSize: 0, getByteTimeDomainData: vi.fn() }
        }
        createMediaStreamSource() {
          return { connect: vi.fn() }
        }
        close(): Promise<void> {
          return Promise.resolve()
        }
      }
    )
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => ++frameId))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const { renderSettings } = await import('../src/renderer/pages/settings')
    const view = renderSettings(context)
    await flushPromises()
    expect(permissionTrack.stop).toHaveBeenCalledTimes(1)

    getUserMedia.mockReturnValueOnce(firstOpen.promise)
    const micTestButton = elements.get('#mic-test')
    expect(micTestButton).toBeDefined()
    micTestButton?.emit('click')
    micTestButton?.emit('click')
    expect(getUserMedia).toHaveBeenCalledTimes(2) // permission probe + one test open

    firstOpen.resolve(firstStream)
    await flushPromises()
    expect(firstTrack.stop).toHaveBeenCalledTimes(1)

    // A failed open releases the slot, so the user can try again.
    getUserMedia.mockRejectedValueOnce(new DOMException('device busy', 'NotReadableError'))
    micTestButton?.emit('click')
    await flushPromises()
    expect(getUserMedia).toHaveBeenCalledTimes(3)

    // Disposing while the next open is pending must close a stream that
    // arrives after the view has gone away.
    getUserMedia.mockReturnValueOnce(disposedOpen.promise)
    micTestButton?.emit('click')
    expect(getUserMedia).toHaveBeenCalledTimes(4)

    view.dispose()
    disposedOpen.resolve(disposedStream)
    await flushPromises()

    expect(disposedTrack.stop).toHaveBeenCalledTimes(1)
  })

  it('stops an acquired stream when AudioContext construction fails and permits retry', async () => {
    const harness = await makeFocusedMicHarness()
    const failed = makeStream()
    const recovered = makeStream()
    expect(harness.permission.track.stop).toHaveBeenCalledTimes(1)

    harness.setAudioSetupFailure('construct')
    harness.getUserMedia.mockResolvedValueOnce(failed.stream)
    harness.micTestButton?.emit('click')
    await flushPromises()

    expect(failed.track.stop).toHaveBeenCalledTimes(1)
    expect(harness.audioContexts).toHaveLength(0)
    expect(harness.micTestButton?.textContent).toBe('Test')

    harness.setAudioSetupFailure(null)
    harness.getUserMedia.mockResolvedValueOnce(recovered.stream)
    harness.micTestButton?.emit('click')
    await flushPromises()

    expect(harness.getUserMedia).toHaveBeenCalledTimes(3)
    expect(harness.micTestButton?.textContent).toBe('Stop')
    harness.micTestButton?.emit('click')
    expect(recovered.track.stop).toHaveBeenCalledTimes(1)
    expect(harness.audioContexts.at(-1)?.close).toHaveBeenCalledTimes(1)
  })

  it('closes a created AudioContext when later setup fails and permits retry', async () => {
    const harness = await makeFocusedMicHarness()
    const failed = makeStream()
    const recovered = makeStream()

    harness.setAudioSetupFailure('source')
    harness.getUserMedia.mockResolvedValueOnce(failed.stream)
    harness.micTestButton?.emit('click')
    await flushPromises()

    expect(failed.track.stop).toHaveBeenCalledTimes(1)
    expect(harness.audioContexts).toHaveLength(1)
    expect(harness.audioContexts[0]?.close).toHaveBeenCalledTimes(1)
    expect(harness.requestAnimationFrameMock).not.toHaveBeenCalled()
    expect(harness.setTimeoutMock).not.toHaveBeenCalled()

    harness.setAudioSetupFailure(null)
    harness.getUserMedia.mockResolvedValueOnce(recovered.stream)
    harness.micTestButton?.emit('click')
    await flushPromises()

    expect(harness.getUserMedia).toHaveBeenCalledTimes(3)
    expect(harness.micTestButton?.textContent).toBe('Stop')
    harness.micTestButton?.emit('click')
    expect(recovered.track.stop).toHaveBeenCalledTimes(1)
    expect(harness.audioContexts.at(-1)?.close).toHaveBeenCalledTimes(1)
  })

  it('stops a running microphone test and cancels its frame and timeout', async () => {
    const harness = await makeFocusedMicHarness()
    const running = makeStream()
    harness.getUserMedia.mockResolvedValueOnce(running.stream)

    harness.micTestButton?.emit('click')
    await flushPromises()
    expect(harness.micTestButton?.textContent).toBe('Stop')
    expect(harness.requestAnimationFrameMock).toHaveBeenCalledTimes(1)
    expect(harness.setTimeoutMock).toHaveBeenCalledTimes(1)

    harness.micTestButton?.emit('click')

    expect(running.track.stop).toHaveBeenCalledTimes(1)
    expect(harness.audioContexts[0]?.close).toHaveBeenCalledTimes(1)
    expect(harness.cancelAnimationFrameMock).toHaveBeenCalledWith(1)
    expect(harness.clearTimeoutMock).toHaveBeenCalledWith(1)
    expect(harness.micTestButton?.textContent).toBe('Test')
  })

  it('disposes a running microphone test and cancels its frame and timeout', async () => {
    const harness = await makeFocusedMicHarness()
    const running = makeStream()
    harness.getUserMedia.mockResolvedValueOnce(running.stream)

    harness.micTestButton?.emit('click')
    await flushPromises()
    expect(harness.micTestButton?.textContent).toBe('Stop')

    harness.view.dispose()

    expect(running.track.stop).toHaveBeenCalledTimes(1)
    expect(harness.audioContexts[0]?.close).toHaveBeenCalledTimes(1)
    expect(harness.cancelAnimationFrameMock).toHaveBeenCalledWith(1)
    expect(harness.clearTimeoutMock).toHaveBeenCalledWith(1)
  })
})
