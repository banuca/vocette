/**
 * Opt-in counts (decision M, owner 16 Oct 2026): what the PC keeps so it can
 * say, once a day, roughly how it is being used, and the report it builds.
 *
 * Nothing here identifies anyone. The PC keeps one number per day for the
 * last seven days, and only while the user has switched counts on; the
 * report is worked out from those and a few facts the app already has. No
 * install ID, no words, no audio, no app names. Retention is answered by the
 * PC about itself ("dictated on 5 of the last 7 days, in its second week"), so
 * the server never needs to tell one report's sender from another's.
 */

/** Dictations per local day, "2026-10-19" → 3, for at most the last seven days. */
export type UsageDays = Record<string, number>

export interface CountsReport {
  v: string
  os: 'windows' | 'macos' | 'linux' | 'other'
  engine: 'local' | 'cloud'
  plan: 'free' | 'trial' | 'pro'
  /** Whole weeks since this install's first run, 0 to 12; 12 means 12 or more. */
  week: number
  /** Days with at least one dictation among the last seven, today included. */
  activeDays7: number
  /** Dictations in those seven days, at most 999. */
  dictations7: number
  /** The free monthly limit has been reached this month. */
  limitHit: boolean
}

/** What the About page shows: the switch, and the report as it would be sent now. */
export interface CountsStatus {
  enabled: boolean
  report: CountsReport
}

export const WINDOW_DAYS = 7
export const MAX_WEEK = 12
export const MAX_DICTATIONS = 999
const DAY_MS = 24 * 60 * 60 * 1000

/** "2026-10-19", in this PC's local time. */
export function dayKey(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** The seven local days ending today, oldest first. */
function windowKeys(now: Date): string[] {
  const keys: string[] = []
  for (let back = WINDOW_DAYS - 1; back >= 0; back -= 1) {
    keys.push(dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)))
  }
  return keys
}

/** Only the days still inside the window; anything older is forgotten. */
function prune(days: UsageDays, now: Date): UsageDays {
  const kept: UsageDays = {}
  for (const key of windowKeys(now)) {
    const count = days[key]
    if (count) kept[key] = count
  }
  return kept
}

/** The record after one more dictation today. */
export function recordDictation(days: UsageDays | null, now: Date): UsageDays {
  const kept = prune(days ?? {}, now)
  const today = dayKey(now)
  kept[today] = Math.min(MAX_DICTATIONS, (kept[today] ?? 0) + 1)
  return kept
}

/** A stored record that can be used: day keys and whole positive counts only. */
export function normaliseUsageDays(value: unknown): UsageDays | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const days: UsageDays = {}
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u.test(key)) continue
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) continue
    days[key] = Math.min(MAX_DICTATIONS, Math.floor(count))
    if (Object.keys(days).length >= 31) break
  }
  return days
}

/** Whole weeks from `firstRunAt` to `now`, 0 when unknown or in the future, at most 12. */
export function weeksSince(firstRunAt: string | null, now: Date): number {
  const start = firstRunAt ? Date.parse(firstRunAt) : Number.NaN
  if (Number.isNaN(start) || start > now.getTime()) return 0
  return Math.min(MAX_WEEK, Math.floor((now.getTime() - start) / (7 * DAY_MS)))
}

export function buildReport(input: {
  version: string
  os: CountsReport['os']
  engine: CountsReport['engine']
  plan: CountsReport['plan']
  firstRunAt: string | null
  days: UsageDays | null
  limitHit: boolean
  now: Date
}): CountsReport {
  const days = prune(input.days ?? {}, input.now)
  const counts = Object.values(days)
  return {
    v: input.version,
    os: input.os,
    engine: input.engine,
    plan: input.plan,
    week: weeksSince(input.firstRunAt, input.now),
    activeDays7: counts.length,
    dictations7: Math.min(MAX_DICTATIONS, counts.reduce((sum, count) => sum + count, 0)),
    limitHit: input.limitHit
  }
}
