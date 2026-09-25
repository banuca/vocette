# Brief 11 — Pro: 30-day trial, one-off licence, and the gates

Queue item 11 of `docs/launch-plan.md`. One commit. Evidence: `docs/research/licensing.md`
(Polar licence-key API, verified against the live sandbox and production endpoints).

## The owner's rule

The free version must be genuinely good. Everyone gets Pro free for 30 days; afterwards,
anyone who does not pay keeps a fully useful free version. Pro is for power users. No
nagging, no countdown banners, no degraded core dictation — ever.

## What the user sees

### Plans

| | Free (forever) | Pro (trial: first 30 days) |
|---|---|---|
| On-device and cloud dictation, any length, unlimited | ✓ | ✓ |
| Cleanup, spoken corrections, line breaks | ✓ | ✓ |
| Clipboard restore, paste last, retry, history | ✓ | ✓ |
| Vocabulary terms in use | 50 | 500 |
| Replacements and snippets in use | 20 | 200 |
| AI polish (feature 12) | — | ✓ |

Nothing is ever deleted when Pro lapses: a list longer than the free cap keeps all its
lines; only the first 50 terms / 20 rules are applied, and the note under each box says
so ("Using 50 of your 80 terms. Pro uses all of them.").

### A new page: **Pro** (sidebar item after Settings, icon: a star or sparkle — add to
`icons.ts` in the existing drawn style)

- Status line: "Pro trial — 23 days left" / "Pro — thank you for supporting Murmur" /
  "Free — everything you need, for good".
- "What Pro adds" (the right-hand column above) and "What stays free, forever" (the left),
  as two short lists.
- **Buy Pro** button with the price label from `product.ts` (e.g. "Buy Pro — US$29, once, for
  up to 3 PCs"); opens the checkout link in the browser via `app:open-external` with a new
  allow-listed target `'checkout'`. When `CHECKOUT_URL` is empty the button is disabled and
  says "Pro purchases open soon".
- **Licence key** field + **Activate**. Beneath it: "Activating sends your key and a device
  label (“Murmur on Windows · 7F3A”) to Polar, our payment provider, once. Murmur never
  checks again." (the four characters are this device's tag, below).
- When active: "Pro is active on this PC · key ending ABCD · activated 25 September 2026",
  **Release this PC** (deactivates, frees a device slot; confirm first), and "Manage your
  purchase" (opens `CUSTOMER_PORTAL_URL`, allow-listed target `'customer-portal'`, hidden if
  empty). If the release call fails for lack of network, offer "Remove from this PC anyway"
  (local only, the slot stays used — say so).
- Sidebar: the nav item shows a small muted suffix only during the trial ("Trial · 23d");
  nothing when Free or Pro.

### One notice, once

When the trial has ended and the app is opened, History shows a single dismissible card:
"Your Pro trial has ended. Murmur keeps working as it did — AI polish and lists longer than
50 terms or 20 rules are part of Pro." Buttons: **See Pro**, **Dismiss**. Dismissed
forever (`trialEndNoticeDismissed` setting). No other reminder anywhere.

## Design

### Constants — new `src/shared/product.ts`

```ts
export const PRODUCT_NAME = 'Murmur'
export const PRO_PRICE_LABEL = 'US$29, once, for up to 3 PCs'   // owner to confirm
export const TRIAL_DAYS = 30
export const FREE_VOCABULARY_TERMS = 50
export const PRO_VOCABULARY_TERMS = 500
export const FREE_REPLACEMENT_RULES = 20
export const PRO_REPLACEMENT_RULES = 200
export const CHECKOUT_URL = ''            // owner: https://buy.polar.sh/polar_cl_…
export const CUSTOMER_PORTAL_URL = ''     // owner: https://polar.sh/<slug>/portal
export const POLAR_API_BASE = 'https://api.polar.sh'
export const POLAR_ORGANIZATION_ID = ''   // owner: Settings → Organization → Identifier
export const POLAR_PRO_BENEFIT_ID = ''    // owner: the Licence Keys benefit id
```

Main-process-only overrides for sandbox testing: `MURMUR_POLAR_API_BASE`,
`MURMUR_POLAR_ORG_ID`, `MURMUR_POLAR_BENEFIT_ID` (read in main; never exposed to the
renderer). "Purchases configured" means organisation id and benefit id are both non-empty.

Vocabulary limits: raise `MAX_VOCABULARY_CHARS` to 20,000 and `MAX_VOCABULARY_TERMS` to
`PRO_VOCABULARY_TERMS`; keep the cloud request bounded as it is today (prompt budget) and
cap the `keywords[]` list at 100 terms (a new `MAX_KEYWORD_TERMS`). Replacements: the
parser's cap becomes `PRO_REPLACEMENT_RULES`.

### Entitlement — new pure `src/shared/entitlement.ts`

```ts
export type Plan = 'trial' | 'pro' | 'free'
export interface Entitlement { plan: Plan; pro: boolean; trialDaysLeft: number; trialEndsAt: string | null }
export function entitlementFor(input: { trialStartedAt: string | null; licensed: boolean; now: number }): Entitlement
```

