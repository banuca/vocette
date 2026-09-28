import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../src/renderer/app-context'
import { attributions, privacyNotice } from '../src/renderer/pages/about'
import { available, type PlatformStatus } from '../src/shared/capabilities'
import { MODEL_NOT_READY_REASON } from '../src/shared/engine'
import type { PublicSettings, TranscriptionEngine } from '../src/shared/types'

/**
 * The About page makes claims about where audio goes. They have to be true
 * for the engine in use, and the credits the on-device engine owes have to be
 * there whichever engine that is.
 */

const PLATFORM: PlatformStatus = {
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
  textContent: string | null = ''
  children: FakeElement[] = []
  readonly listeners: Array<() => void> = []

  constructor(private readonly elements?: Map<string, FakeElement>) {}

  querySelector(selector: string): FakeElement | null {
    if (!this.elements) return null
    // Only what the markup actually contains can be found.
    if (!this.innerHTML.includes(`id="${selector.slice(1)}"`)) return null
    const existing = this.elements.get(selector)
    if (existing) return existing
    const created = new FakeElement()
    this.elements.set(selector, created)
    return created
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = children
  }

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener)
  }
}

function render(engine: TranscriptionEngine) {
  const content = new FakeElement(new Map())
  const context: AppContext = {
    content: content as unknown as HTMLElement,
    settings: { engine } as PublicSettings,
    history: [],
    appInfo: { version: '0.4.0', platform: 'win32', platformStatus: PLATFORM },
    platform: PLATFORM,
    engine: {
      engine,
      model: {
        id: 'parakeet-tdt-0.6b-v3-int8',
        state: 'missing',
        receivedBytes: 0,
        totalBytes: 670_478_772,
        error: null
      },
      ready: false,
      notReadyReason: MODEL_NOT_READY_REASON
    },
    workflow: { phase: 'idle', message: 'Ready' },
    microphone: 'unknown',
    setHeading: vi.fn(),
    applySettings: vi.fn(),
    applyPlatform: vi.fn(),
    applyEngine: vi.fn(),
    navigate: vi.fn(),
    reloadHistory: vi.fn(async () => undefined)
  }
  const openExternal = vi.fn(async () => undefined)
  vi.stubGlobal('window', { murmur: { openExternal } })
  vi.stubGlobal('document', { createElement: () => new FakeElement() })
  return { content, context, openExternal }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('privacyNotice', () => {
  it('says audio stays on this PC with the on-device engine', () => {
    const text = privacyNotice('local')
    expect(text).toContain('Your audio is transcribed on this PC and never leaves it')
    expect(text).not.toContain('the transcription provider you configure')
  })

  it('names the provider, and the vocabulary sent to it, for the cloud', () => {
    const text = privacyNotice('cloud')
    expect(text).toContain('only to the transcription provider you configure')
    expect(text).toContain('the vocabulary you set in Settings')
  })
})

describe('renderAbout', () => {
  it('replaces the API key card with Private by default', async () => {
    const { renderAbout } = await import('../src/renderer/pages/about')
    const { content, context } = render('local')
    renderAbout(context)
    expect(content.innerHTML).toContain('<h3>Private by default</h3>')
    expect(content.innerHTML).toContain(
      'Transcription runs on this PC. A cloud provider is optional and uses your own key.'
    )
    expect(content.innerHTML).not.toContain('Your API key')
  })

  it('credits the model from its manifest, the libraries that run it, and the word list', async () => {
    const { renderAbout } = await import('../src/renderer/pages/about')
    const { content, context } = render('local')
    renderAbout(context)
    const list = content.querySelector('#attributions')
    expect(list?.children.map((item) => item.textContent)).toEqual([
      'Speech model: NVIDIA Parakeet TDT 0.6B v3, CC-BY-4.0; ONNX export by the sherpa-onnx project (k2-fsa).',
      'sherpa-onnx — Apache-2.0',
      'ONNX Runtime — MIT',
      'Word list: SCOWL, © Kevin Atkinson'
    ])
    expect(attributions()).toHaveLength(4)
  })

  it('tells an on-device user where their audio goes, without the API documentation', async () => {
    const { renderAbout } = await import('../src/renderer/pages/about')
    const { content, context } = render('local')
    renderAbout(context)
    expect(content.querySelector('#privacy-notice')?.textContent).toBe(privacyNotice('local'))
    expect(content.querySelector('#open-transcription-docs')).toBeNull()
  })

  it('tells a cloud user the same, with the documentation one click away', async () => {
    const { renderAbout } = await import('../src/renderer/pages/about')
    const { content, context, openExternal } = render('cloud')
    renderAbout(context)
    expect(content.querySelector('#privacy-notice')?.textContent).toBe(privacyNotice('cloud'))
    const docs = content.querySelector('#open-transcription-docs')
    docs?.listeners.forEach((listener) => listener())
    expect(openExternal).toHaveBeenCalledWith('transcription-docs')
  })
})
