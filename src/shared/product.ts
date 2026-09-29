/**
 * What Vocette sells, and the limits Free and Pro differ by.
 *
 * Everyone gets Pro for the first 30 days. After that, anyone who has not
 * bought it keeps a Free version that is genuinely good: dictation of any
 * length, on this PC or in the cloud, with cleanup, spoken corrections,
 * clipboard restore and history, is never limited. Pro is for power users —
 * longer word lists, and AI polish — and nothing is ever deleted when it
 * lapses: a longer list keeps every line, and only its first part is used.
 *
 * The empty strings are for the owner to fill in before release. While the
 * organisation or benefit id is empty, purchases are "not configured": the Pro
 * page says purchases open soon and the licence field is disabled. The main
 * process can override the Polar values for sandbox testing
 * (`MURMUR_POLAR_API_BASE`, `MURMUR_POLAR_ORG_ID`, `MURMUR_POLAR_BENEFIT_ID`);
 * those overrides never reach the renderer.
 */

export const PRODUCT_NAME = 'Vocette'
/** Shown on the Buy button. Owner to confirm before release. */
export const PRO_PRICE_LABEL = 'US$29, once, for up to 3 PCs'
export const TRIAL_DAYS = 30

export const FREE_VOCABULARY_TERMS = 50
export const PRO_VOCABULARY_TERMS = 500
export const FREE_REPLACEMENT_RULES = 20
export const PRO_REPLACEMENT_RULES = 200

/** Owner: the Polar checkout link, `https://buy.polar.sh/polar_cl_…`. Empty disables Buy Pro. */
export const CHECKOUT_URL = ''
/** Owner: the customer portal, `https://polar.sh/<slug>/portal`. Empty hides "Manage your purchase". */
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
/** Owner: the id of the Licence Keys benefit attached to the Pro product. */
export const POLAR_PRO_BENEFIT_ID = ''
