import { LICENCE_MESSAGES, type CheckResult } from './licence'
import type { LicenceRecord } from './settings-store'

/**
 * Keeps a subscription's standing current: at most one check a day while a
 * key is activated on this PC, plus "Check now" on the Pro page. A failed
 * check changes nothing; Pro keeps working through the grace period
 * (`SUBSCRIPTION_GRACE_DAYS`) and the next check tries again.
 */

/** The first check waits until startup has settled. */
export const FIRST_CHECK_DELAY_MS = 60_000
/** A confirmed or ended subscription is asked about again after this long. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
/** After a check that learnt nothing, the next try waits at least this long. */
export const RETRY_INTERVAL_MS = 60 * 60 * 1000
/** How often a running app asks itself whether a check is due. */
export const DUE_TICK_MS = 15 * 60 * 1000

export interface SubscriptionCheckerOptions {
  licence(): LicenceRecord | null
  /** The stored key; throws when the system cannot read it. */
  key(): string
  check(key: string, record: LicenceRecord): Promise<CheckResult>
  /** Keeps an 'active' or 'ended' result. */
  record(result: 'active' | 'ended', at: string): void
  /** Forgets the licence on this PC: Polar no longer knows the activation. */
  release(): void
  /** Activation or release is talking to Polar; a check waits its turn. */
  busy(): boolean
  /** Every change worth showing. */
  onChange(): void
  now?: () => number
}

export class SubscriptionChecker {
  private inFlight: Promise<void> | null = null
  private lastAttemptAt = 0
  private message: string | null = null
  private firstTimer: NodeJS.Timeout | null = null
  private tick: NodeJS.Timeout | null = null

  constructor(private readonly options: SubscriptionCheckerOptions) {}

  /** A check is on its way. */
  isChecking(): boolean {
    return this.inFlight !== null
  }

  /** What the last check had to say, if anything. */
  lastMessage(): string | null {
    return this.message
  }

  /** Forgets what the last check said, when a new licence replaces the old one. */
  clearMessage(): void {
    this.message = null
  }

  start(): void {
    this.stop()
    this.firstTimer = setTimeout(() => {
      this.firstTimer = null
      void this.checkIfDue()
      this.tick = setInterval(() => void this.checkIfDue(), DUE_TICK_MS)
    }, FIRST_CHECK_DELAY_MS)
  }

  stop(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer)
    if (this.tick) clearInterval(this.tick)
    this.firstTimer = null
    this.tick = null
  }

  /** "Check now": asked for by name, so no schedule holds it back. */
  checkNow(): Promise<void> {
    return this.run()
  }

  /**
   * The daily check. An active subscription is asked about once its last
   * confirmation is a day old; an ended one once a day, so a new subscription
   * is noticed; and a check that learnt nothing is retried after an hour.
   */
  async checkIfDue(): Promise<void> {
    const licence = this.options.licence()
    if (!licence) return
    const now = this.now()
    const sinceAttempt = now - this.lastAttemptAt
    if (this.lastAttemptAt !== 0 && sinceAttempt >= 0 && sinceAttempt < RETRY_INTERVAL_MS) return
    if (licence.subscription === 'active') {
      const sinceConfirmed = now - Date.parse(licence.confirmedAt)
      if (Number.isFinite(sinceConfirmed) && sinceConfirmed >= 0 && sinceConfirmed < CHECK_INTERVAL_MS) {
        return
      }
    } else if (this.lastAttemptAt !== 0 && sinceAttempt >= 0 && sinceAttempt < CHECK_INTERVAL_MS) {
      return
    }
    await this.run()
  }

  private run(): Promise<void> {
    if (this.inFlight) return this.inFlight
    const licence = this.options.licence()
    if (!licence || this.options.busy()) return Promise.resolve()
    this.lastAttemptAt = this.now()
    this.inFlight = this.attempt(licence).finally(() => {
      this.inFlight = null
      this.options.onChange()
    })
    this.options.onChange()
    return this.inFlight
  }

  private async attempt(licence: LicenceRecord): Promise<void> {
    let key: string
    try {
      key = this.options.key()
    } catch (error) {
      this.message = error instanceof Error ? error.message : LICENCE_MESSAGES.checkUnavailable
      return
    }
    let result: CheckResult
    try {
      result = await this.options.check(key, licence)
    } catch {
      result = { outcome: 'unknown', error: LICENCE_MESSAGES.checkUnavailable }
    }
    // Activated again, or released, while the check was out: its answer is
    // about a licence that is no longer this PC's.
    if (this.options.licence()?.activationId !== licence.activationId) return
    const at = new Date(this.now()).toISOString()
    switch (result.outcome) {
      case 'active':
      case 'ended':
        this.message = null
        this.options.record(result.outcome, at)
        return
      case 'released':
        this.message = LICENCE_MESSAGES.released
        this.options.release()
        return
      default:
        this.message = result.error
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}
