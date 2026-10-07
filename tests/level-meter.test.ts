import { describe, expect, it } from 'vitest'
import { LEVEL_BAR_COUNT, levelToBars, loudness, restingBars } from '../src/renderer/level-meter'

/**
 * The meter answers "is it hearing me?", so these tests are about what the
 * user would read from it: silence at rest, a quiet voice visible, a louder
 * one taller, a rise shown at once and a pause let go gently.
 */

/** Feeds the same reading `times` times, as ~70 ms readings would arrive. */
function feed(level: number, times: number, from: readonly number[] = restingBars()): number[] {
  let bars = [...from]
  for (let index = 0; index < times; index += 1) bars = levelToBars(level, bars)
  return bars
}

const middle = (bars: readonly number[]): number => bars[2] ?? Number.NaN

describe('loudness', () => {
  it('follows decibels, so a quiet voice is not lost at the bottom', () => {
    // Quiet speech peaks at a few hundredths; a linear meter would show 2 %.
    expect(loudness(0.02)).toBeGreaterThan(0.2)
    expect(loudness(0.1)).toBeGreaterThan(0.5)
    expect(loudness(1)).toBe(1)
  })

  it('rises with the level and stays within 0–1', () => {
    const levels = [0, 0.01, 0.02, 0.05, 0.1, 0.3, 0.6, 1, 4]
    const values = levels.map(loudness)
    values.forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    })
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThanOrEqual(values[index - 1] ?? 0)
    }
  })

  it('treats silence and nonsense as silence', () => {
    expect(loudness(0)).toBe(0)
    expect(loudness(-0.5)).toBe(0)
    expect(loudness(Number.NaN)).toBe(0)
  })
})

describe('levelToBars', () => {
  it('draws five bars, all at rest while nothing is heard', () => {
    expect(LEVEL_BAR_COUNT).toBe(5)
    expect(restingBars()).toEqual([0, 0, 0, 0, 0])
    expect(feed(0, 10)).toEqual([0, 0, 0, 0, 0])
  })

  it('shows even the quietest reading the recorder sends', () => {
    expect(middle(levelToBars(0.01, restingBars()))).toBeGreaterThan(0.05)
  })

  it('rises almost at once when the voice starts', () => {
    // One reading, about 70 ms: most of the way there already.
    const bars = levelToBars(1, restingBars())
    expect(middle(bars)).toBeGreaterThanOrEqual(0.75)
    expect(middle(feed(1, 3))).toBeGreaterThan(0.95)
  })

  it('lets go slowly in a pause, and then comes fully to rest', () => {
    const speaking = feed(1, 6)
    const afterOne = levelToBars(0, speaking)
    // A single quiet reading between words barely dips the meter.
    expect(middle(afterOne)).toBeGreaterThan(0.7)
    // About half a second of quiet takes it most of the way down…
    expect(middle(feed(0, 7, speaking))).toBeLessThan(0.15)
    // …and it settles exactly at rest instead of creeping for ever.
    expect(feed(0, 30, speaking)).toEqual([0, 0, 0, 0, 0])
  })

  it('grows as one shape, tallest in the middle', () => {
    const [outerLeft, innerLeft, centre, innerRight, outerRight] = feed(0.3, 8)
    expect(centre).toBeGreaterThan(innerLeft ?? 1)
    expect(centre).toBeGreaterThan(innerRight ?? 1)
    expect(innerLeft).toBeGreaterThan(outerLeft ?? 1)
    expect(innerRight).toBeGreaterThan(outerRight ?? 1)
  })

  it('is taller for a louder voice', () => {
    expect(middle(feed(0.3, 8))).toBeGreaterThan(middle(feed(0.05, 8)))
    expect(middle(feed(0.05, 8))).toBeGreaterThan(middle(feed(0.01, 8)))
  })

  it('keeps every bar within 0–1 whatever it is given', () => {
    const inputs = [0, 0.5, 1, 7, -3, Number.NaN, Number.POSITIVE_INFINITY]
    const previous = [[], [2, -1, Number.NaN, 0.5], restingBars(), [1, 1, 1, 1, 1]]
    for (const level of inputs) {
      for (const before of previous) {
        const bars = levelToBars(level, before)
        expect(bars).toHaveLength(5)
        bars.forEach((bar) => {
          expect(Number.isFinite(bar)).toBe(true)
          expect(bar).toBeGreaterThanOrEqual(0)
          expect(bar).toBeLessThanOrEqual(1)
        })
      }
    }
  })

  it('never changes the heights it was given', () => {
    const before = [0.2, 0.3, 0.4, 0.3, 0.2]
    const copy = [...before]
    levelToBars(1, before)
    levelToBars(0, before)
    expect(before).toEqual(copy)
  })
})
