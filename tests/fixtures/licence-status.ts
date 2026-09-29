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
    purchasesConfigured: true,
    checkoutAvailable: true,
    portalAvailable: true,
    priceLabel: 'US$29, once, for up to 3 PCs',
    trialEndNoticeDue: false,
    deviceLabel: 'Vocette on Windows · 7F3A',
    ...overrides
  }
}
