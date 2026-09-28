/**
 * The overlay's live level meter, as pure functions: each reading from the
 * recorder (a 0–1 peak, about every 70 ms) becomes five bar heights.
 *
 * Kept out of the overlay's own script, which draws on import, so how the
 * bars rise and fall can be tested without a document. Only the overlay
 * imports it: the recorder takes its reading itself, so the page dictation
 * depends on never loads code shared with another page.
 */

/**
 * Each bar's share of the level. The middle bar is the tallest and the outer
 * ones follow it, so the meter grows with the voice as one shape rather than
 * five bars moving in lockstep.
 */
const BAR_WEIGHTS: readonly number[] = [0.55, 0.8, 1, 0.8, 0.55]

/** How many bars the overlay's meter draws. */
export const LEVEL_BAR_COUNT = BAR_WEIGHTS.length

/**
 * Silence, in dBFS. Just below the quietest reading the recorder can send
 * (0.01, which is −40 dBFS), so any sound it reports shows, while the hiss
 * left after noise suppression — which rounds to 0 — leaves the meter at rest.
 */
const FLOOR_DB = -46

/**
 * How much of a rise is shown at once, and how much of a fall per reading.
 * Readings arrive about every 70 ms, so a syllable reaches the bars within one
 * reading and a pause takes about half a second to settle: the meter follows
 * speech without flickering between words.
 */
const ATTACK = 0.8
const RELEASE = 0.25

/** Below this a bar is at rest, rather than creeping towards it for ever. */
const REST_EPSILON = 0.005

/** The meter with nothing heard: every bar at rest. */
export function restingBars(): number[] {
  return new Array<number>(LEVEL_BAR_COUNT).fill(0)
}

/**
 * A 0–1 peak as a 0–1 loudness. Amplitude is the wrong scale for a voice:
 * quiet speech peaks at a few hundredths and would barely lift a linear meter,
 * while decibels above the floor follow what the ear hears.
 */
export function loudness(level: number): number {
  // Written so that NaN, zero and negatives all land here.
  if (!(level > 0)) return 0
  const decibels = 20 * Math.log10(Math.min(level, 1))
  return Math.min(1, Math.max(0, (decibels - FLOOR_DB) / -FLOOR_DB))
}

/**
 * The next bar heights, 0–1 each, from one reading and the heights before it.
 * A rise is taken almost at once and a fall is let go slowly — attack fast,
 * release slow — which is what makes a level meter readable at a glance.
 * Pass the result back in as `previous` with the next reading; `previous` is
 * never changed.
 */
export function levelToBars(level: number, previous: readonly number[]): number[] {
  const target = loudness(level)
  return BAR_WEIGHTS.map((weight, index) => {
    const before = clampUnit(previous[index] ?? 0)
    const goal = target * weight
    const next = before + (goal - before) * (goal > before ? ATTACK : RELEASE)
    return next < REST_EPSILON ? 0 : next
  })
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}
