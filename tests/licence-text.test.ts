import { describe, expect, it } from 'vitest'
import {
  FREE_FOREVER,
  PRO_ADDS,
  TRIAL_END_NOTICE,
  activationNote,
  daysAgo,
  keyEnding,
  launchOfferLine,
  longDate,
  planStatusLine,
  plansNote,
  subscribeLabels,
  subscriptionLine,
  replacementsPlanNote,
  trialBadge,
  vocabularyPlanNote
} from '../src/renderer/licence-text'
import { LAUNCH_OFFER, licenceStatus } from './fixtures/licence-status'

describe('the status line', () => {
  it('names the plan in the owner’s words', () => {
    expect(planStatusLine(licenceStatus({ plan: 'trial', trialDaysLeft: 23 }))).toBe(
      'Pro trial — 23 days left'
    )
    expect(planStatusLine(licenceStatus({ plan: 'trial', trialDaysLeft: 1 }))).toBe(
      'Pro trial — 1 day left'
    )
    expect(planStatusLine(licenceStatus({ plan: 'pro' }))).toBe(
      'Pro — thank you for supporting Vocette'
    )
    expect(planStatusLine(licenceStatus({ plan: 'free' }))).toBe(
      'Free — everything you need, for good'
    )
  })

  it('says when a subscription has ended, or is waiting to be confirmed', () => {
    const licence = {
      displayKey: '****-E304DA',
      activatedAt: '2026-09-01T10:00:00.000Z',
      confirmedAt: '2026-09-01T10:00:00.000Z',
      graceDaysLeft: 0
    }
    expect(planStatusLine(licenceStatus({ plan: 'free', licence: { ...licence, standing: 'ended' } }))).toBe(
      'Free — your Pro subscription has ended'
    )
    expect(
      planStatusLine(licenceStatus({ plan: 'free', licence: { ...licence, standing: 'unconfirmed' } }))
    ).toBe('Pro is paused until your subscription is confirmed')
    // A trial still running says so, whatever an old subscription did.
    expect(
      planStatusLine(
        licenceStatus({ plan: 'trial', trialDaysLeft: 4, licence: { ...licence, standing: 'ended' } })
      )
    ).toBe('Pro trial — 4 days left')
  })
})

describe('the sidebar suffix', () => {
  it('appears during the trial only', () => {
    expect(trialBadge(licenceStatus({ plan: 'trial', trialDaysLeft: 23 }))).toBe('Trial · 23d')
    expect(trialBadge(licenceStatus({ plan: 'free' }))).toBeNull()
    expect(trialBadge(licenceStatus({ plan: 'pro' }))).toBeNull()
  })
})

describe('the Subscribe buttons', () => {
  it('carry the prices, or say each opens soon while it has no checkout', () => {
    expect(subscribeLabels(licenceStatus())).toEqual({
      monthly: 'Monthly — US$4.99 a month',
      yearly: 'Yearly — US$49 a year · two months free',
      monthlyWas: null,
      yearlyWas: null
    })
    expect(
      subscribeLabels(licenceStatus({ monthlyCheckoutAvailable: false, yearlyCheckoutAvailable: false }))
    ).toEqual({
      monthly: 'Monthly — opens soon',
      yearly: 'Yearly — opens soon',
      monthlyWas: null,
      yearlyWas: null
    })
  })

  it('carry the launch prices during the offer, with the normal ones to strike through', () => {
    expect(subscribeLabels(licenceStatus({ launchOffer: LAUNCH_OFFER }))).toEqual({
      monthly: 'Monthly — US$3.74 a month',
      yearly: 'Yearly — US$24.50 a year',
      monthlyWas: 'US$4.99',
      yearlyWas: 'US$49'
    })
    // A plan with no checkout yet says so, offer or not.
    expect(
      subscribeLabels(licenceStatus({ launchOffer: LAUNCH_OFFER, monthlyCheckoutAvailable: false }))
    ).toEqual({
      monthly: 'Monthly — opens soon',
      yearly: 'Yearly — US$24.50 a year',
      monthlyWas: null,
      yearlyWas: 'US$49'
    })
  })

  it('announce the offer only while it is open and a checkout can take it up', () => {
    expect(launchOfferLine(licenceStatus({ launchOffer: LAUNCH_OFFER }))).toBe(
      'Launch offer for the first 100 subscribers, until 31 December 2026: the yearly plan at ' +
        'half price forever, the monthly plan at 25% off forever.'
    )
    expect(launchOfferLine(licenceStatus({ launchOffer: null }))).toBe('')
    expect(
      launchOfferLine(
        licenceStatus({
          launchOffer: LAUNCH_OFFER,
          monthlyCheckoutAvailable: false,
          yearlyCheckoutAvailable: false
        })
      )
    ).toBe('')
  })

  it('say what one subscription covers, and that cancelling keeps what was paid for', () => {
    expect(plansNote(licenceStatus())).toBe(
      'One subscription covers up to 10 devices. Cancel any time; Pro stays on until the end of ' +
        'the period you have paid for.'
    )
  })
})

