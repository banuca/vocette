/**
 * What Vocette sells, and the limits Free and Pro differ by.
 *
 * Everyone gets Pro for the first 30 days. After that, anyone who has not
 * subscribed keeps a Free version that is genuinely good: dictation of any
 * length, on this PC or in the cloud, with cleanup, spoken corrections,
 * clipboard restore and history, is never limited. Pro is a monthly or yearly
 * subscription for power users — longer word lists, and AI polish — and
 * nothing is ever deleted when it lapses: a longer list keeps every line, and
 * only its first part is used.
 *
 * The empty strings are for the owner to fill in before release. While the
 * organisation id or the benefit ids are empty, purchases are "not
 * configured": the Pro page says subscriptions open soon and the licence field
 * is disabled. The main process can override the Polar values for sandbox
 * testing (`MURMUR_POLAR_API_BASE`, `MURMUR_POLAR_ORG_ID`,
 * `MURMUR_POLAR_BENEFIT_ID`, comma-separated for two); those overrides never
 * reach the renderer.
 */

export const PRODUCT_NAME = 'Vocette'
/** Shown on the two Subscribe buttons. They must match the Polar products. */
export const PRO_MONTHLY_PRICE_LABEL = 'US$4.99 a month'
export const PRO_YEARLY_PRICE_LABEL = 'US$49 a year'
/** Twelve monthly payments are US$59.88; the yearly plan saves a little over two months. */
export const PRO_YEARLY_SAVING_LABEL = 'two months free'
/** How many devices one subscription covers: the licence key's activation limit in Polar. */
export const PRO_DEVICES = 10
export const TRIAL_DAYS = 30

/**
 * The launch offer: the monthly plan at 25% off and the yearly plan at half
 * price, for as long as that subscription runs, for the first 100 subscribers
 * to each plan, until the end of 31 December 2026.
 *
 * Polar applies it. The two discounts are pinned to the checkout links, each
 * has a limit of 100 redemptions, and each ends at this same instant. The app
 * only shows the offer, and stops showing it at this instant by its own clock;
 * it cannot tell when the 100 places are gone, which is why the line says
 * "the first 100". An empty end date takes the offer away.
 */
export const LAUNCH_OFFER_ENDS_AT = '2027-01-01T00:00:00Z'
export const LAUNCH_OFFER_PLACES = 100
export const LAUNCH_MONTHLY_PRICE_LABEL = 'US$3.74 a month'
export const LAUNCH_YEARLY_PRICE_LABEL = 'US$24.50 a year'
/** The normal prices, struck through beside the launch ones. */
export const PRO_MONTHLY_PRICE = 'US$4.99'
export const PRO_YEARLY_PRICE = 'US$49'

/**
 * How long Pro keeps working without reaching Polar. A subscription is checked
 * at most once a day; a PC that is offline, or a Polar that does not answer,
 * costs nothing for this long after the last confirmation.
 */
export const SUBSCRIPTION_GRACE_DAYS = 30

export const FREE_VOCABULARY_TERMS = 50
export const PRO_VOCABULARY_TERMS = 500
export const FREE_REPLACEMENT_RULES = 20
export const PRO_REPLACEMENT_RULES = 200

/** Owner: the checkout link of the monthly product, `https://buy.polar.sh/polar_cl_…`. Empty disables it. */
export const CHECKOUT_URL_MONTHLY =
  'https://buy.polar.sh/polar_cl_AqgJRn1rgMJ06D64awrQjFmSKUWEnB3J5gD934gYOeD'
/** Owner: the checkout link of the yearly product. Empty disables it. */
export const CHECKOUT_URL_YEARLY =
  'https://buy.polar.sh/polar_cl_Nts3HO2r5iMwHTJRYbJWhEzAIyWTIc9Fwdzcg4HILVK'
/** Owner: the customer portal, `https://polar.sh/<slug>/portal`. Empty hides "Manage subscription". */
export const CUSTOMER_PORTAL_URL = 'https://polar.sh/vocette/portal'
export const POLAR_API_BASE = 'https://api.polar.sh'

/**
 * Owner: the GitHub repository whose published releases the update check reads,
 * as `owner/name`. It must be public, with releases published there, or every
 * check says no release was found.
 */
export const UPDATE_REPOSITORY = 'banuca/vocette'
/** Owner: Polar → Settings → Organization → Identifier. A public identifier, safe to ship. */
export const POLAR_ORGANIZATION_ID = '42817033-36a1-44d0-8596-febd6f20e293'
/**
 * Owner: the id of the Licence Keys benefit on the Pro products — one id when
 * both the monthly and the yearly product carry the same benefit (recommended:
 * switching plans then keeps the same key), two when each has its own.
 */
export const POLAR_PRO_BENEFIT_IDS: readonly string[] = ['8dd90d99-a5d5-4ba3-89d4-c301de309d28']
