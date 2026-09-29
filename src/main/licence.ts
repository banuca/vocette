import type { Entitlement } from '../shared/entitlement'
import {
  CHECKOUT_URL,
  CUSTOMER_PORTAL_URL,
  POLAR_API_BASE,
  POLAR_ORGANIZATION_ID,
  POLAR_PRO_BENEFIT_ID,
  PRODUCT_NAME,
  PRO_PRICE_LABEL
} from '../shared/product'
import type { LicenceStatus } from '../shared/types'
import type { LicenceRecord } from './settings-store'

/**
 * Pro licences, through Polar's public licence-key API.
 *
 * One call activates a key on this PC, and nothing is sent again unless the
 * user releases the PC. These endpoints take no credentials — Polar documents
 * them as safe for a desktop app — so no token is ever shipped. No
 * `Polar-Version` header is sent either: Polar removes a pinned version about
 * nine months after it appears, which would stop an old build activating, so
 * the call uses the current version and reads as little of the answer as it
 * can. See docs/research/licensing.md, §2.5 and §2.6.
 *
 * Polar's answer to an activation names the buyer — email, name, billing
 * address. Only the activation id, the benefit id, the key's status and
 * expiry, and its masked form are read from it. It is never logged, and it is
 * not kept.
 */

/** How long one request may take, from sending it to the last byte of the answer. */
export const LICENCE_TIMEOUT_MS = 15_000
/** A Polar key is a UUID with an optional prefix; anything this long is not one. */
export const MAX_LICENCE_KEY_CHARS = 200

/** Every sentence the licence flow can show, so the tests hold them to the letter. */
export const LICENCE_MESSAGES = {
  empty: 'Enter your licence key first.',
  notAKey: 'That does not look like a Vocette licence key.',
  activationLimit:
    'This key is already active on its maximum number of PCs. Release it on another PC, ' +
    'or manage your devices from your purchase email.',
  revoked: 'This licence key has been revoked or disabled.',
  expired: 'This licence key has expired.',
  noActivations: 'This key cannot be activated in Vocette. Contact support.',
  notRecognised: 'That licence key was not recognised. Check it and try again.',
  outdated: 'This version of Vocette can no longer activate licences. Update Vocette and try again.',
  rateLimited: 'Too many attempts. Wait a minute and try again.',
  wrongProduct: 'That key is for a different product.',
  unreachable: 'Could not reach Polar. Activation needs an internet connection once.',
  notConfigured: 'Pro purchases are not open yet in this version of Vocette.',
  unavailable: 'Polar is not answering properly right now. Try again in a few minutes.',
  releaseUnreachable:
    'Could not reach Polar, so this PC was not released. Check your internet connection and try again.'
} as const

/** A reply this client has no sentence for: said plainly, with the status for support. */
export function unexpectedReply(status: number, releasing = false): string {
  return releasing
    ? `Polar could not release this PC (HTTP ${status}).`
    : `Polar could not activate this key (HTTP ${status}). Try again later.`
}

export interface LicenceConfig {
  /** `https://api.polar.sh`, or the sandbox for testing. */
  apiBase: string
  orgId: string
  benefitId: string
}

export interface ActivationRequest extends LicenceConfig {
  /** Names this PC in the buyer's Polar portal: "Vocette on Windows · 7F3A". */
  label: string
  appVersion: string
}

export type ActivationResult =
  | { ok: true; activationId: string; benefitId: string; displayKey: string }
  | { ok: false; error: string }

export type ReleaseResult =
  | { released: true }
  | {
      released: false
      error: string
      /**
       * True when trying again will not help, or cannot be done now — no
       * connection, Polar failing — so the Pro page may offer to remove the
       * licence from this PC alone.
       */
      canRemoveLocally: boolean
    }

/** What the client needs of `fetch`; Electron's `net.fetch` in the app. */
export type LicenceFetch = (url: string, init: RequestInit) => Promise<Response>

export interface LicenceClientOptions {
  fetch: LicenceFetch
  timeoutMs?: number
  now?: () => number
}

interface Reply {
  status: number
  body: Record<string, unknown> | null
}

/** Polar's masked key, "****-E304DA": letters, digits, asterisks and hyphens. */
const DISPLAY_KEY_PATTERN = /^[A-Za-z0-9*-]{1,40}$/u

function refused(error: string): ActivationResult {
  return { ok: false, error }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseBody(text: string): Record<string, unknown> | null {
  if (!text) return null
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return null
  }
}

function apiRoot(apiBase: string): string {
  return apiBase.replace(/\/+$/u, '')
}

