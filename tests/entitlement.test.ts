import { describe, expect, it } from 'vitest'
import {
  entitlementFor,
  planReplacements,
  planVocabulary,
  replacementRuleLimit,
  vocabularyTermLimit
} from '../src/shared/entitlement'
import {
  FREE_REPLACEMENT_RULES,
  FREE_VOCABULARY_TERMS,
  PRO_REPLACEMENT_RULES,
  PRO_VOCABULARY_TERMS,
  TRIAL_DAYS
} from '../src/shared/product'

const DAY = 86_400_000
const START = Date.parse('2026-09-25T09:00:00.000Z')
const STARTED = new Date(START).toISOString()

const at = (offsetMs: number, licensed = false) =>
  entitlementFor({ trialStartedAt: STARTED, licensed, now: START + offsetMs })

describe('the trial', () => {
  it('lasts thirty days and starts with all of them left', () => {
    expect(TRIAL_DAYS).toBe(30)
    expect(at(0)).toEqual({
      plan: 'trial',
      pro: true,
      trialDaysLeft: 30,
      trialEndsAt: new Date(START + 30 * DAY).toISOString()
    })
  })

  it('rounds the days left up, so the last day still reads as one', () => {
    expect(at(1).trialDaysLeft).toBe(30)
    expect(at(DAY - 1).trialDaysLeft).toBe(30)
    expect(at(DAY).trialDaysLeft).toBe(29)
    expect(at(7 * DAY + 5).trialDaysLeft).toBe(23)
    expect(at(29 * DAY).trialDaysLeft).toBe(1)
    expect(at(30 * DAY - 1)).toMatchObject({ plan: 'trial', pro: true, trialDaysLeft: 1 })
  })

  it('ends exactly thirty days after it began, and Free follows', () => {
    const ended = at(30 * DAY)
    expect(ended).toEqual({
      plan: 'free',
      pro: false,
      trialDaysLeft: 0,
      trialEndsAt: new Date(START + 30 * DAY).toISOString()
    })
    expect(at(400 * DAY).plan).toBe('free')
  })

  it('counts a clock set before the start as day 0 — never negative, never longer', () => {
    const early = at(-3 * DAY)
    expect(early.plan).toBe('trial')
    expect(early.pro).toBe(true)
    expect(early.trialDaysLeft).toBe(30)
    // Years out of step is still day 0, not a crash or a thousand days.
    expect(at(-5 * 365 * DAY).trialDaysLeft).toBe(30)
  })

  it('treats a start date it cannot read as a trial starting now', () => {
    const now = START + 90 * DAY
    for (const trialStartedAt of ['yesterday', '', 'not a date', null]) {
      const result = entitlementFor({ trialStartedAt, licensed: false, now })
      expect(result.plan).toBe('trial')
      expect(result.trialDaysLeft).toBe(30)
      expect(result.trialEndsAt).toBe(new Date(now + 30 * DAY).toISOString())
    }
  })

  it('does not crash on a date at the edge of what a clock can hold', () => {
    const edge = '+275760-09-13T00:00:00.000Z'
    const result = entitlementFor({ trialStartedAt: edge, licensed: false, now: START })
    expect(result.plan).toBe('trial')
    expect(result.trialDaysLeft).toBe(30)
    expect(result.trialEndsAt).toBeNull()
  })
})

describe('a licence', () => {
  it('is Pro, during the trial and after it', () => {
    const expected = { plan: 'pro', pro: true, trialDaysLeft: 0, trialEndsAt: null }
    expect(at(0, true)).toEqual(expected)
    expect(at(45 * DAY, true)).toEqual(expected)
    expect(entitlementFor({ trialStartedAt: null, licensed: true, now: START })).toEqual(expected)
  })
})

describe('the plan limits', () => {
  it('are 50 terms and 20 rules on Free, 500 and 200 with Pro', () => {
    expect(vocabularyTermLimit(false)).toBe(FREE_VOCABULARY_TERMS)
    expect(vocabularyTermLimit(true)).toBe(PRO_VOCABULARY_TERMS)
    expect(replacementRuleLimit(false)).toBe(FREE_REPLACEMENT_RULES)
    expect(replacementRuleLimit(true)).toBe(PRO_REPLACEMENT_RULES)
    expect([FREE_VOCABULARY_TERMS, PRO_VOCABULARY_TERMS]).toEqual([50, 500])
    expect([FREE_REPLACEMENT_RULES, PRO_REPLACEMENT_RULES]).toEqual([20, 200])
  })

  it('use the first terms of a longer list, in order, and leave the list itself alone', () => {
    const raw = Array.from({ length: 80 }, (_, index) => `term${index}`).join('\n')
    const free = planVocabulary(raw, false)
    expect(free).toHaveLength(50)
    expect(free[0]).toBe('term0')
    expect(free.at(-1)).toBe('term49')
    expect(planVocabulary(raw, true)).toHaveLength(80)
    // The same stored text gives all 80 back the moment Pro applies again.
    expect(raw.split('\n')).toHaveLength(80)
  })

  it('apply the first rules of a longer list, in order', () => {
    const raw = Array.from({ length: 30 }, (_, index) => `word${index} => W${index}`).join('\n')
    const free = planReplacements(raw, false)
    expect(free).toHaveLength(20)
    expect(free[0]).toEqual({ spoken: 'word0', written: 'W0' })
    expect(free.at(-1)).toEqual({ spoken: 'word19', written: 'W19' })
    expect(planReplacements(raw, true)).toHaveLength(30)
  })

  it('change nothing for a list inside the Free limit', () => {
    expect(planVocabulary('Kirinde\nITU-T', false)).toEqual(['Kirinde', 'ITU-T'])
    expect(planReplacements('itu => ITU', false)).toEqual([{ spoken: 'itu', written: 'ITU' }])
  })
})
