import { afterEach, describe, expect, it, vi } from 'vitest'
import { licenceStatus } from './fixtures/licence-status'
import type { AppContext } from '../src/renderer/app-context'
import {
  PRO_ACTIVATION_NOTICE,
  UPDATE_CHECK_EXPLANATION,
  UPDATE_CHECK_NOTICE,
  attributions,
  privacyNotice
} from '../src/renderer/pages/about'
import { available, type PlatformStatus } from '../src/shared/capabilities'
import { MODEL_NOT_READY_REASON } from '../src/shared/engine'
import type { PublicSettings, TranscriptionEngine } from '../src/shared/types'
import type { UpdateStatus } from '../src/shared/update'

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
  checked = false
  disabled = false
  hidden = false
  readonly classes = new Set<string>()
  readonly classList = {
    toggle: (name: string, on: boolean): void => {
      if (on) this.classes.add(name)
      else this.classes.delete(name)
    }
  }
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

const NOT_CHECKED: UpdateStatus = {
  enabled: false,
  state: 'idle',
  current: '0.4.0',
  latest: null,
  checkedAt: null,
  error: null
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function render(engine: TranscriptionEngine, update: UpdateStatus = NOT_CHECKED) {
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
    licence: licenceStatus(),
    setHeading: vi.fn(),
    applySettings: vi.fn(),
    applyPlatform: vi.fn(),
    applyEngine: vi.fn(),
    applyLicence: vi.fn(),
    navigate: vi.fn(),
    reloadHistory: vi.fn(async () => undefined)
  }
  const openExternal = vi.fn(async () => undefined)
  const getUpdateStatus = vi.fn(async () => update)
  const checkForUpdates = vi.fn(async (): Promise<UpdateStatus> => ({ ...update, state: 'latest' }))
  const setUpdateCheck = vi.fn(async (enabled: boolean) => ({ ...update, enabled }))
  vi.stubGlobal('window', {
    murmur: { openExternal, getUpdateStatus, checkForUpdates, setUpdateCheck }
  })
  vi.stubGlobal('document', { createElement: () => new FakeElement() })
  return { content, context, openExternal, getUpdateStatus, checkForUpdates, setUpdateCheck }
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

  it("says what Pro's activation sends, on either engine, before claiming nothing else leaves", () => {
    expect(PRO_ACTIVATION_NOTICE).toBe(
      'Activating Pro sends your licence key and a device label to Polar, the payment provider, ' +
        'once, when you press Activate.'
    )
    expect(privacyNotice('local')).toContain(PRO_ACTIVATION_NOTICE)
    const cloud = privacyNotice('cloud')
    expect(cloud).toContain(PRO_ACTIVATION_NOTICE)
    expect(cloud.indexOf(PRO_ACTIVATION_NOTICE)).toBeLessThan(
      cloud.indexOf('Nothing else leaves this computer.')
    )
  })

  it('says what the update check sends, on either engine, before claiming nothing else leaves', () => {
    expect(privacyNotice('local')).toContain(UPDATE_CHECK_NOTICE)
    const cloud = privacyNotice('cloud')
    expect(cloud).toContain(UPDATE_CHECK_NOTICE)
    expect(cloud.indexOf(UPDATE_CHECK_NOTICE)).toBeLessThan(
      cloud.indexOf('Nothing else leaves this computer.')
    )
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

describe('the Updates section', () => {
  it('is off until switched on, and says exactly what a check sends', async () => {
    const { renderAbout } = await import('../src/renderer/pages/about')
    const { content, context, getUpdateStatus } = render('local')
    renderAbout(context)
    await flush()
    expect(content.innerHTML).toContain('<strong>Check for updates once a day</strong>')
    expect(content.querySelector('#update-check-explanation')?.textContent).toBe(
      UPDATE_CHECK_EXPLANATION
    )
    expect(UPDATE_CHECK_EXPLANATION).toBe(
      'Sends one request to GitHub (api.github.com) asking for the latest Murmur version. ' +
        'Nothing about you or your dictation is sent. Murmur never downloads or installs ' +
        'anything by itself.'
    )
    expect(getUpdateStatus).toHaveBeenCalledTimes(1)
    expect(content.querySelector('#update-check')?.checked).toBe(false)
    expect(content.querySelector('#update-result')?.textContent).toBe('')
    expect(content.querySelector('#open-release')?.hidden).toBe(true)
  })

  it('saves the switch, and checks when asked whether or not it is on', async () => {
    const { renderAbout } = await import('../src/renderer/pages/about')
    const { content, context, setUpdateCheck, checkForUpdates } = render('local')
    renderAbout(context)
    await flush()

    const toggle = content.querySelector('#update-check')
    if (toggle) toggle.checked = true
    toggle?.listeners.forEach((listener) => listener())
    await flush()
    expect(setUpdateCheck).toHaveBeenCalledWith(true)
    expect(toggle?.checked).toBe(true)

    content.querySelector('#check-updates')?.listeners.forEach((listener) => listener())
    await flush()
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    expect(content.querySelector('#update-result')?.textContent).toBe(
      'You have the latest version (0.4.0).'
    )
  })

  it('offers the release page once a newer version is found, and nothing else', async () => {
    const { renderAbout } = await import('../src/renderer/pages/about')
    const available: UpdateStatus = {
      ...NOT_CHECKED,
      state: 'available',
      latest: 'v0.6.0',
      checkedAt: '2026-09-28T10:00:00.000Z'
    }
    const { content, context, openExternal } = render('local', available)
    renderAbout(context)
    await flush()
    expect(content.querySelector('#update-result')?.textContent).toBe('Murmur 0.6.0 is available.')
    const download = content.querySelector('#open-release')
    expect(download?.hidden).toBe(false)
    download?.listeners.forEach((listener) => listener())
    expect(openExternal).toHaveBeenCalledWith('release')
  })

  it('shows why a check failed, and follows a status pushed while the page is open', async () => {
    const { renderAbout } = await import('../src/renderer/pages/about')
    const { content, context } = render('local')
    const view = renderAbout(context)
    await flush()
    view.applyUpdate({ ...NOT_CHECKED, state: 'checking' })
    expect(content.querySelector('#update-result')?.textContent).toBe('Checking…')
    expect(content.querySelector('#check-updates')?.disabled).toBe(true)

    view.applyUpdate({
      ...NOT_CHECKED,
      state: 'error',
      error: 'Could not reach GitHub. Check your internet connection and try again.'
    })
    const result = content.querySelector('#update-result')
    expect(result?.textContent).toBe(
      'Could not reach GitHub. Check your internet connection and try again.'
    )
    expect(result?.classes.has('is-error')).toBe(true)
    expect(content.querySelector('#check-updates')?.disabled).toBe(false)
  })
})