/** The masked key Polar returned, or the key's last four characters. */
function displayKeyFor(value: unknown, key: string): string {
  return typeof value === 'string' && DISPLAY_KEY_PATTERN.test(value) ? value : key.slice(-4)
}

export class LicenceClient {
  private readonly fetch: LicenceFetch
  private readonly timeoutMs: number
  private readonly now: () => number

  constructor(options: LicenceClientOptions) {
    this.fetch = options.fetch
    this.timeoutMs = options.timeoutMs ?? LICENCE_TIMEOUT_MS
    this.now = options.now ?? Date.now
  }

  /**
   * Activates a key on this PC: one request, and an answer that is accepted
   * only if it says the key is granted, for Vocette Pro, and not expired.
   */
  async activate(rawKey: string, request: ActivationRequest): Promise<ActivationResult> {
    // Trimmed, because a pasted key often brings a space or a line break
    // with it; never changed otherwise, because Polar matches keys exactly.
    const key = typeof rawKey === 'string' ? rawKey.trim() : ''
    if (!key) return refused(LICENCE_MESSAGES.empty)
    if (key.length > MAX_LICENCE_KEY_CHARS) return refused(LICENCE_MESSAGES.notAKey)
    if (!request.orgId || !request.benefitId) return refused(LICENCE_MESSAGES.notConfigured)

    const reply = await this.post(`${apiRoot(request.apiBase)}/v1/customer-portal/license-keys/activate`, {
      key,
      organization_id: request.orgId,
      label: request.label,
      meta: { app_version: request.appVersion }
    })
    if (!reply) return refused(LICENCE_MESSAGES.unreachable)
    return this.readActivation(reply, key, request.benefitId)
  }

  /**
   * Releases this PC's activation, freeing one of the key's device slots. A
   * 404 means it was already gone — released from the portal, or the key
   * rotated — which is the outcome asked for, so it counts as released.
   */
  async deactivate(
    rawKey: string,
    activationId: string,
    config: LicenceConfig
  ): Promise<ReleaseResult> {
    const key = typeof rawKey === 'string' ? rawKey.trim() : ''
    if (!config.orgId) {
      return { released: false, error: LICENCE_MESSAGES.notConfigured, canRemoveLocally: true }
    }
    const reply = await this.post(`${apiRoot(config.apiBase)}/v1/customer-portal/license-keys/deactivate`, {
      key,
      organization_id: config.orgId,
      activation_id: activationId
    })
    if (!reply) {
      return { released: false, error: LICENCE_MESSAGES.releaseUnreachable, canRemoveLocally: true }
    }
    if (reply.status === 204 || reply.status === 404) return { released: true }
    // A minute's wait will fix this one, so it is not a reason to give up.
    if (reply.status === 429) {
      return { released: false, error: LICENCE_MESSAGES.rateLimited, canRemoveLocally: false }
    }
    if (reply.status >= 500) {
      return { released: false, error: LICENCE_MESSAGES.unavailable, canRemoveLocally: true }
    }
    return { released: false, error: unexpectedReply(reply.status, true), canRemoveLocally: true }
  }

  private readActivation(reply: Reply, key: string, benefitId: string): ActivationResult {
    const { status, body } = reply
    if (status === 200) {
      const id = body?.id
      const licenceKey = asRecord(body?.license_key)
      // A 200 without these is an answer in a shape this build does not know.
      if (typeof id !== 'string' || id === '' || id.length > 200 || !licenceKey) {
        return refused(LICENCE_MESSAGES.outdated)
      }
      if (licenceKey.status !== 'granted') return refused(LICENCE_MESSAGES.revoked)
      if (licenceKey.benefit_id !== benefitId) return refused(LICENCE_MESSAGES.wrongProduct)
      const expiresAt = licenceKey.expires_at
      if (expiresAt !== null && expiresAt !== undefined) {
        const at = typeof expiresAt === 'string' ? Date.parse(expiresAt) : Number.NaN
        if (!(at > this.now())) return refused(LICENCE_MESSAGES.expired)
      }
      return {
        ok: true,
        activationId: id,
        benefitId,
        displayKey: displayKeyFor(licenceKey.display_key, key)
      }
    }

    // Polar's own words, from its source: matched loosely, so a rewording
    // that keeps the gist still lands on the right sentence.
    const detail = typeof body?.detail === 'string' ? body.detail.toLowerCase() : ''
    switch (status) {
      case 403:
        if (detail.includes('activation limit')) return refused(LICENCE_MESSAGES.activationLimit)
        if (detail.includes('does not support activations')) {
          return refused(LICENCE_MESSAGES.noActivations)
        }
        if (detail.includes('no longer active')) return refused(LICENCE_MESSAGES.revoked)
        if (detail.includes('expired')) return refused(LICENCE_MESSAGES.expired)
        return refused(unexpectedReply(status))
      case 404:
        // Polar says "ResourceNotFound" for a key it does not have. A 404
        // without it is the API itself gone — a version Polar has removed.
        return refused(
          body?.error === 'ResourceNotFound'
            ? LICENCE_MESSAGES.notRecognised
            : LICENCE_MESSAGES.outdated
        )
      case 422:
        return refused(LICENCE_MESSAGES.notAKey)
      case 429:
        return refused(LICENCE_MESSAGES.rateLimited)
    }
    if (status >= 500) return refused(LICENCE_MESSAGES.unavailable)
    return refused(unexpectedReply(status))
  }

