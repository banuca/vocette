import {
  FREE_REPLACEMENT_RULES,
  FREE_VOCABULARY_TERMS,
  PRO_REPLACEMENT_RULES,
  PRO_VOCABULARY_TERMS,
  SUBSCRIPTION_GRACE_DAYS,
  TRIAL_DAYS
} from './product'
import { parseReplacements, type ReplacementRule } from './replacements'
import { parseVocabulary } from './vocabulary'

/**
 * Which plan is in force, worked out from two facts and the clock: when this
 * profile's trial began, and whether this PC holds a subscription that Polar
 * has confirmed recently enough (see `subscriptionStanding`).
 *
 * Pure, and asked afresh every time it matters — every dictation, every time
 * the window asks — so the trial ends when it ends, without a restart, and a
 * clock that moves is simply read again.
 */

export type Plan = 'trial' | 'pro' | 'free'

export interface Entitlement {
  plan: Plan
  /** True while Pro's limits apply: during the trial and with a licence. */
  pro: boolean
  /** Whole days left in the trial, rounded up; 0 outside it. */
  trialDaysLeft: number
  /** When the trial ends or ended, as an ISO string; null with a licence. */
  trialEndsAt: string | null
}

const DAY_MS = 86_400_000

export function entitlementFor(input: {
  trialStartedAt: string | null
  /** A subscription confirmed within the grace period: `subscriptionStanding` is 'active'. */
  subscribed: boolean
  now: number
}): Entitlement {
  if (input.subscribed) return { plan: 'pro', pro: true, trialDaysLeft: 0, trialEndsAt: null }

  const now = Number.isFinite(input.now) ? input.now : Date.now()
  // A date that cannot be read is treated as a trial starting now: the one
  // reading that neither takes the trial away nor hands out a longer one.
  const parsed = input.trialStartedAt === null ? Number.NaN : Date.parse(input.trialStartedAt)
  const start = Number.isFinite(parsed) ? parsed : now
  const end = start + TRIAL_DAYS * DAY_MS
  const endDate = new Date(end)
  const trialEndsAt = Number.isNaN(endDate.getTime()) ? null : endDate.toISOString()

  if (now < end) {
    // A clock set before the start counts as day 0: never more than the
    // trial's length, never negative.
    const remaining = end - Math.max(now, start)
    return {
      plan: 'trial',
      pro: true,
      trialDaysLeft: Math.min(TRIAL_DAYS, Math.max(1, Math.ceil(remaining / DAY_MS))),
      trialEndsAt
    }
  }
  return { plan: 'free', pro: false, trialDaysLeft: 0, trialEndsAt }
}

/**
 * Where this PC's subscription stands:
 * - `none`: no licence key is activated here;
 * - `active`: Polar confirmed it within the last `SUBSCRIPTION_GRACE_DAYS`;
 * - `unconfirmed`: not confirmed for longer than that — Pro pauses until a
 *   check succeeds, because a subscription can end while a PC is offline;
 * - `ended`: Polar said the subscription has ended. The key is kept, so a new
 *   subscription brings Pro back at the next check.
 */
export type SubscriptionStanding = 'none' | 'active' | 'unconfirmed' | 'ended'

export function subscriptionStanding(
  licence: { subscription: 'active' | 'ended'; confirmedAt: string } | null,
  now: number
): SubscriptionStanding {
  if (!licence) return 'none'
  if (licence.subscription === 'ended') return 'ended'
  const confirmed = Date.parse(licence.confirmedAt)
  const since = now - confirmed
  // A clock set back makes `since` negative: that is a recent confirmation,
  // not an old one, and never a reason to pause what was paid for.
  if (Number.isFinite(since) && since > SUBSCRIPTION_GRACE_DAYS * DAY_MS) return 'unconfirmed'
  return Number.isFinite(since) ? 'active' : 'unconfirmed'
}

/** Days of the grace period left, rounded up like the trial's; 0 once it is spent. */
export function graceDaysLeft(confirmedAt: string, now: number): number {
  const since = Math.max(0, now - Date.parse(confirmedAt))
  if (!Number.isFinite(since)) return 0
  return Math.max(0, Math.ceil((SUBSCRIPTION_GRACE_DAYS * DAY_MS - since) / DAY_MS))
}

/** How many vocabulary terms a dictation uses on this plan. */
export function vocabularyTermLimit(pro: boolean): number {
  return pro ? PRO_VOCABULARY_TERMS : FREE_VOCABULARY_TERMS
}

/** How many replacement rules a dictation applies on this plan. */
export function replacementRuleLimit(pro: boolean): number {
  return pro ? PRO_REPLACEMENT_RULES : FREE_REPLACEMENT_RULES
}

/**
 * The terms a dictation uses: the first ones, in the user's own order, up to
 * the plan's limit. The stored list is never touched — a list longer than
 * Free's limit keeps every line, and all of it comes back with Pro.
 */
export function planVocabulary(raw: string, pro: boolean): string[] {
  return parseVocabulary(raw).slice(0, vocabularyTermLimit(pro))
}

/** The rules a dictation applies, the same way: the first ones, up to the limit. */
export function planReplacements(raw: string, pro: boolean): ReplacementRule[] {
  return parseReplacements(raw).rules.slice(0, replacementRuleLimit(pro))
}
