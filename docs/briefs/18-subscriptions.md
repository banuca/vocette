# Brief 18 — Pro as a monthly or annual subscription

Owner decision, 29 September 2026: Pro is sold as a **monthly and an annual
subscription**, replacing the one-off licence (which never went on sale). Free and the
30-day local Pro trial stay exactly as they are.

## What Polar does (checked 29 Sep 2026 against polar.sh docs and polarsource/polar)

- **One product per billing interval.** "The billing cycle and recurring interval are
  locked in at creation… you create one product per pricing model." A monthly and a
  yearly plan are two products, shown side by side through checkout links.
  (polar.sh/docs/features/products)
- **Subscription-backed keys never expire; they follow the subscription**
  (`set_expiration=scope.get("subscription_id") is None` in
  `server/polar/benefit/strategies/license_keys/service.py`).
- **When the subscription ends, the key is revoked** (`key.mark_revoked()`), not deleted.
  Cancelling keeps benefits until the end of the paid period. A failed payment moves the
  subscription to `past_due`: Polar retries after 2, 5, 7 and 7 days, and the organisation
  chooses a grace period (none, 2, 7, 14 or 21 days) before benefits are revoked.
  (polar.sh/docs/features/subscriptions/failed-payments)
- **Resubscribing re-grants the same key**: `if regrant and key.status ==
  LicenseKeyStatus.revoked: key.mark_granted()`; the key string and its activations are
  kept (`server/polar/license_key/service.py`). So a returning subscriber's PCs need no
  new activation.
- **Validation** (`POST /v1/customer-portal/license-keys/validate`, no credentials) answers
  404 "License key is no longer active." for a revoked key, and 404 for an unknown or
  deactivated activation; each call records a validation on Polar's side. Polar's own
  advice is to validate "for each session".

Unverified: whether one licence-key benefit can be attached to both products (likely —
benefits are organisation-level). The app accepts a list of benefit ids either way.

## Design

1. **Plans and prices** in `src/shared/product.ts`: `PRO_MONTHLY_PRICE_LABEL`,
   `PRO_ANNUAL_PRICE_LABEL`, `CHECKOUT_URL_MONTHLY`, `CHECKOUT_URL_ANNUAL`,
   `POLAR_PRO_BENEFIT_IDS` (one or two ids). The one-off label and link go.
2. **Activation is unchanged** (one POST with the key and the device label, activation id
   stored), except that a key with an expiry is no longer refused for that reason alone.
3. **A subscription check** (new): `validate` with key, organisation id, activation id and
   benefit id. Runs a minute after startup and then at most once a day while Vocette runs,
   and on **Check now** on the Pro page. Nothing else is sent; the reply's customer data
   is discarded as today.
   - 200, key granted → **active**; `confirmedAt` = now.
   - 404 "no longer active" / revoked / disabled → **ended**: Pro goes off now. The key
     record is kept, so a resubscription restores Pro at the next check with nothing to
     re-enter.
   - 404 for the activation (released in the Polar portal) → the local licence is removed,
     and the Pro page says the PC was released.
   - No answer, 429, 5xx → nothing changes; the next check tries again.
4. **Offline grace**: Pro stays on for **30 days** after the last confirmation, then pauses
   until a check succeeds. (Owner decision; recommended 30.)
5. **Entitlement**: `pro` = trial, or licence active and confirmed within the grace period.
   Stored: `subscriptionState` (`active` | `ended` | `unknown`) and `confirmedAt`.
6. **Pro page**: the two plans with **Subscribe monthly** / **Subscribe yearly**; the
   licence key field as today; a status line — "Subscription active · confirmed today",
   "Your subscription has ended. Subscribe again and your key starts working again.",
   "Could not confirm your subscription for 12 days — Pro pauses after 30." — and
   **Manage subscription** (Polar's portal: cancel, switch plan, change card). No banners
   anywhere else; the sidebar stays quiet.
7. **Words everywhere**: README, SECURITY (the network ledger: the licence request is now
   a daily check while Pro is active), About's notice, the website (pricing, FAQ, terms:
   renews automatically, cancel any time, Pro until the end of the paid period; refunds),
   the owner checklist (two recurring products with the same benefit, the grace setting,
   two checkout links).

## Tests

Licence client: validate request shape and every outcome above. Entitlement: active,
ended, within and past the grace period, trial precedence. Scheduler: first check after a
minute, at most daily, Check now single-flight, no check without a licence. Pro page:
plans, status lines, buttons. Store: the new fields on both paths.
