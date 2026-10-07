import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LICENCE_MESSAGES,
  LicenceClient,
  checkoutConfig,
  deviceLabel,
  launchOfferFor,
  licenceConfig,
  licenceStatusFor,
  purchasesConfigured,
  unexpectedReply,
  type ActivationRequest,
  type LicenceFetch
} from '../src/main/licence'
import { entitlementFor } from '../src/shared/entitlement'
import {
  CHECKOUT_URL_MONTHLY,
  CHECKOUT_URL_YEARLY,
  LAUNCH_OFFER_ENDS_AT,
  POLAR_API_BASE,
  POLAR_ORGANIZATION_ID,
  POLAR_PRO_BENEFIT_IDS
} from '../src/shared/product'

/**
 * The licence client, against a fake `fetch` only: nothing here reaches
 * Polar. The shapes are Polar's own, from its OpenAPI spec and source
 * (docs/research/licensing.md §2.2 and §2.4).
 */

const ORG = 'fda84e25-7b55-4d67-916d-60ead04ff61f'
const BENEFIT = '32a8eda4-56cf-4a94-8228-792d324a519e'
const ACTIVATION = 'b6724bc8-7ad9-4ca0-b143-7c896fcbb6fe'
const KEY = 'MURMUR-1C285B2D-6CE6-4BC7-B8BE-ADB6A7E304DA'
const NOW = Date.parse('2026-09-25T13:48:13.000Z')

const REQUEST: ActivationRequest = {
  apiBase: 'https://sandbox-api.polar.sh/',
  orgId: ORG,
  benefitIds: [BENEFIT],
  label: 'Vocette on Windows · 7F3A',
  appVersion: '0.4.0'
}