  /**
   * One POST, with only a content type: no credentials and no version pin.
   * The body is read inside the timeout, so an answer that stalls half-way is
   * treated like no answer. Null means Polar could not be reached.
   */
  private async post(url: string, payload: Record<string, unknown>): Promise<Reply | null> {
    const controller = new AbortController()
    // Raced as well as passed on: the timeout holds even for a fetch, or a
    // body, that does not listen to the signal.
    const timedOut = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('Timed out.')), {
        once: true
      })
    })
    timedOut.catch(() => undefined)
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await Promise.race([
        this.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        }),
        timedOut
      ])
      const text = await Promise.race([response.text(), timedOut])
      return { status: response.status, body: parseBody(text) }
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }
}

/** An https URL for the sandbox override, or null for anything else. */
function httpsBase(value: string | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null
  try {
    return new URL(raw).protocol === 'https:' ? apiRoot(raw) : null
  } catch {
    return null
  }
}

/**
 * The Polar settings in force. The environment can point a test run at the
 * sandbox; it is read here, in the main process, and none of it is ever sent
 * to the window, which learns only whether purchases are set up.
 */
export function licenceConfig(env: Record<string, string | undefined>): LicenceConfig {
  return {
    apiBase: httpsBase(env.MURMUR_POLAR_API_BASE) ?? POLAR_API_BASE,
    orgId: env.MURMUR_POLAR_ORG_ID?.trim() || POLAR_ORGANIZATION_ID,
    benefitId: env.MURMUR_POLAR_BENEFIT_ID?.trim() || POLAR_PRO_BENEFIT_ID
  }
}

/** A key can be activated only once both the organisation and the benefit are known. */
export function purchasesConfigured(config: LicenceConfig): boolean {
  return config.orgId !== '' && config.benefitId !== ''
}

/** "Vocette on Windows · 7F3A": the label Polar shows the buyer for this PC. */
export function deviceLabel(platform: string, tag: string): string {
  const names: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' }
  const name = names[platform]
  const base = name ? `${PRODUCT_NAME} on ${name}` : PRODUCT_NAME
  return tag ? `${base} · ${tag}` : base
}

export interface LicenceStatusInput {
  entitlement: Entitlement
  licence: LicenceRecord | null
  config: LicenceConfig
  trialEndNoticeDismissed: boolean
  deviceLabel: string
  /** The product constants unless a test says otherwise. */
  checkoutUrl?: string
  portalUrl?: string
  priceLabel?: string
}

/** What the window is told. No key, no activation id, no Polar identifier. */
export function licenceStatusFor(input: LicenceStatusInput): LicenceStatus {
  const { entitlement } = input
  return {
    plan: entitlement.plan,
    trialDaysLeft: entitlement.trialDaysLeft,
    trialEndsAt: entitlement.trialEndsAt,
    licence: input.licence
      ? { displayKey: input.licence.displayKey, activatedAt: input.licence.activatedAt }
      : null,
    purchasesConfigured: purchasesConfigured(input.config),
    checkoutAvailable: (input.checkoutUrl ?? CHECKOUT_URL) !== '',
    portalAvailable: (input.portalUrl ?? CUSTOMER_PORTAL_URL) !== '',
    priceLabel: input.priceLabel ?? PRO_PRICE_LABEL,
    // Free is only ever reached once the trial is over, and a licence is
    // never on Free, so this is the trial having ended — shown until dismissed.
    trialEndNoticeDue: entitlement.plan === 'free' && !input.trialEndNoticeDismissed,
    deviceLabel: input.deviceLabel
  }
}
