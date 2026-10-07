import {
  FREE_REPLACEMENT_RULES,
  FREE_VOCABULARY_TERMS,
  PRO_REPLACEMENT_RULES,
  PRO_VOCABULARY_TERMS,
  SUBSCRIPTION_GRACE_DAYS
} from '../shared/product'
import type { Plan } from '../shared/entitlement'
import type { LicenceStatus } from '../shared/types'

/**
 * Every sentence the window says about Pro, worked out from the status the
 * main process sends. Pure, so the wording is tested once and the Pro page,
 * the sidebar, History and Settings cannot drift apart.
 *
 * The tone is the owner's rule: Free is complete, Pro is for power users.
 * Nothing here counts down, and nothing is said about Pro to someone it
 * would not change anything for.
 */

export function planStatusLine(
  status: Pick<LicenceStatus, 'plan' | 'trialDaysLeft' | 'licence'>
): string {
  if (status.plan === 'pro') return 'Pro — thank you for supporting Vocette'
  if (status.plan === 'trial') {
    const days = status.trialDaysLeft
    return `Pro trial — ${days} ${days === 1 ? 'day' : 'days'} left`
  }
  if (status.licence?.standing === 'unconfirmed') return 'Pro is paused until your subscription is confirmed'
  if (status.licence?.standing === 'ended') return 'Free — your Pro subscription has ended'
  return 'Free — everything you need, for good'
}

/** The sidebar's quiet suffix: only during the trial, never on Free or Pro. */
export function trialBadge(status: Pick<LicenceStatus, 'plan' | 'trialDaysLeft'>): string | null {
  return status.plan === 'trial' ? `Trial · ${status.trialDaysLeft}d` : null
}

/** The two Subscribe buttons, each disabled until the owner has set up its checkout. */
export function subscribeLabels(
  status: Pick<
    LicenceStatus,
    | 'monthlyCheckoutAvailable'
    | 'yearlyCheckoutAvailable'
    | 'monthlyPriceLabel'
    | 'yearlyPriceLabel'
    | 'yearlySavingLabel'
    | 'launchOffer'
  >
): { monthly: string; yearly: string; monthlyWas: string | null; yearlyWas: string | null } {
  // During the launch offer each button carries its launch price, with the
  // normal one struck through beside it.
  const offer = status.launchOffer
  return {
    monthly: status.monthlyCheckoutAvailable
      ? `Monthly — ${offer ? offer.monthlyPriceLabel : status.monthlyPriceLabel}`
      : 'Monthly — opens soon',
    yearly: status.yearlyCheckoutAvailable
      ? offer
        ? `Yearly — ${offer.yearlyPriceLabel}`
        : `Yearly — ${status.yearlyPriceLabel} · ${status.yearlySavingLabel}`
      : 'Yearly — opens soon',
    monthlyWas: status.monthlyCheckoutAvailable && offer ? offer.monthlyWas : null,
    yearlyWas: status.yearlyCheckoutAvailable && offer ? offer.yearlyWas : null
  }
}

/**
 * The launch offer, above the buttons, while it can be taken up and a checkout
 * is open; empty otherwise. It names the 100 places because the app cannot tell
 * when they are gone, and Polar's checkout shows the price that applies.
 */
export function launchOfferLine(
  status: Pick<LicenceStatus, 'launchOffer' | 'monthlyCheckoutAvailable' | 'yearlyCheckoutAvailable'>
): string {
  const offer = status.launchOffer
  if (!offer || (!status.monthlyCheckoutAvailable && !status.yearlyCheckoutAvailable)) return ''
  return (
    `Launch offer for the first ${offer.places} subscribers, until ${offer.endsLabel}: the ` +
    'yearly plan at half price forever, the monthly plan at 25% off forever.'
  )
}

/** Said under the plans: what one subscription covers, and how to stop it. */
export function plansNote(status: Pick<LicenceStatus, 'devices'>): string {
  return (
    `One subscription covers up to ${status.devices} devices. Cancel any time; Pro stays on ` +
    'until the end of the period you have paid for.'
  )
}

