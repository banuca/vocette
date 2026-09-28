import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LICENCE_MESSAGES,
  LicenceClient,
  deviceLabel,
  licenceConfig,
  licenceStatusFor,
  purchasesConfigured,
  unexpectedReply,
  type ActivationRequest,
  type LicenceFetch
} from '../src/main/licence'
import { entitlementFor } from '../src/shared/entitlement'
import {
  POLAR_API_BASE,
  POLAR_ORGANIZATION_ID,
  POLAR_PRO_BENEFIT_ID,
  PRO_PRICE_LABEL
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
  benefitId: BENEFIT,
  label: 'Murmur on Windows · 7F3A',
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
      label: 'Murmur on Windows · 7F3A',
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
      error: 'That does not look like a Murmur licence key.'
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('asks nothing while purchases are not configured', async () => {
    const { client, fetch } = harness(() => json(200, granted()))
    expect(await client.activate(KEY, { ...REQUEST, orgId: '' })).toEqual({
      ok: false,
      error: LICENCE_MESSAGES.notConfigured
    })
    expect(await client.activate(KEY, { ...REQUEST, benefitId: '' })).toEqual({
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
      error: 'This licence key has been revoked or disabled.'
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
      'This key is already active on its maximum number of PCs. Release it on another PC, or manage your devices from your purchase email.'
    ],
    [
      'a revoked or disabled key',
      403,
      {
        error: 'NotPermitted',
        detail: 'License key is no longer active. This license key can not be activated.'
      },
      'This licence key has been revoked or disabled.'
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
      'This key cannot be activated in Murmur. Contact support.'
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
      'This version of Murmur can no longer activate licences. Update Murmur and try again.'
    ],
    [
      'a request Polar cannot read',
      422,
      {
        error: 'RequestValidationError',
        detail: [{ type: 'missing', loc: ['body', 'label'], msg: 'Field required' }]
      },
      'That does not look like a Murmur licence key.'
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
      error: 'Could not reach Polar. Activation needs an internet connection once.'
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
  const config = { apiBase: 'https://sandbox-api.polar.sh', orgId: ORG, benefitId: BENEFIT }

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
      benefitId: POLAR_PRO_BENEFIT_ID
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
      benefitId: 'sandbox-benefit'
    })
  })

  it('ignores an override that is not https, or is blank', () => {
    expect(licenceConfig({ MURMUR_POLAR_API_BASE: 'http://sandbox-api.polar.sh' }).apiBase).toBe(
      POLAR_API_BASE
    )
    expect(licenceConfig({ MURMUR_POLAR_API_BASE: 'not a url' }).apiBase).toBe(POLAR_API_BASE)
    expect(licenceConfig({ MURMUR_POLAR_ORG_ID: '   ' }).orgId).toBe(POLAR_ORGANIZATION_ID)
  })

  it('count as configured only with both an organisation and a benefit', () => {
    const base = { apiBase: POLAR_API_BASE, orgId: ORG, benefitId: BENEFIT }
    expect(purchasesConfigured(base)).toBe(true)
    expect(purchasesConfigured({ ...base, orgId: '' })).toBe(false)
    expect(purchasesConfigured({ ...base, benefitId: '' })).toBe(false)
  })
})

describe('the device label', () => {
  it('names the system and this PC’s tag', () => {
    expect(deviceLabel('windows', '7F3A')).toBe('Murmur on Windows · 7F3A')
    expect(deviceLabel('macos', 'BEEF')).toBe('Murmur on macOS · BEEF')
    expect(deviceLabel('linux', '0042')).toBe('Murmur on Linux · 0042')
    expect(deviceLabel('unknown', '7F3A')).toBe('Murmur · 7F3A')
  })
})

describe('the status the window is told', () => {
  const START = '2026-09-25T09:00:00.000Z'
  const config = { apiBase: POLAR_API_BASE, orgId: ORG, benefitId: BENEFIT }
  const record = {
    activationId: ACTIVATION,
    benefitId: BENEFIT,
    displayKey: '****-E304DA',
    activatedAt: '2026-09-25T13:48:13.251Z'
  }
  const status = (options: { days: number; licensed?: boolean; dismissed?: boolean }) =>
    licenceStatusFor({
      entitlement: entitlementFor({
        trialStartedAt: START,
        licensed: options.licensed ?? false,
        now: Date.parse(START) + options.days * 86_400_000
      }),
      licence: options.licensed ? record : null,
      config,
      trialEndNoticeDismissed: options.dismissed ?? false,
      deviceLabel: 'Murmur on Windows · 7F3A'
    })

  it('describes the trial, with no notice due', () => {
    expect(status({ days: 7 })).toEqual({
      plan: 'trial',
      trialDaysLeft: 23,
      trialEndsAt: '2026-10-25T09:00:00.000Z',
      licence: null,
      purchasesConfigured: true,
      checkoutAvailable: false,
      portalAvailable: false,
      priceLabel: PRO_PRICE_LABEL,
      trialEndNoticeDue: false,
      deviceLabel: 'Murmur on Windows · 7F3A'
    })
  })

  it('makes the notice due once the trial has ended, until it is dismissed', () => {
    expect(status({ days: 31 })).toMatchObject({ plan: 'free', trialEndNoticeDue: true })
    expect(status({ days: 31, dismissed: true })).toMatchObject({
      plan: 'free',
      trialEndNoticeDue: false
    })
  })

  it('never makes it due with a licence, and shows only the masked key and the date', () => {
    const licensed = status({ days: 31, licensed: true })
    expect(licensed).toMatchObject({
      plan: 'pro',
      trialEndNoticeDue: false,
      licence: { displayKey: '****-E304DA', activatedAt: '2026-09-25T13:48:13.251Z' }
    })
    expect(JSON.stringify(licensed)).not.toContain(ACTIVATION)
    expect(JSON.stringify(licensed)).not.toContain(BENEFIT)
    expect(JSON.stringify(licensed)).not.toContain(ORG)
  })

  it('says whether the checkout and the portal are there to open', () => {
    const shown = licenceStatusFor({
      entitlement: entitlementFor({ trialStartedAt: START, licensed: false, now: Date.parse(START) }),
      licence: null,
      config: { ...config, orgId: '' },
      trialEndNoticeDismissed: false,
      deviceLabel: 'Murmur on Windows · 7F3A',
      checkoutUrl: 'https://buy.polar.sh/polar_cl_example',
      portalUrl: '',
      priceLabel: 'CHF 25, once'
    })
    expect(shown).toMatchObject({
      purchasesConfigured: false,
      checkoutAvailable: true,
      portalAvailable: false,
      priceLabel: 'CHF 25, once'
    })
    expect(JSON.stringify(shown)).not.toContain('polar_cl_example')
  })
})
