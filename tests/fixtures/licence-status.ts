import type { LicenceStatus } from '../../src/shared/types'

/**
 * A licence status for page tests. Pro by default, so a page reads exactly as
 * it did before Free and Pro existed; a test about the plans says which one.
 */
export function licenceStatus(overrides: Partial<LicenceStatus> = {}): LicenceStatus {
  return {
    plan: 'pro',
    trialDaysLeft: 0,
    trialEndsAt: null,
    licence: null,
    checking: false,
    checkMessage: null,
    purchasesConfigured: true,
    monthlyCheckoutAvailable: true,
    yearlyCheckoutAvailable: true,
    portalAvailable: true,
    monthlyPriceLabel: 'US$9.99 a month',
    yearlyPriceLabel: 'US$99 a year',
    yearlySavingLabel: 'two months free',
    devices: 10,
    trialEndNoticeDue: false,
    deviceLabel: 'Vocette on Windows · 7F3A',
    ...overrides
  }
}
