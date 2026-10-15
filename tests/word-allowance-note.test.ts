import { describe, expect, it } from 'vitest'
import { wordAllowanceNoteState } from '../src/renderer/word-allowance-note'

const october = (used: number) => ({ used, limit: 10_000, monthName: 'October', resetsOn: '1 November' })

describe("History's line about Free's month", () => {
  it('says nothing on the trial or Pro, or before 8,000 words', () => {
    expect(wordAllowanceNoteState(null)).toBeNull()
    expect(wordAllowanceNoteState(october(0))).toBeNull()
    expect(wordAllowanceNoteState(october(7_999))).toBeNull()
  })

  it('gives the count and when it starts again from 8,000', () => {
    expect(wordAllowanceNoteState(october(8_412))).toEqual({
      usedUp: false,
      percent: 84,
      text: '8,412 of 10,000 free words this month. The count starts again on 1 November.'
    })
  })

  it('says when dictation is back once the words are used', () => {
    expect(wordAllowanceNoteState(october(10_027))).toEqual({
      usedUp: true,
      percent: 100,
      text: "You have used this month's 10,000 free words. Dictation is back on 1 November."
    })
  })
})