describe('the licence lines', () => {
  it('says what activating sends, and that the subscription is checked once a day', () => {
    expect(activationNote(licenceStatus({ deviceLabel: 'Vocette on Windows · 7F3A' }))).toBe(
      'Activating sends your key and a device label (“Vocette on Windows · 7F3A”) to Polar, our ' +
        'payment provider. While you are subscribed, Vocette asks Polar once a day whether the ' +
        'subscription is still active, and sends nothing else.'
    )
  })

  it('shows only the end of the key, and the date in words', () => {
    expect(keyEnding('****-E304DA')).toBe('E304DA')
    expect(keyEnding('ABCD')).toBe('ABCD')
    expect(keyEnding('****')).toBe('****')
    expect(longDate('2026-09-25T13:48:13.251Z')).toBe('25 September 2026')
    expect(longDate('not a date')).toBe('')
  })

  it('says how long ago the subscription was confirmed, in days', () => {
    const now = new Date(2026, 9, 5, 15, 0).getTime()
    expect(daysAgo(new Date(2026, 9, 5, 8, 0).toISOString(), now)).toBe('today')
    expect(daysAgo(new Date(2026, 9, 4, 23, 0).toISOString(), now)).toBe('yesterday')
    expect(daysAgo(new Date(2026, 8, 23, 9, 0).toISOString(), now)).toBe('12 days ago')
    expect(daysAgo('not a date', now)).toBe('')
  })

  it('describes the subscription on this PC, and what a missed check means', () => {
    const now = new Date(2026, 9, 5, 15, 0).getTime()
    const base = { displayKey: '****-E304DA', activatedAt: '2026-09-01T10:00:00.000Z' }
    expect(
      subscriptionLine(
        { ...base, standing: 'active', confirmedAt: new Date(2026, 9, 5, 9, 0).toISOString(), graceDaysLeft: 29 },
        now
      )
    ).toBe('Subscription active on this PC · key ending E304DA · confirmed today')
    expect(
      subscriptionLine(
        { ...base, standing: 'active', confirmedAt: new Date(2026, 8, 23, 9, 0).toISOString(), graceDaysLeft: 17 },
        now
      )
    ).toBe(
      'Subscription active on this PC · key ending E304DA · confirmed 12 days ago. Pro keeps ' +
        'working for 17 more days without a check.'
    )
    expect(
      subscriptionLine({ ...base, standing: 'ended', confirmedAt: base.activatedAt, graceDaysLeft: 0 }, now)
    ).toBe(
      'Your subscription has ended (key ending E304DA). Subscribe again and this key works ' +
        'again — press Check now once you have.'
    )
    expect(
      subscriptionLine({ ...base, standing: 'unconfirmed', confirmedAt: base.activatedAt, graceDaysLeft: 0 }, now)
    ).toBe(
      'Your subscription has not been confirmed for 30 days, so Pro is paused. Connect to the ' +
        'internet and press Check now.'
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
      'Your Pro trial has ended. Vocette keeps working as it did — AI polish and lists longer ' +
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