Licensed → `pro`. Otherwise trial while `now < start + 30 days` (days left rounded up;
a clock set *before* the start counts as day 0 — never negative, never a crash); else free.
Unparseable `trialStartedAt` → treat as starting now.

### Settings store changes

- **First, convert `getPublic()` to an explicit allow-list** (roadmap hazard §1: it
  projects by deletion, so any new stored field would cross to the renderer). Build the
  `PublicSettings` object field by field; add a test that asserts the exact key set of
  `getPublic()` so a future field cannot leak silently.
- New stored fields (both paths, with tests): `trialStartedAt: string | null` (set to now
  and persisted by the store on first load when absent — existing users start their trial
  on first launch of this version), `trialEndNoticeDismissed: boolean`, `deviceTag: string`
  (4 upper-case hex characters, generated once), and `licence: StoredLicence | null` where
  `StoredLicence = { encryptedKey: string; keyStorage: 'encrypted' | 'plain'; activationId:
  string; benefitId: string; displayKey: string; activatedAt: string }`. The key is
  encrypted with `safeStorage` when storage is usable; otherwise stored plain with
  `keyStorage: 'plain'` (a licence key is an entitlement token, not a credential — note
  this in a comment and in SECURITY.md later). None of these are in `PublicSettings`.
- `trialEndNoticeDismissed` is settable through `SettingsUpdate`; the rest only through the
  licence functions below.

### Licence client — new `src/main/licence.ts`

Injectable `fetch` (production: Electron `net.fetch`) and config, unit-testable:

- `activate(key, { orgId, benefitId, apiBase, label, appVersion })`: trim; reject empty or
  > 200 chars locally. One `POST {apiBase}/v1/customer-portal/license-keys/activate` with
  JSON `{ key, organization_id, label, meta: { app_version } }`, headers only
  `Content-Type: application/json` — **no** `Authorization`, **no** `Polar-Version`
  (research §2.6). 15 s timeout. Accept only a 200 with `id`, `license_key.status ===
  'granted'`, `license_key.benefit_id === benefitId`, and `expires_at` null or future.
  Return `{ activationId, benefitId, displayKey }` — `display_key` from the response, or the
  last 4 characters. **Read nothing else from the response and never log it** (it contains
  the buyer's name, email and address).
- Error mapping (exact sentences, tested):
  - 403 "activation limit" → "This key is already active on its maximum number of PCs.
    Release it on another PC, or manage your devices from your purchase email."
  - 403 "no longer active" → "This licence key has been revoked or disabled."
  - 403 "expired" → "This licence key has expired."
  - 403 "does not support activations" → "This key cannot be activated in Murmur. Contact
    support."
  - 404 with `error: 'ResourceNotFound'` → "That licence key was not recognised. Check it
    and try again."
  - 404 without an `error` field → "This version of Murmur can no longer activate licences.
    Update Murmur and try again."
  - 422 → "That does not look like a Murmur licence key."
  - 429 → "Too many attempts. Wait a minute and try again."
  - benefit mismatch → "That key is for a different product."
  - network/timeout → "Could not reach Polar. Activation needs an internet connection
    once."
- `deactivate(key, activationId, config)`: `POST …/deactivate` `{ key, organization_id,
  activation_id }`; 204 or 404 both mean "released" (404: already gone); network failure is
  returned as a distinct result so the UI can offer "Remove from this PC anyway".

### Wiring

- `src/main/index.ts`: IPC `licence:status` → `{ plan, trialDaysLeft, trialEndsAt,
  licence: { displayKey, activatedAt } | null, purchasesConfigured, checkoutAvailable,
  portalAvailable, priceLabel, trialEndNoticeDue }`, `licence:activate(key)`,
  `licence:deactivate()`, `licence:remove-local()`; all `fromMain`-guarded; broadcast
  `licence:changed` after any change. Fix `app:info`'s missing `fromMain` guard in the same
  change (roadmap note). Preload wrappers.
- `workflowSettings()` gains `pro: boolean` and applies the caps: vocabulary terms
  `slice(0, pro ? PRO : FREE)`, replacement rules likewise.
- Settings page notes under Vocabulary and Replacements show the cap in force ("Using 50 of
  your 80 terms — Pro uses all of them" / "Pro trial: all 80 terms in use").
- The trial's end must not need the app to restart: recompute entitlement on each
  `workflowSettings()` call and on `licence:status`.

## Tests

`tests/entitlement.test.ts` (trial day math incl. clock skew, licensed, free);
`tests/licence.test.ts` (fake fetch: success; every error mapping; benefit mismatch; status
not granted; expired; no auth/version headers sent; response PII not returned; deactivate
204/404/network); `tests/settings-store.test.ts` (allow-list key set; trialStartedAt set
once and persisted; licence stored encrypted vs plain; not in getPublic);
controller/workflow cap tests (51st term not sent when free, sent when pro).

## Done when

`npm run typecheck && npx vitest run && npm run lint` pass. Do not commit.
