import { describe, expect, it } from 'vitest'
import { FREE_MONTHLY_WORDS, FREE_WORDS_NOTICE_AT } from '../src/shared/product'
import {
  addWords,
  allowanceCount,
  allowanceFor,
  allowanceUsedUp,
  crossingNote,
  monthKey,
  normaliseWordUsage,
  usedUpStatus,
  wordsThisMonth
} from '../src/shared/word-allowance'

const OCT_15 = new Date(2026, 9, 15, 14, 30)
const OCT_31_LATE = new Date(2026, 9, 31, 23, 59, 59)
const NOV_1 = new Date(2026, 10, 1, 0, 0, 1)
const DEC_31 = new Date(2026, 11, 31, 12)

describe('the free monthly words', () => {
  it('are 10,000, with a notice from 8,000', () => {
    expect(FREE_MONTHLY_WORDS).toBe(10_000)
    expect(FREE_WORDS_NOTICE_AT).toBe(8_000)
  })

  it('count by local calendar month', () => {
    expect(monthKey(OCT_15)).toBe('2026-10')
    expect(monthKey(OCT_31_LATE)).toBe('2026-10')
    expect(monthKey(NOV_1)).toBe('2026-11')
  })

  it('add up within a month and start again on the 1st', () => {
    let usage = addWords(null, 25, OCT_15)
    usage = addWords(usage, 30, OCT_31_LATE)
    expect(usage).toEqual({ month: '2026-10', words: 55 })
    expect(wordsThisMonth(usage, OCT_31_LATE)).toBe(55)
    expect(wordsThisMonth(usage, NOV_1)).toBe(0)
    expect(addWords(usage, 12, NOV_1)).toEqual({ month: '2026-11', words: 12 })
  })

  it('never count a negative, broken or fractional take', () => {
    expect(addWords(null, -5, OCT_15).words).toBe(0)
    expect(addWords(null, Number.NaN, OCT_15).words).toBe(0)
    expect(addWords(null, 7.9, OCT_15).words).toBe(7)
  })

  it('read back only a record that makes sense', () => {
    expect(normaliseWordUsage({ month: '2026-10', words: 412 })).toEqual({ month: '2026-10', words: 412 })
    expect(normaliseWordUsage({ month: '2026-13', words: 1 })).toBeNull()
    expect(normaliseWordUsage({ month: '2026-10', words: -1 })).toBeNull()
    expect(normaliseWordUsage({ month: '2026-10', words: '12' })).toBeNull()
    expect(normaliseWordUsage(null)).toBeNull()
    expect(normaliseWordUsage('2026-10')).toBeNull()
  })

  it('name the month and when it starts again, across the new year too', () => {
    expect(allowanceFor({ month: '2026-10', words: 8_412 }, OCT_15)).toEqual({
      used: 8_412,
      limit: 10_000,
      monthName: 'October',
      resetsOn: '1 November'
    })
    expect(allowanceFor(null, DEC_31)).toMatchObject({ used: 0, monthName: 'December', resetsOn: '1 January' })
  })

  it('are used up at the limit, never on the trial or Pro', () => {
    const at = (used: number) => ({ ...allowanceFor(null, OCT_15), used })
    expect(allowanceUsedUp(at(9_999))).toBe(false)
    expect(allowanceUsedUp(at(10_000))).toBe(true)
    expect(allowanceUsedUp(at(10_412))).toBe(true)
    expect(allowanceUsedUp(null)).toBe(false)
  })

  it('say plainly when a take is refused', () => {
    expect(usedUpStatus(allowanceFor(null, OCT_15))).toEqual({
      message: 'Free words used up for October',
      detail: 'Back on 1 November · Pro has no limit'
    })
  })

  it('speak up once at the notice line and once at the limit, and otherwise not', () => {
    const at = (used: number) => ({ ...allowanceFor(null, OCT_15), used })
    expect(crossingNote(at(100), 30)).toBeNull()
    expect(crossingNote(at(7_990), 25)).toBe('8,015 of 10,000 free words this month')
    expect(crossingNote(at(8_015), 25)).toBeNull()
    expect(crossingNote(at(9_990), 25)).toBe("That's your 10,000 free words for October · back on 1 November")
    // One long take across both lines: the limit is what matters.
    expect(crossingNote(at(7_900), 2_200)).toBe(
      "That's your 10,000 free words for October · back on 1 November"
    )
    expect(crossingNote(null, 25)).toBeNull()
    expect(crossingNote(at(7_990), 0)).toBeNull()
  })

  it('format counts the British way', () => {
    expect(allowanceCount(8_412, 10_000)).toBe('8,412 of 10,000')
  })
})