/** Polar's 200, customer and all: the client must read almost none of it. */
function granted(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ACTIVATION,
    license_key_id: '508176f7-065a-4b5d-b524-4e9c8a11ed63',
    label: REQUEST.label,
    meta: { app_version: '0.4.0' },
    created_at: '2026-09-25T13:48:13.251621Z',
    modified_at: null,
    license_key: {
      id: '508176f7-065a-4b5d-b524-4e9c8a11ed63',
      created_at: '2026-09-20T08:40:34.769148Z',
      modified_at: null,
      organization_id: ORG,
      customer_id: 'd910050c-be66-4ca0-b4cc-34fde514f227',
      customer: {
        id: 'd910050c-be66-4ca0-b4cc-34fde514f227',
        email: 'buyer@example.com',
        email_verified: true,
        name: 'Ada Buyer',
        billing_name: 'Ada Buyer',
        billing_address: { country: 'CH', line1: '1 Rue du Lac', city: 'Genève' },
        tax_id: null
      },
      benefit_id: BENEFIT,
      key: KEY,
      display_key: '****-E304DA',
      status: 'granted',
      limit_activations: 3,
      usage: 0,
      limit_usage: null,
      validations: 0,
      last_validated_at: null,
      expires_at: null,
      ...overrides
    }
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function harness(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn<LicenceFetch>(async (url, init) => answer(url, init))
  const client = new LicenceClient({ fetch, now: () => NOW, timeoutMs: 40 })
  const sent = (index = 0): { url: string; init: RequestInit; body: Record<string, unknown> } => {
    const call = fetch.mock.calls[index]
    if (!call) throw new Error(`No request ${index} was sent.`)
    const [url, init] = call
    return { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> }
  }
  return { fetch, client, sent }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('activating a key', () => {
  it('returns the activation id, the benefit and the masked key — and nothing else', async () => {
    const { client } = harness(() => json(200, granted()))
    const result = await client.activate(KEY, REQUEST)
    expect(result).toEqual({
      ok: true,
      activationId: ACTIVATION,
      benefitId: BENEFIT,
      displayKey: '****-E304DA'
    })
    // The buyer's name, email and address came back from Polar; none of it
    // goes any further.
    const kept = JSON.stringify(result)
    for (const personal of ['buyer@example.com', 'Ada Buyer', 'Rue du Lac', 'Genève', 'd910050c']) {
      expect(kept).not.toContain(personal)
    }
    expect(kept).not.toContain(KEY)
  })

  it('sends one POST with the key, organisation, label and version, and no credentials', async () => {
    const { client, fetch, sent } = harness(() => json(200, granted()))
    await client.activate(`  ${KEY}\n`, REQUEST)

    expect(fetch).toHaveBeenCalledTimes(1)
    const { url, init, body } = sent()
    expect(url).toBe('https://sandbox-api.polar.sh/v1/customer-portal/license-keys/activate')
    expect(init.method).toBe('POST')
    expect(body).toEqual({
      key: KEY,
      organization_id: ORG,
      label: 'Vocette on Windows · 7F3A',
      meta: { app_version: '0.4.0' }
    })
    // Only a content type: no Authorization, and no Polar-Version pin, which
    // would stop this build activating once Polar retires that version.
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    const headers = new Headers(init.headers)
    expect(headers.has('authorization')).toBe(false)
    expect(headers.has('polar-version')).toBe(false)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('logs nothing, on success or failure', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined)
    )
    await harness(() => json(200, granted())).client.activate(KEY, REQUEST)
    await harness(() => json(403, { detail: 'License key has expired.' })).client.activate(KEY, REQUEST)
    await harness(() => {
      throw new TypeError('fetch failed')
    }).client.activate(KEY, REQUEST)
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it('refuses an empty or absurdly long key without asking Polar', async () => {
    const { client, fetch } = harness(() => json(200, granted()))
    expect(await client.activate('   \n', REQUEST)).toEqual({ ok: false, error: LICENCE_MESSAGES.empty })
    expect(await client.activate('K'.repeat(201), REQUEST)).toEqual({
      ok: false,
      error: 'That does not look like a Vocette licence key.'
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('asks nothing while purchases are not configured', async () => {
    const { client, fetch } = harness(() => json(200, granted()))
    expect(await client.activate(KEY, { ...REQUEST, orgId: '' })).toEqual({
      ok: false,
      error: LICENCE_MESSAGES.notConfigured
    })
    expect(await client.activate(KEY, { ...REQUEST, benefitIds: [] })).toEqual({
      ok: false,
      error: LICENCE_MESSAGES.notConfigured
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses a key for another product', async () => {
    const { client } = harness(() => json(200, granted({ benefit_id: 'another-benefit' })))
    expect(await client.activate(KEY, REQUEST)).toEqual({
      ok: false,
      error: 'That key is for a different product.'
    })
  })

  it('refuses a key that is not granted', async () => {
    const { client } = harness(() => json(200, granted({ status: 'revoked' })))
    expect(await client.activate(KEY, REQUEST)).toEqual({
      ok: false,
      error: 'This licence key is not active: its subscription has ended, or it was disabled.'
    })
  })

  it('refuses a key whose expiry has passed, or cannot be read, and accepts one still to come', async () => {
    const past = harness(() => json(200, granted({ expires_at: '2026-09-01T00:00:00Z' })))
    expect(await past.client.activate(KEY, REQUEST)).toEqual({
      ok: false,
      error: 'This licence key has expired.'
    })
    const unreadable = harness(() => json(200, granted({ expires_at: 'someday' })))
    expect((await unreadable.client.activate(KEY, REQUEST)).ok).toBe(false)
    const future = harness(() => json(200, granted({ expires_at: '2027-09-25T00:00:00Z' })))
    expect((await future.client.activate(KEY, REQUEST)).ok).toBe(true)
    const absent = granted()
    delete (absent.license_key as Record<string, unknown>).expires_at
    expect((await harness(() => json(200, absent)).client.activate(KEY, REQUEST)).ok).toBe(true)
  })

  it('treats a 200 it cannot read as an API it no longer knows', async () => {
    const noId = granted()
    delete noId.id
    expect(await harness(() => json(200, noId)).client.activate(KEY, REQUEST)).toEqual({
      ok: false,
      error: LICENCE_MESSAGES.outdated
    })
    expect(await harness(() => new Response('not json', { status: 200 })).client.activate(KEY, REQUEST)).toEqual({
      ok: false,
      error: LICENCE_MESSAGES.outdated
    })
  })

  it('falls back to the last four characters when Polar sends no usable masked key', async () => {
    const none = await harness(() => json(200, granted({ display_key: undefined }))).client.activate(
      KEY,
      REQUEST
    )
    expect(none).toMatchObject({ ok: true, displayKey: '04DA' })
    const odd = await harness(() => json(200, granted({ display_key: '<b>E304DA</b>' }))).client.activate(
      KEY,
      REQUEST
    )
    expect(odd).toMatchObject({ ok: true, displayKey: '04DA' })
  })
})

describe('what an activation that fails says', () => {
  const cases: Array<[string, number, unknown, string]> = [
    [
      'the activation limit',
      403,
      { error: 'NotPermitted', detail: 'License key activation limit already reached' },
      'This key is already active on its maximum number of devices. Release it on another device, or manage your devices in your Polar account.'
    ],
    [
      'a revoked or disabled key',
      403,
      {
        error: 'NotPermitted',
        detail: 'License key is no longer active. This license key can not be activated.'
      },
      'This licence key is not active: its subscription has ended, or it was disabled.'
    ],
    [
      'an expired key',
      403,
      { error: 'NotPermitted', detail: 'License key has expired.' },
      'This licence key has expired.'
    ],
    [
      'a benefit without activations',
      403,
      {
        error: 'NotPermitted',
        detail:
          'This license key does not support activations. Use the /validate endpoint instead to check license validity.'
      },
      'This key cannot be activated in Vocette. Contact support.'
    ],
    [
      'an unknown key',
      404,
      { error: 'ResourceNotFound', detail: 'Not found' },
      'That licence key was not recognised. Check it and try again.'
    ],
    [
      'an API version Polar has removed',
      404,
      { detail: 'Not Found' },
      'This version of Vocette can no longer activate licences. Update Vocette and try again.'
    ],
    [
      'a request Polar cannot read',
      422,
      {
        error: 'RequestValidationError',
        detail: [{ type: 'missing', loc: ['body', 'label'], msg: 'Field required' }]
      },
      'That does not look like a Vocette licence key.'
    ],
    ['too many attempts', 429, { detail: 'Too many requests' }, 'Too many attempts. Wait a minute and try again.'],
    ['Polar failing', 503, {}, LICENCE_MESSAGES.unavailable],
    ['anything else', 400, { detail: 'Bad request' }, unexpectedReply(400)],
    ['a 403 with words it does not know', 403, { detail: 'Nope.' }, unexpectedReply(403)]
  ]

  for (const [name, status, body, sentence] of cases) {
    it(`says so plainly for ${name}`, async () => {
      const { client } = harness(() => json(status, body))
      expect(await client.activate(KEY, REQUEST)).toEqual({ ok: false, error: sentence })
    })
  }

  it('says activation needs a connection when Polar cannot be reached', async () => {
    const { client } = harness(() => {
      throw new TypeError('fetch failed')
    })
    expect(await client.activate(KEY, REQUEST)).toEqual({
      ok: false,
      error: 'Could not reach Polar. Activation needs an internet connection.'
    })
  })

  it('gives up after its timeout, whether the answer never comes or stalls half-way', async () => {
    const silent = harness(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
    )
    expect(await silent.client.activate(KEY, REQUEST)).toEqual({
      ok: false,
      error: LICENCE_MESSAGES.unreachable
    })
    // Headers arrive, the body never finishes, and the fake ignores the signal.
    const stalled = harness(() => new Response(new ReadableStream({ start: () => undefined }), { status: 200 }))
    expect(await stalled.client.activate(KEY, REQUEST)).toEqual({
      ok: false,
      error: LICENCE_MESSAGES.unreachable
    })
  })

  it('never retries on its own', async () => {
    const { client, fetch } = harness(() => json(429, {}))
    await client.activate(KEY, REQUEST)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('releasing this PC', () => {
  const config = { apiBase: 'https://sandbox-api.polar.sh', orgId: ORG, benefitIds: [BENEFIT] }

  it('sends the key, the organisation and the activation, and no credentials', async () => {
    const { client, sent } = harness(() => new Response(null, { status: 204 }))
    expect(await client.deactivate(KEY, ACTIVATION, config)).toEqual({ released: true })
    const { url, init, body } = sent()
    expect(url).toBe('https://sandbox-api.polar.sh/v1/customer-portal/license-keys/deactivate')
    expect(init.method).toBe('POST')
    expect(body).toEqual({ key: KEY, organization_id: ORG, activation_id: ACTIVATION })
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('counts a 404 as released: the activation was already gone', async () => {
    const { client } = harness(() => json(404, { error: 'ResourceNotFound', detail: 'Not found' }))
    expect(await client.deactivate(KEY, ACTIVATION, config)).toEqual({ released: true })
  })

  it('reports no connection as its own result, so the PC can be cleared locally', async () => {
    const { client } = harness(() => {
      throw new TypeError('fetch failed')
    })
    expect(await client.deactivate(KEY, ACTIVATION, config)).toEqual({
      released: false,
      error:
        'Could not reach Polar, so this PC was not released. Check your internet connection and try again.',
      canRemoveLocally: true
    })
  })

  it('treats a timeout as no connection', async () => {
    const { client } = harness(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
    )
    expect(await client.deactivate(KEY, ACTIVATION, config)).toMatchObject({
      released: false,
      error: LICENCE_MESSAGES.releaseUnreachable,
      canRemoveLocally: true
    })
  })

  it('asks for a minute after too many attempts, without offering to give up', async () => {
    const { client } = harness(() => json(429, {}))
    expect(await client.deactivate(KEY, ACTIVATION, config)).toEqual({
      released: false,
      error: LICENCE_MESSAGES.rateLimited,
      canRemoveLocally: false
    })
  })

  it('offers to clear this PC locally when Polar fails or refuses outright', async () => {
    expect(await harness(() => json(500, {})).client.deactivate(KEY, ACTIVATION, config)).toEqual({
      released: false,
      error: LICENCE_MESSAGES.unavailable,
      canRemoveLocally: true
    })
    expect(await harness(() => json(422, {})).client.deactivate(KEY, ACTIVATION, config)).toEqual({
      released: false,
      error: 'Polar could not release this PC (HTTP 422).',
      canRemoveLocally: true
    })
  })

  it('asks nothing without an organisation', async () => {
    const { client, fetch } = harness(() => new Response(null, { status: 204 }))
    expect(await client.deactivate(KEY, ACTIVATION, { ...config, orgId: '' })).toMatchObject({
      released: false,
      canRemoveLocally: true
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('the Polar settings', () => {
  it('come from the product constants by default', () => {
    expect(licenceConfig({})).toEqual({
      apiBase: POLAR_API_BASE,
      orgId: POLAR_ORGANIZATION_ID,
      benefitIds: POLAR_PRO_BENEFIT_IDS
    })
    expect(POLAR_API_BASE).toBe('https://api.polar.sh')
  })

  it('can point a test run at the sandbox', () => {
    expect(
      licenceConfig({
        MURMUR_POLAR_API_BASE: 'https://sandbox-api.polar.sh/',
        MURMUR_POLAR_ORG_ID: ' sandbox-org ',
        MURMUR_POLAR_BENEFIT_ID: 'sandbox-benefit'
      })
    ).toEqual({
      apiBase: 'https://sandbox-api.polar.sh',
      orgId: 'sandbox-org',
      benefitIds: ['sandbox-benefit']
    })
    // One benefit per product: both are accepted.
    expect(licenceConfig({ MURMUR_POLAR_BENEFIT_ID: ' monthly-benefit , yearly-benefit ' }).benefitIds).toEqual([
      'monthly-benefit',
      'yearly-benefit'
    ])
  })

  it('ignores an override that is not https, or is blank', () => {
    expect(licenceConfig({ MURMUR_POLAR_API_BASE: 'http://sandbox-api.polar.sh' }).apiBase).toBe(
      POLAR_API_BASE
    )
    expect(licenceConfig({ MURMUR_POLAR_API_BASE: 'not a url' }).apiBase).toBe(POLAR_API_BASE)
    expect(licenceConfig({ MURMUR_POLAR_ORG_ID: '   ' }).orgId).toBe(POLAR_ORGANIZATION_ID)
  })

  it('count as configured only with both an organisation and a benefit', () => {
    const base = { apiBase: POLAR_API_BASE, orgId: ORG, benefitIds: [BENEFIT] }
    expect(purchasesConfigured(base)).toBe(true)
    expect(purchasesConfigured({ ...base, orgId: '' })).toBe(false)
    expect(purchasesConfigured({ ...base, benefitIds: [] })).toBe(false)
  })
})

describe('the device label', () => {
  it('names the system and this PC’s tag', () => {
    expect(deviceLabel('windows', '7F3A')).toBe('Vocette on Windows · 7F3A')
    expect(deviceLabel('macos', 'BEEF')).toBe('Vocette on macOS · BEEF')
    expect(deviceLabel('linux', '0042')).toBe('Vocette on Linux · 0042')
    expect(deviceLabel('unknown', '7F3A')).toBe('Vocette · 7F3A')
  })
})

describe('the launch offer', () => {
  const END = '2027-01-01T00:00:00Z'

  it('is shown up to the last moment of 31 December, and gone from midnight UTC', () => {
    const lastMoment = launchOfferFor(Date.parse(END) - 1, END)
    expect(lastMoment).toEqual({
      monthlyPriceLabel: 'US$3.74 a month',
      yearlyPriceLabel: 'US$24.50 a year',
      monthlyWas: 'US$4.99',
      yearlyWas: 'US$49',
      endsLabel: '31 December 2026',
      places: 100
    })
    expect(launchOfferFor(Date.parse(END), END)).toBeNull()
    expect(launchOfferFor(Date.parse(END) + 86_400_000, END)).toBeNull()
  })

  it('needs a readable end date', () => {
    expect(launchOfferFor(Date.parse('2026-10-07T12:00:00Z'), '')).toBeNull()
    expect(launchOfferFor(Date.parse('2026-10-07T12:00:00Z'), 'some day')).toBeNull()
  })

  it('ends on the same instant as the Polar discounts are set to', () => {
    expect(LAUNCH_OFFER_ENDS_AT).toBe(END)
  })

  it('is part of the status until it closes', () => {
    const base = {
      entitlement: entitlementFor({ trialStartedAt: '2026-10-07T09:00:00.000Z', subscribed: false, now: 0 }),
      licence: null,
      config: { apiBase: POLAR_API_BASE, orgId: ORG, benefitIds: [BENEFIT] },
      trialEndNoticeDismissed: false,
      deviceLabel: 'Vocette on Windows · 7F3A'
    }
    expect(
      licenceStatusFor({ ...base, now: Date.parse('2026-12-31T23:00:00Z') }).launchOffer
    ).not.toBeNull()
    expect(licenceStatusFor({ ...base, now: Date.parse('2027-01-01T00:00:00Z') }).launchOffer).toBeNull()
    // A test run can move the end, as the owner's sandbox check does.
    expect(
      licenceStatusFor({
        ...base,
        now: Date.parse('2026-10-07T12:00:00Z'),
        launchOfferEndsAt: '2026-10-01T00:00:00Z'
      }).launchOffer
    ).toBeNull()
  })
})

describe('the checkout settings', () => {
  it('are the product constants unless a test run replaces them', () => {
    expect(checkoutConfig({})).toEqual({
      monthly: CHECKOUT_URL_MONTHLY,
      yearly: CHECKOUT_URL_YEARLY,
      launchOfferEndsAt: LAUNCH_OFFER_ENDS_AT
    })
    expect(
      checkoutConfig({
        MURMUR_CHECKOUT_URL_MONTHLY: ' https://sandbox.polar.sh/checkout/monthly ',
        MURMUR_CHECKOUT_URL_YEARLY: 'https://sandbox.polar.sh/checkout/yearly',
        MURMUR_LAUNCH_OFFER_ENDS_AT: '2026-10-08T00:00:00Z'
      })
    ).toEqual({
      monthly: 'https://sandbox.polar.sh/checkout/monthly',
      yearly: 'https://sandbox.polar.sh/checkout/yearly',
      launchOfferEndsAt: '2026-10-08T00:00:00Z'
    })
  })

  it('never takes a checkout link that is not https', () => {
    const config = checkoutConfig({
      MURMUR_CHECKOUT_URL_MONTHLY: 'http://example.com/checkout',
      MURMUR_CHECKOUT_URL_YEARLY: 'javascript:alert(1)'
    })
    expect(config.monthly).toBe(CHECKOUT_URL_MONTHLY)
    expect(config.yearly).toBe(CHECKOUT_URL_YEARLY)
  })
})

describe('the status the window is told', () => {
  const START = '2026-09-25T09:00:00.000Z'
  const DAY = 86_400_000
  const config = { apiBase: POLAR_API_BASE, orgId: ORG, benefitIds: [BENEFIT] }
  const record = (patch: Partial<{ subscription: 'active' | 'ended'; confirmedAt: string }> = {}) => ({
    activationId: ACTIVATION,
    benefitId: BENEFIT,
    displayKey: '****-E304DA',
    activatedAt: '2026-09-25T13:48:13.251Z',
    subscription: 'active' as const,
    confirmedAt: '2026-09-25T13:48:13.251Z',
    ...patch
  })
  const status = (options: {
    days: number
    licence?: ReturnType<typeof record> | null
    dismissed?: boolean
  }) => {
    const now = Date.parse(START) + options.days * DAY
    const licence = options.licence ?? null
    const subscribed =
      licence !== null &&
      licence.subscription === 'active' &&
      now - Date.parse(licence.confirmedAt) <= 30 * DAY
    return licenceStatusFor({
      entitlement: entitlementFor({ trialStartedAt: START, subscribed, now }),
      licence,
      config,
      trialEndNoticeDismissed: options.dismissed ?? false,
      deviceLabel: 'Vocette on Windows · 7F3A',
      now
    })
  }

  it('describes the trial, with no notice due', () => {
    expect(status({ days: 7 })).toEqual({
      plan: 'trial',
      trialDaysLeft: 23,
      trialEndsAt: '2026-10-25T09:00:00.000Z',
      licence: null,
      checking: false,
      checkMessage: null,
      purchasesConfigured: true,
      monthlyCheckoutAvailable: false,
      yearlyCheckoutAvailable: false,
      portalAvailable: false,
      monthlyPriceLabel: 'US$4.99 a month',
      yearlyPriceLabel: 'US$49 a year',
      yearlySavingLabel: 'two months free',
      launchOffer: {
        monthlyPriceLabel: 'US$3.74 a month',
        yearlyPriceLabel: 'US$24.50 a year',
        monthlyWas: 'US$4.99',
        yearlyWas: 'US$49',
        endsLabel: '31 December 2026',
        places: 100
      },
      devices: 10,
      trialEndNoticeDue: false,
      deviceLabel: 'Vocette on Windows · 7F3A'
    })
  })

  it('makes the notice due once the trial has ended, until it is dismissed', () => {
    expect(status({ days: 31 })).toMatchObject({ plan: 'free', trialEndNoticeDue: true })
    expect(status({ days: 31, dismissed: true })).toMatchObject({
      plan: 'free',
      trialEndNoticeDue: false
    })
  })

  it('shows an active subscription with its masked key, and never the identifiers', () => {
    const shown = status({ days: 31, licence: record({ confirmedAt: '2026-10-25T08:00:00.000Z' }) })
    expect(shown).toMatchObject({
      plan: 'pro',
      trialEndNoticeDue: false,
      licence: {
        displayKey: '****-E304DA',
        activatedAt: '2026-09-25T13:48:13.251Z',
        standing: 'active',
        confirmedAt: '2026-10-25T08:00:00.000Z',
        // Confirmed 25 hours before: 28 days and 23 hours of the 30 are left.
        graceDaysLeft: 29
      }
    })
    expect(JSON.stringify(shown)).not.toContain(ACTIVATION)
    expect(JSON.stringify(shown)).not.toContain(BENEFIT)
    expect(JSON.stringify(shown)).not.toContain(ORG)
  })

  it('drops to Free when the subscription has ended, or has gone unconfirmed too long', () => {
    const ended = status({ days: 40, licence: record({ subscription: 'ended' }) })
    expect(ended).toMatchObject({ plan: 'free', licence: { standing: 'ended', graceDaysLeft: 0 } })
    // Someone who subscribed is not told their trial has ended.
    expect(ended.trialEndNoticeDue).toBe(false)

    const unconfirmed = status({ days: 40, licence: record({ confirmedAt: START }) })
    expect(unconfirmed).toMatchObject({ plan: 'free', licence: { standing: 'unconfirmed' } })
  })

  it('keeps a subscription unconfirmed for a while on Pro, counting the grace days down', () => {
    const offline = status({ days: 20, licence: record({ confirmedAt: START }) })
    expect(offline).toMatchObject({ plan: 'pro', licence: { standing: 'active', graceDaysLeft: 10 } })
  })

  it('says whether the checkouts and the portal are there to open, and what a check said', () => {
    const shown = licenceStatusFor({
      entitlement: entitlementFor({ trialStartedAt: START, subscribed: false, now: Date.parse(START) }),
      licence: null,
      config: { ...config, orgId: '' },
      trialEndNoticeDismissed: false,
      deviceLabel: 'Vocette on Windows · 7F3A',
      now: Date.parse(START),
      checking: true,
      checkMessage: LICENCE_MESSAGES.released,
      monthlyCheckoutUrl: 'https://buy.polar.sh/polar_cl_monthly',
      yearlyCheckoutUrl: '',
      portalUrl: ''
    })
    expect(shown).toMatchObject({
      purchasesConfigured: false,
      monthlyCheckoutAvailable: true,
      yearlyCheckoutAvailable: false,
      portalAvailable: false,
      checking: true,
      checkMessage: LICENCE_MESSAGES.released
    })
    expect(JSON.stringify(shown)).not.toContain('polar_cl_monthly')
  })
})

describe('checking a subscription', () => {
  const config = { apiBase: 'https://sandbox-api.polar.sh', orgId: ORG, benefitIds: [BENEFIT] }
  const thisPc = { activationId: ACTIVATION, benefitId: BENEFIT }

  /** Polar's 200 to a validation: the key, customer and all. */
  function validated(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const key = granted().license_key as Record<string, unknown>
    return { ...key, activation: { id: ACTIVATION, label: REQUEST.label }, ...overrides }
  }

  it('sends the key, the organisation, this PC and its benefit — nothing else, no credentials', async () => {
    const { client, sent } = harness(() => json(200, validated()))
    expect(await client.check(`  ${KEY}\n`, thisPc, config)).toEqual({ outcome: 'active' })
    const { url, init, body } = sent()
    expect(url).toBe('https://sandbox-api.polar.sh/v1/customer-portal/license-keys/validate')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(body).toEqual({
      key: KEY,
      organization_id: ORG,
      activation_id: ACTIVATION,
      benefit_id: BENEFIT
    })
  })

  it('reads the subscription as ended when the key is revoked, disabled or expired', async () => {
    for (const answer of [
      json(200, validated({ status: 'revoked' })),
      json(200, validated({ status: 'disabled' })),
      json(200, validated({ expires_at: '2026-09-01T00:00:00.000Z' })),
      json(404, { error: 'ResourceNotFound', detail: 'License key is no longer active.' }),
      json(404, { error: 'ResourceNotFound', detail: 'License key has expired.' })
    ]) {
      const { client } = harness(() => answer)
      expect(await client.check(KEY, thisPc, config)).toEqual({ outcome: 'ended' })
    }
  })

  it('reads a bare "Not found" as this PC released, or the key changed', async () => {
    const { client } = harness(() => json(404, { error: 'ResourceNotFound', detail: 'Not found' }))
    expect(await client.check(KEY, thisPc, config)).toEqual({ outcome: 'released' })
  })

  it('learns nothing from an answer that is not about the subscription', async () => {
    const cases: Array<[Response | null, string]> = [
      [new Response('<html>Not Found</html>', { status: 404 }), LICENCE_MESSAGES.outdated],
      [json(404, { error: 'ResourceNotFound', detail: 'License key does not match given benefit.' }), LICENCE_MESSAGES.wrongProduct],
      [json(200, { unexpected: true }), LICENCE_MESSAGES.outdated],
      [json(429, {}), LICENCE_MESSAGES.rateLimited],
      [json(503, {}), LICENCE_MESSAGES.checkUnavailable],
      [json(418, {}), 'Polar could not check the subscription (HTTP 418). Vocette tries again later.'],
      [null, LICENCE_MESSAGES.checkUnreachable]
    ]
    for (const [answer, error] of cases) {
      const { client } = harness(() => {
        if (!answer) throw new TypeError('fetch failed')
        return answer
      })
      expect(await client.check(KEY, thisPc, config)).toEqual({ outcome: 'unknown', error })
    }
  })

  it('keeps none of the buyer details from the answer', async () => {
    const { client } = harness(() => json(200, validated()))
    const result = JSON.stringify(await client.check(KEY, thisPc, config))
    for (const personal of ['buyer@example.com', 'Ada Buyer', 'Rue du Lac', KEY]) {
      expect(result).not.toContain(personal)
    }
  })

  it('asks nothing without an organisation', async () => {
    const { client, fetch } = harness(() => json(200, validated()))
    expect(await client.check(KEY, thisPc, { ...config, orgId: '' })).toEqual({
      outcome: 'unknown',
      error: LICENCE_MESSAGES.notConfigured
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('activating with two plans', () => {
  it('accepts a key for either benefit, and keeps the one it was granted for', async () => {
    const { client } = harness(() => json(200, granted({ benefit_id: 'yearly-benefit' })))
    const result = await client.activate(KEY, { ...REQUEST, benefitIds: [BENEFIT, 'yearly-benefit'] })
    expect(result).toMatchObject({ ok: true, benefitId: 'yearly-benefit' })
  })
})