/** Said under the key field before anything is sent. */
export function activationNote(status: Pick<LicenceStatus, 'deviceLabel'>): string {
  return (
    `Activating sends your key and a device label (“${status.deviceLabel}”) to Polar, our ` +
    'payment provider. While you are subscribed, Vocette asks Polar once a day whether the ' +
    'subscription is still active, and sends nothing else.'
  )
}

/** "E304DA" from Polar's "****-E304DA", or the four characters kept instead. */
export function keyEnding(displayKey: string): string {
  const visible = displayKey.replace(/^[*\-\s]+/u, '')
  return visible || displayKey
}

/** "25 September 2026", or nothing for a date that cannot be read. */
export function longDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date)
}

/** "today", "yesterday", "12 days ago". */
export function daysAgo(iso: string, now: number): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const startOf = (time: number): number => {
    const day = new Date(time)
    day.setHours(0, 0, 0, 0)
    return day.getTime()
  }
  const days = Math.round((startOf(now) - startOf(then.getTime())) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/** The line under "Your subscription", for a key activated on this PC. */
export function subscriptionLine(
  licence: NonNullable<LicenceStatus['licence']>,
  now: number
): string {
  const key = `key ending ${keyEnding(licence.displayKey)}`
  if (licence.standing === 'ended') {
    return (
      `Your subscription has ended (${key}). Subscribe again and this key works again — ` +
      'press Check now once you have.'
    )
  }
  if (licence.standing === 'unconfirmed') {
    return (
      `Your subscription has not been confirmed for ${SUBSCRIPTION_GRACE_DAYS} days, so Pro is ` +
      'paused. Connect to the internet and press Check now.'
    )
  }
  const confirmed = daysAgo(licence.confirmedAt, now)
  const line = `Subscription active on this PC · ${key} · confirmed ${confirmed}`
  // Only once a check has been missed: the usual case says nothing more.
  if (confirmed === 'today' || confirmed === 'yesterday') return line
  const left = licence.graceDaysLeft
  return `${line}. Pro keeps working for ${left} more ${left === 1 ? 'day' : 'days'} without a check.`
}

/**
 * The line under the vocabulary once a list is longer than Free's limit, or
 * null when the plan changes nothing about it.
 */
export function vocabularyPlanNote(plan: Plan, terms: number): string | null {
  if (terms <= FREE_VOCABULARY_TERMS) return null
  if (plan === 'free') {
    return `Using ${FREE_VOCABULARY_TERMS} of your ${terms} terms — Pro uses all of them.`
  }
  if (plan === 'trial') return `Pro trial: all ${terms} terms in use.`
  return null
}

/** The same for the replacement rules. */
export function replacementsPlanNote(plan: Plan, rules: number): string | null {
  if (rules <= FREE_REPLACEMENT_RULES) return null
  if (plan === 'free') {
    return `Using ${FREE_REPLACEMENT_RULES} of your ${rules} rules — Pro uses all of them.`
  }
  if (plan === 'trial') return `Pro trial: all ${rules} rules in use.`
  return null
}

/** History's one notice, shown once the trial has ended, until it is dismissed. */
export const TRIAL_END_NOTICE =
  'Your Pro trial has ended. Vocette keeps working as it did — AI polish and lists longer ' +
  `than ${FREE_VOCABULARY_TERMS} terms or ${FREE_REPLACEMENT_RULES} rules are part of Pro.`

/** The right-hand column of the plans: what Pro adds. */
export const PRO_ADDS: readonly string[] = [
  `Up to ${PRO_VOCABULARY_TERMS} vocabulary terms in use, instead of ${FREE_VOCABULARY_TERMS}`,
  `Up to ${PRO_REPLACEMENT_RULES} replacements and snippets in use, instead of ${FREE_REPLACEMENT_RULES}`,
  'AI polish: your dictation rewritten in the style you choose, with your own provider or a model on this PC'
]

/** The left-hand column: what never needs Pro. */
export const FREE_FOREVER: readonly string[] = [
  'Dictation on this PC or in the cloud — any length, as often as you like',
  'Cleanup, spoken corrections and spoken line breaks',
  'Clipboard restore, paste last dictation, Retry and history',
  `${FREE_VOCABULARY_TERMS} vocabulary terms and ${FREE_REPLACEMENT_RULES} replacements and snippets in use`
]
