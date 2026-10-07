import type { LicenceStatus } from '../../src/shared/types'

/** The launch offer as the main process describes it while it is open. */
export const LAUNCH_OFFER: NonNullable<LicenceStatus['launchOffer']> = {
  monthlyPriceLabel: 'US$3.74 a month',
  yearlyPriceLabel: 'US$24.50 a year',
  monthlyWas: 'US$4.99',
  yearlyWas: 'US$49',
  endsLabel: '31 December 2026',
  places: 100
}

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
    monthlyPriceLabel: 'US$4.99 a month',
    yearlyPriceLabel: 'US$49 a year',
    yearlySavingLabel: 'two months free',
    // No offer unless a test about it says so.
    launchOffer: null,
    devices: 10,
    trialEndNoticeDue: false,
    deviceLabel: 'Vocette on Windows · 7F3A',
    ...overrides
  }
}
