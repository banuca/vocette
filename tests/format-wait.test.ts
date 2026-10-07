import { describe, expect, it } from 'vitest'
import {
  formatWait,
  isMeasuredWait,
  TYPICAL_WAIT_SAMPLE,
  typicalWait
} from '../src/shared/format'

describe('formatWait', () => {
  it('gives tenths of a second under ten seconds', () => {
    expect(formatWait(412)).toBe('0.4s')
    expect(formatWait(450)).toBe('0.5s')
    expect(formatWait(1_960)).toBe('2.0s')
    expect(formatWait(9_949)).toBe('9.9s')
  })

  it('gives whole seconds from ten seconds up', () => {
    expect(formatWait(9_950)).toBe('10s')
    expect(formatWait(12_400)).toBe('12s')
    expect(formatWait(61_000)).toBe('61s')
  })

  it('never shows a negative wait', () => {
    expect(formatWait(-50)).toBe('0.0s')
  })
})

describe('isMeasuredWait', () => {
  it('accepts a finite wait of zero or more, and nothing else', () => {
    expect(isMeasuredWait(0)).toBe(true)
    expect(isMeasuredWait(380)).toBe(true)
    for (const value of [undefined, null, '380', -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isMeasuredWait(value)).toBe(false)
    }
  })
})

describe('typicalWait', () => {
  it('is the middle wait, or halfway between the middle two', () => {
    expect(typicalWait([{ waitMs: 900 }, { waitMs: 300 }, { waitMs: 400 }])).toBe(400)
    expect(typicalWait([{ waitMs: 300 }, { waitMs: 500 }])).toBe(400)
  })

  it('leaves out dictations that were never measured', () => {
    expect(typicalWait([{}, { waitMs: 350 }, { waitMs: Number.NaN }])).toBe(350)
    expect(typicalWait([{}, {}])).toBeNull()
    expect(typicalWait([])).toBeNull()
  })

  it('is taken over the newest measured dictations only', () => {
    // History lists newest first: the newest fifty are fast, older ones slow.
    const newest = Array.from({ length: TYPICAL_WAIT_SAMPLE }, () => ({ waitMs: 400 }))
    const older = Array.from({ length: 200 }, () => ({ waitMs: 5_000 }))
    expect(typicalWait([...newest, {}, ...older])).toBe(400)
  })
})
