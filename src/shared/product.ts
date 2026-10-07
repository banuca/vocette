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
export const PRO_MONTHLY_PRICE_LABEL = 'US$5 a month'
export const PRO_YEARLY_PRICE_LABEL = 'US$50 a year'
export const PRO_YEARLY_SAVING_LABEL = 'two months free'
/** How many PCs one subscription covers: the licence key's activation limit in Polar. */
export const PRO_DEVICES = 3
export const TRIAL_DAYS = 30

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
export const CHECKOUT_URL_MONTHLY = ''
/** Owner: the checkout link of the yearly product. Empty disables it. */
export const CHECKOUT_URL_YEARLY = ''
/** Owner: the customer portal, `https://polar.sh/<slug>/portal`. Empty hides "Manage subscription". */
export const CUSTOMER_PORTAL_URL = ''
export const POLAR_API_BASE = 'https://api.polar.sh'

/**
 * Owner: the GitHub repository whose published releases the update check reads,
 * as `owner/name`. It must be public, with releases published there, or every
 * check says no release was found.
 */
export const UPDATE_REPOSITORY = 'banuca/murmur'
/** Owner: Polar → Settings → Organization → Identifier. A public identifier, safe to ship. */
export const POLAR_ORGANIZATION_ID = ''
/**
 * Owner: the id of the Licence Keys benefit on the Pro products — one id when
 * both the monthly and the yearly product carry the same benefit (recommended:
 * switching plans then keeps the same key), two when each has its own.
 */
export const POLAR_PRO_BENEFIT_IDS: readonly string[] = []
