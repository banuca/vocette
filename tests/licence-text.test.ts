import { describe, expect, it } from 'vitest'
import {
  FREE_FOREVER,
  PRO_ADDS,
  TRIAL_END_NOTICE,
  activationNote,
  activeLicenceLine,
  buyLabel,
  keyEnding,
  longDate,
  planStatusLine,
  replacementsPlanNote,
  trialBadge,
  vocabularyPlanNote
} from '../src/renderer/licence-text'
import { licenceStatus } from './fixtures/licence-status'

describe('the status line', () => {
  it('names the plan in the owner’s words', () => {
    expect(planStatusLine(licenceStatus({ plan: 'trial', trialDaysLeft: 23 }))).toBe(
      'Pro trial — 23 days left'
    )
    expect(planStatusLine(licenceStatus({ plan: 'trial', trialDaysLeft: 1 }))).toBe(
      'Pro trial — 1 day left'
    )
    expect(planStatusLine(licenceStatus({ plan: 'pro' }))).toBe(
      'Pro — thank you for supporting Murmur'
    )
    expect(planStatusLine(licenceStatus({ plan: 'free' }))).toBe(
      'Free — everything you need, for good'
    )
  })
})

describe('the sidebar suffix', () => {
  it('appears during the trial only', () => {
    expect(trialBadge(licenceStatus({ plan: 'trial', trialDaysLeft: 23 }))).toBe('Trial · 23d')
    expect(trialBadge(licenceStatus({ plan: 'free' }))).toBeNull()
    expect(trialBadge(licenceStatus({ plan: 'pro' }))).toBeNull()
  })
})

describe('the Buy button', () => {
  it('carries the price, or says purchases open soon while there is no checkout', () => {
    expect(buyLabel(licenceStatus({ checkoutAvailable: true }))).toBe(
      'Buy Pro — US$29, once, for up to 3 PCs'
    )
    expect(buyLabel(licenceStatus({ checkoutAvailable: false }))).toBe('Pro purchases open soon')
  })
})

describe('the licence lines', () => {
  it('says what activating sends, and that it happens once', () => {
    expect(activationNote(licenceStatus({ deviceLabel: 'Murmur on Windows · 7F3A' }))).toBe(
      'Activating sends your key and a device label (“Murmur on Windows · 7F3A”) to Polar, our ' +
        'payment provider, once. Murmur never checks again.'
    )
  })

  it('shows only the end of the key, and the date in words', () => {
    expect(keyEnding('****-E304DA')).toBe('E304DA')
    expect(keyEnding('ABCD')).toBe('ABCD')
    expect(keyEnding('****')).toBe('****')
    expect(longDate('2026-09-25T13:48:13.251Z')).toBe('25 September 2026')
    expect(longDate('not a date')).toBe('')
    expect(activeLicenceLine({ displayKey: 'ABCD', activatedAt: '2026-09-25T10:00:00.000Z' })).toBe(
      'Pro is active on this PC · key ending ABCD · activated 25 September 2026'
    )
    expect(activeLicenceLine({ displayKey: '****-E304DA', activatedAt: '' })).toBe(
      'Pro is active on this PC · key ending E304DA'
    )
  })
})

describe('the notes under the lists', () => {
  it('say how much of a long list Free uses, and that Pro uses all of it', () => {
    expect(vocabularyPlanNote('free', 80)).toBe('Using 50 of your 80 terms — Pro uses all of them.')
    expect(replacementsPlanNote('free', 35)).toBe(
      'Using 20 of your 35 rules — Pro uses all of them.'
    )
  })

  it('say during the trial that the whole list is in use', () => {
    expect(vocabularyPlanNote('trial', 80)).toBe('Pro trial: all 80 terms in use.')
    expect(replacementsPlanNote('trial', 35)).toBe('Pro trial: all 35 rules in use.')
  })

  it('say nothing when the plan changes nothing', () => {
    expect(vocabularyPlanNote('free', 50)).toBeNull()
    expect(vocabularyPlanNote('trial', 12)).toBeNull()
    expect(vocabularyPlanNote('pro', 480)).toBeNull()
    expect(replacementsPlanNote('free', 20)).toBeNull()
    expect(replacementsPlanNote('pro', 150)).toBeNull()
  })
})

describe('the words about the plans', () => {
  it('give the trial’s end in one notice, word for word', () => {
    expect(TRIAL_END_NOTICE).toBe(
      'Your Pro trial has ended. Murmur keeps working as it did — AI polish and lists longer ' +
        'than 50 terms or 20 rules are part of Pro.'
    )
  })

  it('list what Pro adds and what stays free, without promising what has not shipped', () => {
    expect(PRO_ADDS).toEqual([
      'Up to 500 vocabulary terms in use, instead of 50',
      'Up to 200 replacements and snippets in use, instead of 20',
      'AI polish: your dictation rewritten in the style you choose, with your own provider or a model on this PC'
    ])
    expect(FREE_FOREVER[0]).toBe(
      'Dictation on this PC or in the cloud — any length, as often as you like'
    )
    expect(FREE_FOREVER).toHaveLength(4)
  })
})
