import { afterEach, describe, expect, it, vi } from 'vitest'
import { licenceStatus } from './fixtures/licence-status'
import type { AppContext } from '../src/renderer/app-context'
import {
  COUNTS_EXPLANATION,
  COUNTS_NOTICE,
  PRO_ACTIVATION_NOTICE,
  UPDATE_CHECK_EXPLANATION,
  UPDATE_CHECK_NOTICE,
  attributions,
  privacyNotice
} from '../src/renderer/pages/about'
import { available, type PlatformStatus } from '../src/shared/capabilities'
import { MODEL_NOT_READY_REASON } from '../src/shared/engine'
import type { PublicSettings, TranscriptionEngine } from '../src/shared/types'
import type { UpdateInstall, UpdateStatus } from '../src/shared/update'
import type { CountsReport, CountsStatus } from '../src/shared/usage-counts'

const REPORT: CountsReport = {
  v: '0.8.0',
  os: 'windows',
  engine: 'local',
  plan: 'trial',
  week: 1,
  activeDays7: 5,
  dictations7: 42,
  limitHit: false
}

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

  readonly attributes = new Map<string, string>()
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
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

/** A Mac or a development run: no installing from inside the app. */
const CANNOT_INSTALL: UpdateInstall = { supported: false, state: 'idle', percent: 0, version: null, error: null }

function render(
  engine: TranscriptionEngine,
  update: UpdateStatus = NOT_CHECKED,
  install: UpdateInstall = CANNOT_INSTALL
) {
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
        id: 'parakeet-tdt-0.6b-v3-q8',
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
  const getUpdateInstall = vi.fn(async () => install)
  const downloadUpdate = vi.fn(async (): Promise<UpdateInstall> => ({ ...install, state: 'downloading' }))
  const installUpdate = vi.fn(async () => true)
  const getCounts = vi.fn(async (): Promise<CountsStatus> => ({ enabled: false, report: REPORT }))
  const setUsageCounts = vi.fn(async (enabled: boolean): Promise<CountsStatus> => ({ enabled, report: REPORT }))
  vi.stubGlobal('window', {
    murmur: {
      openExternal,
      getUpdateStatus,
      checkForUpdates,
      setUpdateCheck,
      getUpdateInstall,
      downloadUpdate,
      installUpdate,
      getCounts,
      setUsageCounts
    }
  })
  vi.stubGlobal('document', { createElement: () => new FakeElement() })
  return {
    content,
    context,
    openExternal,
    getUpdateStatus,
    checkForUpdates,
    setUpdateCheck,
    downloadUpdate,
    installUpdate,
    getCounts,
    setUsageCounts
  }
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
      'Pro sends your licence key and a device label to Polar, the payment provider, when you ' +
        'press Activate, and then asks Polar once a day whether your subscription is still active.'
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
      'Speech model: NVIDIA Parakeet TDT 0.6B v3, CC-BY-4.0; ONNX export by the sherpa-onnx project (k2-fsa); weights quantised to int8 by Vocette.',
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

describe('the counts section', () => {
  it('is off until switched on, and says exactly what is sent', async () => {
    const { renderAbout } = await import('../src/renderer/pages/about')
    const { content, context, getCounts } = render('local')
    renderAbout(context)
    await flush()
    expect(getCounts).toHaveBeenCalledTimes(1)
    expect(content.querySelector('#usage-counts')?.checked).toBe(false)
    expect(content.querySelector('#usage-counts-explanation')?.textContent).toBe(COUNTS_EXPLANATION)
    expect(content.querySelector('#privacy-notice')?.textContent).not.toContain(COUNTS_NOTICE)
  })

  it('shows the exact report, as text, when asked', async () => {
    const { renderAbout } = await import('../src/renderer/pages/about')
    const { content, context } = render('local')
    renderAbout(context)
    await flush()
    expect(content.innerHTML).toContain('<pre class="counts-report" id="counts-report" hidden></pre>')
    const report = content.querySelector('#counts-report')
    if (report) report.hidden = true // as the markup starts it
    expect(JSON.parse(report?.textContent ?? '')).toEqual(REPORT)
    const show = content.querySelector('#show-counts')
    show?.listeners.forEach((listener) => listener())
    expect(report?.hidden).toBe(false)
    expect(show?.textContent).toBe('Hide what is sent')
  })

  it('saves the switch and then names counts among what leaves the PC', async () => {
    const { renderAbout } = await import('../src/renderer/pages/about')
    const { content, context, setUsageCounts } = render('cloud')
    renderAbout(context)
    await flush()
    const toggle = content.querySelector('#usage-counts')
    if (toggle) toggle.checked = true
    toggle?.listeners.forEach((listener) => listener())
    await flush()
    expect(setUsageCounts).toHaveBeenCalledWith(true)
    expect(content.querySelector('#privacy-notice')?.textContent).toContain(
      `${COUNTS_NOTICE} Nothing else leaves this computer.`
    )
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
      'Sends one request to GitHub (api.github.com) asking for the latest Vocette version. ' +
        'Nothing about you or your dictation is sent. Vocette never downloads or installs ' +
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
    expect(content.querySelector('#update-result')?.textContent).toBe('Vocette 0.6.0 is available.')
    const download = content.querySelector('#open-release')
    expect(download?.hidden).toBe(false)
    download?.listeners.forEach((listener) => listener())
    expect(openExternal).toHaveBeenCalledWith('release')
  })

  it('installs from inside the app where it can: download, progress, then restart', async () => {
    const { renderAbout } = await import('../src/renderer/pages/about')
    const available: UpdateStatus = { ...NOT_CHECKED, state: 'available', latest: 'v1.0.1' }
    const idle: UpdateInstall = { ...CANNOT_INSTALL, supported: true }
    const { content, context, downloadUpdate, installUpdate } = render('local', available, idle)
    const view = renderAbout(context)
    await flush()
    // The button, not the link to the release page.
    expect(content.querySelector('#open-release')?.hidden).toBe(true)
    expect(content.querySelector('#install-actions')?.hidden).toBe(false)
    const button = content.querySelector('#install-update')
    expect(button?.textContent).toBe('Download and install')

    button?.listeners.forEach((listener) => listener())
    await flush()
    expect(downloadUpdate).toHaveBeenCalledTimes(1)
    expect(button?.disabled).toBe(true)

    view.applyInstall({ ...idle, state: 'downloading', percent: 61 })
    expect(content.querySelector('#install-result')?.textContent).toBe('Downloading… 61%')

    view.applyInstall({ ...idle, state: 'ready', percent: 100, version: '1.0.1' })
    expect(button?.textContent).toBe('Restart to update')
    expect(button?.disabled).toBe(false)
    expect(content.querySelector('#install-result')?.textContent).toBe(
      'Vocette 1.0.1 is ready. It installs when you restart or quit Vocette.'
    )
    button?.listeners.forEach((listener) => listener())
    expect(installUpdate).toHaveBeenCalledTimes(1)
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
