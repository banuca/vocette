import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../src/renderer/app-context'
import { available, type PlatformStatus } from '../src/shared/capabilities'
import type { LicenceActivation, LicenceRelease, LicenceStatus } from '../src/shared/types'
import { LAUNCH_OFFER, licenceStatus } from './fixtures/licence-status'

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

const CONFIRMED_TODAY = new Date().toISOString()

const LICENSED = {
  licence: {
    displayKey: '****-E304DA',
    activatedAt: '2026-09-25T13:48:13.251Z',
    standing: 'active',
    confirmedAt: CONFIRMED_TODAY,
    graceDaysLeft: 30
  }
} satisfies Partial<LicenceStatus>

const ENDED = {
  licence: { ...LICENSED.licence, standing: 'ended', graceDaysLeft: 0 }
} satisfies Partial<LicenceStatus>

class FakeElement {
  innerHTML = ''
  value = ''
  className = ''
  private text: string | null = ''

  /** As in the DOM, setting the text replaces whatever the element held. */
  get textContent(): string | null {
    return this.text
  }

  set textContent(value: string | null) {
    this.text = value
    this.children = []
  }

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

  append(...nodes: FakeElement[]): void {
    this.children = [...this.children, ...nodes]
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
  '#subscribe-monthly',
  '#subscribe-yearly',
  '#launch-offer',
  '#plans-note',
  '#check-subscription',
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
  check?: () => Promise<LicenceStatus>
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
  const checkSubscription = vi.fn(
    answers.check ?? (async (): Promise<LicenceStatus> => licenceStatus({ plan: 'pro', ...LICENSED }))
  )
  const openExternal = vi.fn(async () => undefined)
  const confirm = vi.fn(() => answers.confirm ?? true)

  vi.stubGlobal('window', {
    murmur: { activateLicence, releaseLicence, removeLicenceLocally, checkSubscription, openExternal },
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
    checkSubscription,
    openExternal,
    confirm
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the Pro page', () => {
  it('shows the trial, what Pro adds, what stays free, and the two plans', async () => {
    const { at } = await makeHarness(licenceStatus({ plan: 'trial', trialDaysLeft: 23 }))
    expect(at('#pro-status').textContent).toBe('Pro trial — 23 days left')
    expect(at('#pro-adds').children.map((item) => item.textContent)).toEqual([
      'Up to 500 vocabulary terms in use, instead of 50',
      'Up to 200 replacements and snippets in use, instead of 20',
      'AI polish: your dictation rewritten in the style you choose, with your own provider or a model on this PC'
    ])
    expect(at('#free-forever').children).toHaveLength(4)
    expect(at('#subscribe-yearly').textContent).toBe('Yearly — US$49 a year · two months free')
    expect(at('#subscribe-monthly').textContent).toBe('Monthly — US$4.99 a month')
    expect(at('#subscribe-yearly').children).toHaveLength(0)
    expect(at('#subscribe-yearly').disabled).toBe(false)
    expect(at('#subscribe-monthly').disabled).toBe(false)
    expect(at('#launch-offer').hidden).toBe(true)
    expect(at('#plans-note').textContent).toBe(
      'One subscription covers up to 10 devices. Cancel any time; Pro stays on until the end of ' +
        'the period you have paid for.'
    )
    expect(at('#pro-buy').hidden).toBe(false)
  })

  it('shows the launch offer above the plans, with the normal prices struck through', async () => {
    const { at } = await makeHarness(
      licenceStatus({ plan: 'trial', trialDaysLeft: 29, launchOffer: LAUNCH_OFFER })
    )
    expect(at('#launch-offer').hidden).toBe(false)
    expect(at('#launch-offer').textContent).toBe(
      'Launch offer for the first 100 subscribers, until 31 December 2026: the yearly plan at ' +
        'half price forever, the monthly plan at 25% off forever.'
    )
    expect(at('#subscribe-yearly').textContent).toBe('Yearly — US$24.50 a year')
    expect(at('#subscribe-yearly').children.map((node) => [node.className, node.textContent])).toEqual([
      ['was-price', 'US$49']
    ])
    expect(at('#subscribe-monthly').textContent).toBe('Monthly — US$3.74 a month')
    expect(at('#subscribe-monthly').children.map((node) => node.textContent)).toEqual(['US$4.99'])
  })

  it('names Free plainly', async () => {
    const { at } = await makeHarness(licenceStatus({ plan: 'free' }))
    expect(at('#pro-status').textContent).toBe('Free — everything you need, for good')
  })

  it('disables each plan, and says it opens soon, until it has a checkout', async () => {
    const { at, openExternal } = await makeHarness(
      licenceStatus({ plan: 'trial', monthlyCheckoutAvailable: false, yearlyCheckoutAvailable: false })
    )
    expect(at('#subscribe-monthly').textContent).toBe('Monthly — opens soon')
    expect(at('#subscribe-yearly').textContent).toBe('Yearly — opens soon')
    expect(at('#subscribe-monthly').disabled).toBe(true)
    at('#subscribe-monthly').emit('click')
    at('#subscribe-yearly').emit('click')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('opens each checkout through its allow-listed name', async () => {
    const { at, openExternal } = await makeHarness(licenceStatus({ plan: 'free' }))
    at('#subscribe-monthly').emit('click')
    at('#subscribe-yearly').emit('click')
    expect(openExternal.mock.calls).toEqual([['checkout-monthly'], ['checkout-yearly']])
  })

  it('says what activating sends, before anything is sent', async () => {
    const { at } = await makeHarness(licenceStatus({ plan: 'trial' }))
    expect(at('#licence-note').textContent).toBe(
      'Activating sends your key and a device label (“Vocette on Windows · 7F3A”) to Polar, our ' +
        'payment provider. While you are subscribed, Vocette asks Polar once a day whether the ' +
        'subscription is still active, and sends nothing else.'
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
      'Pro is active on this PC. Thank you for subscribing to Vocette.'
    )
    expect(harness.applyLicence).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'pro', licence: LICENSED.licence })
    )
    expect(harness.at('#licence-active').hidden).toBe(false)
    expect(harness.at('#licence-entry').hidden).toBe(true)
    expect(harness.at('#licence-active-line').textContent).toBe(
      'Subscription active on this PC · key ending E304DA · confirmed today'
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
    expect(withPortal.at('#pro-status').textContent).toBe('Pro — thank you for supporting Vocette')
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
      'The device slot stays in use until you release it in your Polar account.'
    )

    harness.at('#remove-local').emit('click')
    await harness.settle()
    expect(harness.confirm).toHaveBeenLastCalledWith(
      expect.stringContaining('without releasing it')
    )
    expect(harness.removeLicenceLocally).toHaveBeenCalledTimes(1)
    expect(harness.at('#licence-feedback').textContent).toBe(
      'Pro was removed from this PC. Its device slot stays in use until you release it in your Polar account.'
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

  it('offers the plans again once a subscription has ended, and says how to get Pro back', async () => {
    const { at } = await makeHarness(licenceStatus({ plan: 'free', ...ENDED }))
    expect(at('#pro-status').textContent).toBe('Free — your Pro subscription has ended')
    expect(at('#pro-buy').hidden).toBe(false)
    expect(at('#licence-active-line').textContent).toBe(
      'Your subscription has ended (key ending E304DA). Subscribe again and this key works ' +
        'again — press Check now once you have.'
    )
  })

  it('checks the subscription when asked, and says what it found', async () => {
    const harness = await makeHarness(licenceStatus({ plan: 'free', ...ENDED }))
    harness.at('#check-subscription').emit('click')
    await harness.settle()
    expect(harness.checkSubscription).toHaveBeenCalledTimes(1)
    expect(harness.at('#licence-feedback').textContent).toBe('Your subscription is active.')
    expect(harness.applyLicence).toHaveBeenCalledWith(expect.objectContaining({ plan: 'pro' }))
    expect(harness.at('#pro-buy').hidden).toBe(true)
  })

  it('shows why a check could not tell, and disables Check now while one is out', async () => {
    const message = 'Could not reach Polar to confirm your subscription. Vocette tries again later.'
    const harness = await makeHarness(licenceStatus({ plan: 'pro', ...LICENSED }), {
      check: async () => licenceStatus({ plan: 'pro', ...LICENSED, checkMessage: message })
    })
    harness.at('#check-subscription').emit('click')
    await harness.settle()
    expect(harness.at('#licence-feedback').textContent).toBe(message)

    harness.view.apply(licenceStatus({ plan: 'pro', ...LICENSED, checking: true }))
    expect(harness.at('#check-subscription').disabled).toBe(true)
    expect(harness.at('#check-subscription').textContent).toBe('Checking…')
  })
})