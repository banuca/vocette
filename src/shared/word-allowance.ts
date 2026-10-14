import { FREE_MONTHLY_WORDS, FREE_WORDS_NOTICE_AT } from './product'

/**
 * Free's monthly words: how many have been dictated this calendar month on
 * this PC, and what that means for the next take.
 *
 * The count is its own record, apart from History, so clearing History or
 * letting it expire never hands words back. Months are this PC's local
 * calendar months, and a count from an earlier month reads as zero, so the
 * 1st needs no timer. Only words dictated on Free are counted: the trial and
 * Pro have no limit, and a trial that ends mid-month starts Free at zero.
 */

/** As stored: the month it counts, "2026-10", and the words in it. */
export interface WordUsage {
  month: string
  words: number
}

/** What a Free user's month looks like now; there is none on the trial or Pro. */
export interface WordAllowance {
  used: number
  limit: number
  /** "October": the month being counted. */
  monthName: string
  /** "1 November": when the count starts again. */
  resetsOn: string
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
] as const

/** "2026-10", in this PC's local time. */
export function monthKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** Words counted this month; a record from another month, or none, is zero. */
export function wordsThisMonth(usage: WordUsage | null, now: Date): number {
  if (!usage || usage.month !== monthKey(now)) return 0
  return usage.words
}

/** The record after a take of `words` words, started afresh in a new month. */
export function addWords(usage: WordUsage | null, words: number, now: Date): WordUsage {
  const add = Number.isFinite(words) && words > 0 ? Math.floor(words) : 0
  return { month: monthKey(now), words: wordsThisMonth(usage, now) + add }
}

/** A stored record that can be used, or null. */
export function normaliseWordUsage(value: unknown): WordUsage | null {
  if (typeof value !== 'object' || value === null) return null
  const { month, words } = value as Record<string, unknown>
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(month)) return null
  if (typeof words !== 'number' || !Number.isFinite(words) || words < 0) return null
  return { month, words: Math.floor(words) }
}

export function allowanceFor(usage: WordUsage | null, now: Date): WordAllowance {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return {
    used: wordsThisMonth(usage, now),
    limit: FREE_MONTHLY_WORDS,
    monthName: MONTH_NAMES[now.getMonth()] ?? '',
    resetsOn: `1 ${MONTH_NAMES[next.getMonth()] ?? ''}`
  }
}

/** No new take starts once the month's words are used. */
export function allowanceUsedUp(allowance: WordAllowance | null): boolean {
  return allowance !== null && allowance.used >= allowance.limit
}

/** "8,412 of 10,000". */
export function allowanceCount(used: number, limit: number): string {
  return `${used.toLocaleString('en-GB')} of ${limit.toLocaleString('en-GB')}`
}

/** What the pill says when a new take is refused. */
export function usedUpStatus(allowance: WordAllowance): { message: string; detail: string } {
  return {
    message: `Free words used up for ${allowance.monthName}`,
    detail: `Back on ${allowance.resetsOn} · Pro has no limit`
  }
}

/**
 * What the success of a take says about the month, when the take crossed a
 * line: the notice line once, and the limit once. Null otherwise, which is
 * almost always.
 */
export function crossingNote(allowance: WordAllowance | null, words: number): string | null {
  if (!allowance || words <= 0) return null
  const before = allowance.used
  const after = before + words
  if (before < allowance.limit && after >= allowance.limit) {
    return `That's your ${allowance.limit.toLocaleString('en-GB')} free words for ${allowance.monthName} · back on ${allowance.resetsOn}`
  }
  if (before < FREE_WORDS_NOTICE_AT && after >= FREE_WORDS_NOTICE_AT) {
    return `${allowanceCount(after, allowance.limit)} free words this month`
  }
  return null
}
