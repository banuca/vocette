import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../src/renderer/app-context'
import { available, type PlatformStatus } from '../src/shared/capabilities'
import type { LicenceActivation, LicenceRelease, LicenceStatus } from '../src/shared/types'
import { licenceStatus } from './fixtures/licence-status'

/**
 * The Pro page, driven through the same render function the app uses, with
 * the bridge faked: nothing here reaches the main process, let alone Polar.
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

const LICENSED = {
  licence: { displayKey: '****-E304DA', activatedAt: '2026-09-25T13:48:13.251Z' }
} as const

class FakeElement {
  innerHTML = ''
  value = ''
  textContent: string | null = ''
  className = ''
  hidden = false
  disabled = false
  children: FakeElement[] = []
  private readonly listeners = new Map<string, Array<(event: unknown) => unknown>>()

  constructor(private readonly elements?: Map<string, FakeElement>) {}

  querySelector<T>(selector: string): T | null {
    return (this.elements?.get(selector) ?? null) as T | null
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children = nodes
  }

  addEventListener(type: string, listener: (event: unknown) => unknown): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  emit(type: string, event: unknown = {}): void {
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }
}

const SELECTORS = [
  '#pro-status',
  '#pro-status-detail',
  '#pro-adds',
  '#free-forever',
  '#pro-buy',
  '#buy-pro',
  '#licence-summary',
  '#licence-entry',
  '#licence-key',
  '#activate-licence',
  '#licence-note',
  '#licence-active',
  '#licence-active-line',
  '#release-licence',
  '#manage-purchase',
  '#remove-local-row',
  '#remove-local-note',
  '#remove-local',
  '#licence-feedback'
]

interface BridgeAnswers {
  activate?: (key: string) => Promise<LicenceActivation>
  release?: () => Promise<LicenceRelease>
  removeLocally?: () => Promise<LicenceStatus>
  confirm?: boolean
}

async function makeHarness(status: LicenceStatus, answers: BridgeAnswers = {}) {
  const elements = new Map<string, FakeElement>()
  SELECTORS.forEach((selector) => elements.set(selector, new FakeElement()))
  const content = new FakeElement(elements)

  const applyLicence = vi.fn<(next: LicenceStatus) => void>()
  const context: AppContext = {
    content: content as unknown as HTMLElement,
    settings: {} as AppContext['settings'],
    history: [],
    appInfo: { version: '0.4.0', platform: 'win32', platformStatus: PLATFORM },
    platform: PLATFORM,
    engine: {
      engine: 'local',
      model: {
        id: 'parakeet-tdt-0.6b-v3-int8',
        state: 'installed',
        receivedBytes: 1,
        totalBytes: 1,
        error: null
      },
      ready: true,
      notReadyReason: null
    },
    workflow: { phase: 'idle', message: 'Ready' },
    microphone: 'granted',
    licence: status,
    setHeading: vi.fn(),
    applySettings: vi.fn(),
    applyPlatform: vi.fn(),
    applyEngine: vi.fn(),
    applyLicence,
    navigate: vi.fn(),
    reloadHistory: vi.fn(async () => undefined)
  }

  const activateLicence = vi.fn(
    answers.activate ??
      (async (): Promise<LicenceActivation> => ({
        ok: true,
        status: licenceStatus({ plan: 'pro', ...LICENSED })
      }))
  )
  const releaseLicence = vi.fn(
    answers.release ??
      (async (): Promise<LicenceRelease> => ({ ok: true, status: licenceStatus({ plan: 'free' }) }))
  )
  const removeLicenceLocally = vi.fn(
    answers.removeLocally ?? (async (): Promise<LicenceStatus> => licenceStatus({ plan: 'free' }))
  )
  const openExternal = vi.fn(async () => undefined)
  const confirm = vi.fn(() => answers.confirm ?? true)

  vi.stubGlobal('window', {
    murmur: { activateLicence, releaseLicence, removeLicenceLocally, openExternal },
    confirm
  })
  vi.stubGlobal('document', { createElement: () => new FakeElement() })

  const { renderPro } = await import('../src/renderer/pages/pro')
  const view = renderPro(context)

  const at = (selector: string): FakeElement => {
    const element = elements.get(selector)
    if (!element) throw new Error(`no fake element for ${selector}`)
    return element
  }
  const settle = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve))

  return {
    view,
    at,
    settle,
    context,
    applyLicence,
    activateLicence,
    releaseLicence,
    removeLicenceLocally,
    openExternal,
    confirm
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the Pro page', () => {
  it('shows the trial, what Pro adds, what stays free, and the price', async () => {
    const { at } = await makeHarness(licenceStatus({ plan: 'trial', trialDaysLeft: 23 }))
    expect(at('#pro-status').textContent).toBe('Pro trial — 23 days left')
    expect(at('#pro-adds').children.map((item) => item.textContent)).toEqual([
      'Up to 500 vocabulary terms in use, instead of 50',
      'Up to 200 replacements and snippets in use, instead of 20',
      'AI polish: your dictation rewritten in the style you choose, with your own provider or a model on this PC'
    ])
    expect(at('#free-forever').children).toHaveLength(4)
    expect(at('#buy-pro').textContent).toBe('Buy Pro — US$29, once, for up to 3 PCs')
    expect(at('#buy-pro').disabled).toBe(false)
    expect(at('#pro-buy').hidden).toBe(false)
  })

  it('names Free plainly', async () => {
    const { at } = await makeHarness(licenceStatus({ plan: 'free' }))
    expect(at('#pro-status').textContent).toBe('Free — everything you need, for good')
  })

  it('disables Buy, and says purchases open soon, until there is a checkout', async () => {
    const { at, openExternal } = await makeHarness(
      licenceStatus({ plan: 'trial', checkoutAvailable: false })
    )
    expect(at('#buy-pro').textContent).toBe('Pro purchases open soon')
    expect(at('#buy-pro').disabled).toBe(true)
    at('#buy-pro').emit('click')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('opens the checkout through its allow-listed name', async () => {
    const { at, openExternal } = await makeHarness(licenceStatus({ plan: 'free' }))
    at('#buy-pro').emit('click')
    expect(openExternal).toHaveBeenCalledWith('checkout')
  })

  it('says what activating sends, before anything is sent', async () => {
    const { at } = await makeHarness(licenceStatus({ plan: 'trial' }))
    expect(at('#licence-note').textContent).toBe(
      'Activating sends your key and a device label (“Murmur on Windows · 7F3A”) to Polar, our ' +
        'payment provider, once. Murmur never checks again.'
    )
    expect(at('#licence-entry').hidden).toBe(false)
    expect(at('#licence-active').hidden).toBe(true)
  })

  it('keeps the key field closed until purchases are configured', async () => {
    const { at } = await makeHarness(licenceStatus({ plan: 'trial', purchasesConfigured: false }))
    expect(at('#licence-key').disabled).toBe(true)
    expect(at('#activate-licence').disabled).toBe(true)
    expect(at('#licence-note').textContent).toBe(
      'Licence keys can be activated once Pro purchases open.'
    )
  })

  it('activates the key as typed, and the whole window hears the answer', async () => {
    const harness = await makeHarness(licenceStatus({ plan: 'trial' }))
    harness.at('#licence-key').value = ' MURMUR-KEY '
    harness.at('#activate-licence').emit('click')
    // Pressed twice before the answer: one request.
    harness.at('#activate-licence').emit('click')
    await harness.settle()

    expect(harness.activateLicence).toHaveBeenCalledTimes(1)
    expect(harness.activateLicence).toHaveBeenCalledWith(' MURMUR-KEY ')
    expect(harness.at('#licence-key').value).toBe('')
    expect(harness.at('#licence-feedback').textContent).toBe(
      'Pro is active on this PC. Thank you for supporting Murmur.'
    )
    expect(harness.applyLicence).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'pro', licence: LICENSED.licence })
    )
    expect(harness.at('#licence-active').hidden).toBe(false)
    expect(harness.at('#licence-entry').hidden).toBe(true)
    expect(harness.at('#licence-active-line').textContent).toBe(
      'Pro is active on this PC · key ending E304DA · activated 25 September 2026'
    )
    // Nothing left to buy.
    expect(harness.at('#pro-buy').hidden).toBe(true)
  })

  it('shows a refusal in its own words, and keeps the key for another try', async () => {
    const error = 'That licence key was not recognised. Check it and try again.'
    const harness = await makeHarness(licenceStatus({ plan: 'trial' }), {
      activate: async () => ({ ok: false, error, status: licenceStatus({ plan: 'trial' }) })
    })
    harness.at('#licence-key').value = 'MURMUR-TYPO'
    harness.at('#activate-licence').emit('click')
    await harness.settle()

    expect(harness.at('#licence-feedback').textContent).toBe(error)
    expect(harness.at('#licence-feedback').className).toContain('tone-error')
    expect(harness.at('#licence-key').value).toBe('MURMUR-TYPO')
    expect(harness.at('#activate-licence').disabled).toBe(false)
  })

  it('shows the main process’s sentence, not Electron’s plumbing, when the call itself fails', async () => {
    const harness = await makeHarness(licenceStatus({ plan: 'trial' }), {
      activate: async () => {
        throw new Error("Error invoking remote method 'licence:activate': Error: Forbidden.")
      }
    })
    harness.at('#licence-key').value = 'MURMUR-KEY'
    harness.at('#activate-licence').emit('click')
    await harness.settle()
    expect(harness.at('#licence-feedback').textContent).toBe('Forbidden.')
  })

  it('shows the active licence, and the portal only once it is configured', async () => {
    const withPortal = await makeHarness(licenceStatus({ plan: 'pro', ...LICENSED }))
    expect(withPortal.at('#pro-status').textContent).toBe('Pro — thank you for supporting Murmur')
    expect(withPortal.at('#manage-purchase').hidden).toBe(false)
    withPortal.at('#manage-purchase').emit('click')
    expect(withPortal.openExternal).toHaveBeenCalledWith('customer-portal')

    const withoutPortal = await makeHarness(
      licenceStatus({ plan: 'pro', ...LICENSED, portalAvailable: false })
    )
    expect(withoutPortal.at('#manage-purchase').hidden).toBe(true)
  })

  it('asks before releasing this PC, and releases it', async () => {
    const declined = await makeHarness(licenceStatus({ plan: 'pro', ...LICENSED }), {
      confirm: false
    })
    declined.at('#release-licence').emit('click')
    await declined.settle()
    expect(declined.releaseLicence).not.toHaveBeenCalled()

    const harness = await makeHarness(licenceStatus({ plan: 'pro', ...LICENSED }))
    harness.at('#release-licence').emit('click')
    await harness.settle()
    expect(harness.confirm).toHaveBeenCalledWith(expect.stringContaining('Release this PC?'))
    expect(harness.releaseLicence).toHaveBeenCalledTimes(1)
    expect(harness.at('#licence-feedback').textContent).toBe(
      'This PC was released. Its device slot is free for another PC.'
    )
    expect(harness.at('#licence-active').hidden).toBe(true)
  })

  it('offers "Remove from this PC anyway" when Polar cannot be reached, saying the slot stays used', async () => {
    const licensed = licenceStatus({ plan: 'pro', ...LICENSED })
    const harness = await makeHarness(licensed, {
      release: async () => ({
        ok: false,
        canRemoveLocally: true,
        error:
          'Could not reach Polar, so this PC was not released. Check your internet connection and try again.',
        status: licensed
      })
    })
    expect(harness.at('#remove-local-row').hidden).toBe(true)
    harness.at('#release-licence').emit('click')
    await harness.settle()

    expect(harness.at('#licence-feedback').textContent).toContain('Could not reach Polar')
    expect(harness.at('#remove-local-row').hidden).toBe(false)
    expect(harness.at('#remove-local-note').textContent).toContain(
      'The device slot stays in use until you release it from your purchase email.'
    )

    harness.at('#remove-local').emit('click')
    await harness.settle()
    expect(harness.confirm).toHaveBeenLastCalledWith(
      expect.stringContaining('without releasing it')
    )
    expect(harness.removeLicenceLocally).toHaveBeenCalledTimes(1)
    expect(harness.at('#licence-feedback').textContent).toBe(
      'Pro was removed from this PC. Its device slot stays in use until you release it from your purchase email.'
    )
    expect(harness.at('#remove-local-row').hidden).toBe(true)
  })

  it('does not offer to remove it here after a refusal that a minute will fix', async () => {
    const licensed = licenceStatus({ plan: 'pro', ...LICENSED })
    const harness = await makeHarness(licensed, {
      release: async () => ({
        ok: false,
        canRemoveLocally: false,
        error: 'Too many attempts. Wait a minute and try again.',
        status: licensed
      })
    })
    harness.at('#release-licence').emit('click')
    await harness.settle()
    expect(harness.at('#licence-feedback').textContent).toBe(
      'Too many attempts. Wait a minute and try again.'
    )
    expect(harness.at('#remove-local-row').hidden).toBe(true)
  })

  it('follows a status pushed while it is open', async () => {
    const { view, at } = await makeHarness(licenceStatus({ plan: 'trial', trialDaysLeft: 1 }))
    view.apply(licenceStatus({ plan: 'free', trialEndNoticeDue: true }))
    expect(at('#pro-status').textContent).toBe('Free — everything you need, for good')
  })
})
