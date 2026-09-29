import {
  FREE_REPLACEMENT_RULES,
  FREE_VOCABULARY_TERMS,
  PRO_REPLACEMENT_RULES,
  PRO_VOCABULARY_TERMS
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

export function planStatusLine(status: Pick<LicenceStatus, 'plan' | 'trialDaysLeft'>): string {
  if (status.plan === 'pro') return 'Pro — thank you for supporting Vocette'
  if (status.plan === 'free') return 'Free — everything you need, for good'
  const days = status.trialDaysLeft
  return `Pro trial — ${days} ${days === 1 ? 'day' : 'days'} left`
}

/** The sidebar's quiet suffix: only during the trial, never on Free or Pro. */
export function trialBadge(status: Pick<LicenceStatus, 'plan' | 'trialDaysLeft'>): string | null {
  return status.plan === 'trial' ? `Trial · ${status.trialDaysLeft}d` : null
}

/** The Buy button, which is disabled until the owner has set up a checkout. */
export function buyLabel(status: Pick<LicenceStatus, 'checkoutAvailable' | 'priceLabel'>): string {
  return status.checkoutAvailable ? `Buy Pro — ${status.priceLabel}` : 'Pro purchases open soon'
}

/** Said under the key field before anything is sent. */
export function activationNote(status: Pick<LicenceStatus, 'deviceLabel'>): string {
  return (
    `Activating sends your key and a device label (“${status.deviceLabel}”) to Polar, our ` +
    'payment provider, once. Vocette never checks again.'
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

export function activeLicenceLine(licence: { displayKey: string; activatedAt: string }): string {
  const date = longDate(licence.activatedAt)
  const ending = `Pro is active on this PC · key ending ${keyEnding(licence.displayKey)}`
  return date ? `${ending} · activated ${date}` : ending
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
