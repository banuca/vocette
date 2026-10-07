# Murmur Pro licensing: Polar (and Paddle), checked against primary sources

Researched 25 September 2026 for a one-off "Pro" licence on the Windows Electron app. The design brief: a merchant of record; keys issued automatically; a 3-device limit; one network call at activation and offline for ever after; a 30-day local trial.

**How this was checked**
- Polar's live docs, fetched as raw markdown from `polar.sh/docs/...md`. `docs.polar.sh` now 301-redirects to `polar.sh/docs/...`.
- Polar's published OpenAPI specs for API versions **2026-04** (Current today) and **2026-10** (becomes Current on 1 October 2026).
- Polar's open-source code at `github.com/polarsource/polar` (`main`, commit `cfae1ba`, 25 Sep 2026).
- Polar's legal pages.
- Live probes of the public licence endpoints in sandbox and production, sent with dummy data and no credentials.
- Paddle: developer.paddle.com, paddle.com/pricing and Paddle's legal pages.
- EU law: the Directive 2011/83/EU text (mirrored on legislation.gov.uk, because EUR-Lex blocked automated fetches), Directive (EU) 2019/2161, and German BGB §§ 312f, 356 and 356a.

`https://polar.sh/pricing` returns **404**. Pricing now lives at `https://polar.sh/resources/pricing` and `https://polar.sh/docs/merchant-of-record/fees`.

---

## 0. Verdict

**Polar fits the brief, with conditions.** It is the only one of the two that needs no backend. Keys are issued automatically. `POST /v1/customer-portal/license-keys/activate` needs no credentials, enforces the device limit, and returns everything the app needs in one response. Nothing on the server forces the app to re-validate later.

Conditions and caveats the owner must accept or act on:

1. **API version removal (most important for "offline for ever").** Polar removes each API version about 9 months after it appears. Once removed, requests pinned to it return `404 {"detail":"Not Found"}`. An old app build pinned to a version would stop activating. The recommendation is to send **no** `Polar-Version` header, so the call uses Current, and to parse the response tolerantly (see §2.6).
2. **Fees are higher than the headline for European buyers.** New organisations (created on or after 27 May 2026) are on **Starter at 5% + 50¢**. Polar adds **+1.5% for non-US cards**, so a Swiss or EU buyer costs about **6.5% + 50¢**, charged on the VAT-inclusive total. Settlement is in USD.
3. **EU withdrawal-right gap.** Polar's checkout, Buyer Terms and customer portal do not capture the digital-content waiver (express consent plus acknowledgement). They also do not inform buyers of the right of withdrawal and offer no withdrawal button, which the EU has required since 19 June 2026. In practice every EU consumer can claim a full refund, and the offline licence keeps working afterwards. Mitigations are in §7. **A lawyer should check this.**
4. **The device limit is only enforced at activation.** An offline device never learns that it was deactivated in the portal, that the key was refunded, revoked or disabled, or that the key was rotated. With customer self-deactivation switched on, the "3 devices" limit is a soft limit.
5. **Seller onboarding.** Switzerland is supported for payouts (Stripe Connect Express, CHF bank account in the seller's own country). Expect KYC and a review of up to 14 days before the first payout, a 7-day settlement delay, and possibly a closer review under the acceptable use policy category "AI Content Generation tools (text, image, video, voice)".

**Paddle** (Paddle Billing) has **no native licence keys**. Using it would mean running a webhook server plus a key database, or paying a separate licensing service. That conflicts with "no server". Paddle is cheaper for European buyers (a flat 5% + 50¢) and handles the EU withdrawal rules itself. See §9.

---

## 1. Polar's "License Keys" benefit

Source: https://polar.sh/docs/features/benefits/license-keys, the OpenAPI schemas, and the server code.

### How keys are issued
- In the dashboard: Benefits (`https://polar.sh/to/dashboard/products/benefits`), then `+ New Benefit`, then Type = `License Keys`. Attach the benefit to a product: Products, then create a **one-time** product, then Automated Benefits. The products doc says one-time products "charge the customer once and grant access forever".
- Docs: "Once customers buy your product or subscribes to your tier, they will automatically receive a unique license key. It's easily accessible to them under their purchases page."
- The grant is asynchronous. The hosted confirmation page shows a "granting" state until the `benefit.granted` event arrives. Source: `clients/apps/web/src/components/Checkout/CheckoutBenefits.tsx`.
- Changes to a benefit spread to existing customers. The products doc says: "Add a benefit and existing customers get it automatically. Remove one and they lose access." **Removing the licence benefit from the product would revoke every key.**

### Configurable options
The fields below are the benefit `properties`, from OpenAPI schema `BenefitLicenseKeysCreateProperties`.

| Option | Field | Values | Notes |
|---|---|---|---|
| Prefix | `prefix` | string or null | Code: `f"{prefix.strip().upper()}-{uuid4().upper()}"`, so `MURMUR` gives `MURMUR-1C285B2D-6CE6-4BC7-B8BE-ADB6A7E304DA`. The docs write `MYAPP_<AUTO_GENERATED_UUID4>` with an underscore; the code uses a hyphen. With no prefix the key is the bare upper-case UUID4. |
| Expiry | `expires` = `{ "ttl": int>0, "timeframe": "year" or "month" or "day" }` or null | null = never expires | Counted from the time of grant: `now + relativedelta(...)`. For a perpetual Pro licence, leave it unset. |
| Activation limit | `activations` = `{ "limit": int>0, "enable_customer_admin": bool }` or null | e.g. `{limit: 3, enable_customer_admin: true}` | `enable_customer_admin` lets customers deactivate devices themselves in the portal. **Activation must be configured, or `/activate` returns 403 "does not support activations".** |
| Usage limit | `limit_usage` | int>0 or null | Metered usage, incremented by `increment_usage` on `/validate`. Not needed for Murmur. |

The feature bullets on the docs page read: "Brandable prefixes", "Automatic expiration after `N` days, months or years", "Limited number of user activations, e.g devices", "Custom validation conditions", "Usage quotas per license key", "Automatic revokation upon cancelled subscriptions".

Per-key admin (merchant side): `PATCH /v1/license-keys/{id}` accepts `status` (`granted`, `revoked` or `disabled`), `usage`, `limit_activations`, `limit_usage` and `expires_at`. The merchant can therefore raise one customer's device limit. Merchants can also deactivate a device with `POST /v1/license-keys/deactivate`, which needs an organisation access token (OAT).

Key statuses (enum `LicenseKeyStatus`): `granted`, `revoked`, `disabled`. Only `granted` counts as active (`is_active()` in `server/polar/models/license_key.py`). A refund of a one-time order revokes benefits by default ("This is selected by default"; refunds doc).

### What the customer sees
Where they see it: the Polar-hosted checkout confirmation page, and the customer portal at `https://polar.sh/<org-slug>/portal`. Checked against the UI strings in `clients/packages/i18n/src/locales/en.ts` and the component `LicenseKeyBenefitGrant.tsx`:
- the key in a field with a **Copy** button;
- **Status** (Granted, Revoked or Disabled), **Usage**, **Validations**, **Validated At** ("Never Validated" if never checked), **Expiry Date** ("No Expiry" if none);
- an **Activations** list, with deactivation when `enable_customer_admin` is on;
- **Rotate**, for keys in `granted` or `disabled` status. Docs: "Rotation generates a new key string on the same license key record. The previous key stops validating immediately. Status, usage, limits, expiry, and activations are preserved." The docs also say: "rotating a revoked key returns a `400` error".

---

## 2. The public (no-secret) licence API: exact spec

### 2.1 Common facts
- **Base URLs.** Production `https://api.polar.sh`; sandbox `https://sandbox-api.polar.sh`. The paths start with `/v1/...`. Source: the OpenAPI `servers` block and the API overview.
- **Auth: none.** The OpenAPI operations have no `security`, and the description reads: "This endpoint doesn't require authentication and can be safely used on a public client, like a desktop application or a mobile app. If you plan to validate a license key on a server, use the `/v1/license-keys/validate` endpoint instead."
  - **Verified live (25 Sep 2026).** A POST with no `Authorization` header reaches the handler and returns `404 {"error":"ResourceNotFound","detail":"Not found"}` for a dummy key, not a 401. This holds in both sandbox and production.
  - The only unauthenticated licence endpoints are these three. The `/v1/license-keys/*` equivalents need an OAT, and `/v1/customer-portal/license-keys/{id}` needs a customer session.
  - **Do not copy the SDK samples**: they construct the client with `accessToken: "polar_oat_xxx"`. Never ship an OAT in the app. The docs warn: "Never expose an OAT in client-side code". Use plain `fetch` with no token.
- **Headers.** `Content-Type: application/json`. `Polar-Version` is optional; see §2.6.
- **CORS (verified live).** The preflight returns `access-control-allow-origin: *` and allows `Content-Type` and `Polar-Version`. The Electron main process is not subject to CORS in any case.
- **Rate limit.**
  - Docs (https://polar.sh/docs/api-reference/2026-04/introduction): "Unauthenticated validation, activation, and deactivation endpoints are limited to **3 requests per second** in both environments. If you exceed the rate limit, you will receive a `429 Too Many Requests` response. The response will include a `Retry-After` header."
  - Code (`server/polar/rate_limit.py`): `Rule(second=3, block_time=60, zone="customer-license-key")`, counted **per client IP** for unauthenticated calls, with a **60-second block** once exceeded.
- **Request field limits.** `conditions` and `meta` each allow at most 50 pairs. Keys are 1–40 characters. Values are a string of 1–500 characters, an integer, a number or a boolean.
- **Key lookup is exact.** The query is `LicenseKey.key == key`, so it is case-sensitive. The app should trim what the user pastes. Generated keys are upper-case.

### 2.2 Activate: the one call Murmur needs
`POST https://api.polar.sh/v1/customer-portal/license-keys/activate`
(sandbox: `POST https://sandbox-api.polar.sh/v1/customer-portal/license-keys/activate`)

Request body (schema `LicenseKeyActivate`):

| Field | Type | Required | Meaning |
|---|---|---|---|
| `key` | string | yes | Licence key typed or pasted by the user |
| `organization_id` | UUID4 | yes | Your organisation ID (see §3) |
| `label` | string | yes | Name for this activation, shown to the customer in the portal (e.g. "Murmur on Windows") |
| `conditions` | object | no | Values that `/validate` must later match exactly. Not needed for the one-call design. |
| `meta` | object | no | Free metadata stored on the activation, e.g. `{"app_version":"0.4.0"}` |

Tip from the docs (OpenAPI `x-mint`): "You only need to use this endpoint if you have device **activations** enabled on the license key benefit. You then use this endpoint to reserve an allocation for a specific device. Store the unique activation ID from the response on the device and use it as extra validation in the /validate endpoint."

**200 response** (schema `LicenseKeyActivationCreated`, with `license_key` of type `GrantedLicenseKey`). The shape follows the 2026-04 and 2026-10 specs; the values are illustrative:
```json
{
  "id": "b6724bc8-7ad9-4ca0-b143-7c896fcbb6fe",
  "license_key_id": "508176f7-065a-4b5d-b524-4e9c8a11ed63",
  "label": "Murmur on Windows",
  "meta": { "app_version": "0.4.0" },
  "created_at": "2026-09-25T13:48:13.251621Z",
  "modified_at": null,
  "license_key": {
    "id": "508176f7-065a-4b5d-b524-4e9c8a11ed63",
    "created_at": "2026-09-20T08:40:34.769148Z",
    "modified_at": null,
    "organization_id": "fda84e25-7b55-4d67-916d-60ead04ff61f",
    "customer_id": "d910050c-be66-4ca0-b4cc-34fde514f227",
    "customer": { "id": "...", "email": "buyer@example.com", "email_verified": true, "name": "...",
                  "billing_name": "...", "billing_address": { "country": "CH", "...": "..." },
                  "tax_id": null, "locale": null, "type": "individual", "metadata": {},
                  "external_id": null, "organization_id": "...", "default_payment_method_id": null,
                  "deleted_at": null, "first_user_event_at": null, "avatar_url": null,
                  "created_at": "...", "modified_at": null },
    "member_id": null,
    "member": null,
    "benefit_id": "32a8eda4-56cf-4a94-8228-792d324a519e",
    "key": "MURMUR-1C285B2D-6CE6-4BC7-B8BE-ADB6A7E304DA",
    "display_key": "****-E304DA",
    "status": "granted",
    "limit_activations": 3,
    "usage": 0,
    "limit_usage": null,
    "validations": 0,
    "last_validated_at": null,
    "expires_at": null
  }
}
```
- `member_id` and `member` exist only in 2026-10 (seat-based products). Otherwise 2026-04 and 2026-10 are identical for these endpoints.
- In `GrantedLicenseKey`, `status` is the constant `"granted"`, because the server refuses inactive keys.
- The example response on the feature docs page is **outdated**: it shows `user_id` and no `customer`. The spec above is authoritative.
- **Privacy.** The public response carries the buyer's email, name, billing address and tax ID (`customer` is a required field). The app should discard it and never log the raw response. By the same token, anyone holding a key can read that buyer data.

**Errors.** The `detail` strings below were read from `server/polar/license_key/service.py`.

| HTTP | `error` | `detail` (exact) | Cause |
|---|---|---|---|
| 403 | `NotPermitted` | `License key activation limit already reached` | Already 3 live activations |
| 403 | `NotPermitted` | `License key is no longer active. This license key can not be activated.` | Status is revoked or disabled |
| 403 | `NotPermitted` | `License key has expired.` | Past `expires_at` |
| 403 | `NotPermitted` | `This license key does not support activations. Use the /validate endpoint instead to check license validity.` | The benefit has no activation limit configured |
| 404 | `ResourceNotFound` | `Not found` | No such key for this `organization_id`. **Verified live** with a dummy key. A sandbox key sent to production, or the reverse, should give the same result because the databases are isolated; that case was not tested with a real key. |
| 404 | *(none)*; body `{"detail":"Not Found"}`; no `polar-version` response header | | Unknown or removed `Polar-Version` (**verified live** with `2020-01`) |
| 422 | `RequestValidationError` | array of `{type, loc, msg, input}` | Missing or invalid field. **Verified live**: `{"error":"RequestValidationError","detail":[{"type":"missing","loc":["body","label"],"msg":"Field required",...}]}`. The spec calls this `HTTPValidationError {detail:[...]}` and omits the `error` field. |
| 429 | | | More than 3 requests per second from one IP; `Retry-After` header; 60-second block |

Spec wording for the 403: "License key is revoked, disabled, or expired, does not support activations, or has reached its activation limit. Use /validate for licenses without activations."

Behaviour from the source code that the docs do not state:
- **No de-duplication.** Every successful `/activate` creates a new activation, even with the same label or conditions. A reinstall on the same PC uses another slot unless the old activation is deactivated.
- The count is taken under a row lock (`with_for_update`), so concurrent calls cannot exceed the limit. GitHub issue #12027 fixed this race (closed 19 June 2026).

curl, as published in the docs (their multi-line example has no line continuations; corrected here for bash):
```bash
curl -X POST https://api.polar.sh/v1/customer-portal/license-keys/activate \
  -H "Content-Type: application/json" \
  -d '{
    "key": "1C285B2D-6CE6-4BC7-B8BE-ADB6A7E304DA",
    "organization_id": "fda84e25-7b55-4d67-916d-60ead04ff61f",
    "label": "hello",
    "conditions": { "major_version": 1 },
    "meta": { "ip": "84.19.145.194" }
  }'
```

### 2.3 Validate: not needed for the one-call design
`POST https://api.polar.sh/v1/customer-portal/license-keys/validate`
(sandbox: `POST https://sandbox-api.polar.sh/v1/customer-portal/license-keys/validate`)

Request body (schema `LicenseKeyValidate`):

| Field | Type | Required | Meaning |
|---|---|---|---|
| `key` | string | yes | |
| `organization_id` | UUID4 | yes | |
| `activation_id` | UUID4 or null | no | Docs: "required in case activations limit is enabled". **The server does not enforce this.** Without it, validation succeeds even on a key with a limit. |
| `benefit_id` | UUID4 or null | no | Rejects keys issued for another benefit |
| `customer_id` | UUID4 or null | no | |
| `increment_usage` | int ≥ 0 or null | no | |
| `conditions` | object | no | Must **exactly equal** the activation's conditions if that activation had any |

**200 response** (schema `ValidatedLicenseKey`): the same fields as `GrantedLicenseKey` above, plus `"activation": { id, license_key_id, label, meta, created_at, modified_at }` or `null`. Every call increments `validations` and sets `last_validated_at` on the server, so Polar and the seller can see when the app was used. Avoiding that is a privacy point in favour of the one-call design.

**Errors** (spec plus code):

| HTTP | `error` | `detail` |
|---|---|---|
| 400 | `BadRequest` | `License key only has {n} more usages.` |
| 404 | `ResourceNotFound` | `Not found` (unknown key, or activation not found or deactivated) |
| 404 | `ResourceNotFound` | `License key is no longer active.` |
| 404 | `ResourceNotFound` | `License key has expired.` |
| 404 | `ResourceNotFound` | `License key does not match required conditions` |
| 404 | `ResourceNotFound` | `License key does not match given benefit.` |
| 404 | `ResourceNotFound` | `License key does not match given user.` |
| 422 / 429 | | as for activate |

Spec wording for the 404: "License key not found, revoked, disabled, or expired, or the supplied activation is missing or does not match, or the conditions, benefit, or customer do not match."

Docs recommendation (not a requirement): "For each session of your premium app, library or API, we recommend you validate the users license key via the `/v1/customer-portal/license-keys/validate` endpoint."

curl (docs):
```bash
curl -X POST https://api.polar.sh/v1/customer-portal/license-keys/validate \
  -H "Content-Type: application/json" \
  -d '{
    "key": "1C285B2D-6CE6-4BC7-B8BE-ADB6A7E304DA",
    "organization_id": "fda84e25-7b55-4d67-916d-60ead04ff61f",
    "activation_id": "b6724bc8-7ad9-4ca0-b143-7c896fcbb6fe",
    "conditions": { "major_version": 1 },
    "increment_usage": 15
  }'
```

### 2.4 Deactivate: optional, user-initiated "release this device"
`POST https://api.polar.sh/v1/customer-portal/license-keys/deactivate`
(sandbox: `POST https://sandbox-api.polar.sh/v1/customer-portal/license-keys/deactivate`)

Request body (schema `LicenseKeyDeactivate`; all three fields required): `key` (string), `organization_id` (UUID4), `activation_id` (UUID4).

| HTTP | Body | Meaning |
|---|---|---|
| **204** | none | "License key activation deactivated." The row is soft-deleted and the slot freed. |
| 404 | `{"error":"ResourceNotFound","detail":"Not found"}` | "License key or activation not found, or activation does not belong to the license key." This also covers an activation already deactivated, and a key that was rotated, because the old key string no longer matches. |
| 422 / 429 | | as above |

There is no curl example in the docs. Equivalent:
```bash
curl -X POST https://api.polar.sh/v1/customer-portal/license-keys/deactivate \
  -H "Content-Type: application/json" \
  -d '{"key":"MURMUR-...","organization_id":"<ORG_UUID>","activation_id":"<ACTIVATION_UUID>"}'
```

### 2.5 Recommended Murmur flow (one call, then offline)
1. The user pastes the key. Trim it.
2. The main process makes **one** `POST .../activate` with `{key, organization_id, label: "Murmur on Windows", meta: {app_version}}`. Send no `Authorization` header and (see §2.6) no `Polar-Version` header.
3. On 200, accept only if all of these hold:
   - the response has `id`;
   - `license_key.status === "granted"`;
   - `license_key.benefit_id === <MURMUR_PRO_BENEFIT_ID>` (docs: "Be sure to validate their unique benefit_id");
   - `expires_at` is null or in the future.
4. Store locally only `{key, activation_id: id, benefit_id, activated_at}`. Drop `customer`.
5. Never call Polar again unless the user presses "Release this device", which calls `/deactivate`. That is a user action, not background traffic.
6. Map errors to messages:
   - 403 limit reached: "used on 3 devices; release one in your Polar portal";
   - 403 inactive or expired: "key revoked/expired";
   - 404 **with** `error: "ResourceNotFound"`: "key not recognised";
   - 404 **without** an `error` field: "licensing service changed; please update Murmur";
   - 429: wait for `Retry-After`;
   - network error: "needs internet once to activate".

### 2.6 API versioning: the one real threat to "works for ever"
Source: https://polar.sh/docs/api-reference/current/versioning and https://polar.sh/docs/changelog/api.

- "Polar releases a new API version during the first week of January, April, July, and October. At each release: 1. Deprecated is removed and no longer accepts requests. ..."
- "Each version is supported for approximately nine months: three months as Next, three months as Current, and three months as Deprecated."
- "If the header is omitted, Polar uses Current. A malformed, unknown, or removed version returns `404 Not Found`."
- "Pin a version in every production integration. If you don't, your requests use the Current version, which changes at each quarterly release."
- The changelog says 2026-10 "will become the Current version on October 1st".
- **Verified live.** With no header, the response header reads `polar-version: 2026-04`; 2026-10 is accepted; `2020-01` gives `404 {"detail":"Not Found"}`.

**Implication.** A pinned version would make old Murmur builds fail activation after about 6–9 months. Not pinning risks a future contract change. These endpoints have been stable: the only difference between 2026-04 and 2026-10 is the optional `member` fields.

**Recommendation.** Omit the header, depend on as few fields as possible (status code, `id`, `license_key.status`, `license_key.benefit_id`, `license_key.expires_at`), tell the two kinds of 404 apart, and re-test activation against live Polar at each release. The alternative is a thin redirect service the owner controls, which adds infrastructure and a privacy surface. Not recommended now.

---

## 3. `organization_id`: where it is and whether it is safe

- **Where.** Docs: "Replace with your organization ID here found in your settings." In the dashboard it is Settings (page title "Preferences"), section **Organization**, field **Identifier** ("Unique identifier for your organization"), with a Copy button. Source: `clients/apps/web/src/components/Settings/OrganizationProfileSettings.tsx`.
- **Safe to embed: yes.** It is a public identifier, not a secret:
  - The docs' own desktop-client examples embed it.
  - The endpoints are documented as safe on public clients.
  - The unauthenticated `GET /v1/customer-portal/organizations/{slug}` returns the organisation `id` to anyone (schema `CustomerOrganizationData`).
  - Its purpose, per the docs: "We require `organization_id` to be provided to avoid cases of Polar license keys being used across Polar organizations erroneously."
  - Security rests on the key itself (122 random bits from UUID4), the 3-requests-per-second limit per IP, and the activation limit.
- **Sandbox and production are separate organisations with different IDs.** The docs say "The sandbox environment is fully isolated—data, users, tokens, and organizations created there do not affect production", so a key from one will not be found in the other. That follows from the docs; it was not tested with a real key. The app needs a build-time pair of `(base URL, organization_id)` values plus the expected `benefit_id`.

---

## 4. Sandbox: testing without real money

Source: https://polar.sh/docs/integrate/sandbox

1. Go to **https://sandbox.polar.sh/start** (or click "Go to sandbox" in the organisation switcher). Create a **separate** user account and organisation. The docs note that the sandbox "allows you to create an unlimited number of account and organization".
2. Create the License Keys benefit (prefix, no expiry, activation limit 3, customer admin on) and a one-time product with a price, and attach the benefit.
3. Create a Checkout Link. The sandbox URL format, from `terraform/sandbox/environment.tf`, is `https://sandbox-api.polar.sh/v1/checkout-links/polar_cl_.../redirect`.
4. Pay with the Stripe test card **4242 4242 4242 4242**, any future expiry and any CVC ("You can perform test payments using Stripe's test card numbers").
5. Copy the key from the confirmation page or the sandbox portal. Then call `https://sandbox-api.polar.sh/v1/customer-portal/license-keys/activate` with the **sandbox** organisation ID.

Limitations and notes:
- Docs: "Customer-facing emails ... are only delivered to recipients who are members of your organization ... Sub-addressing aliases like `you+test@example.com` are accepted."
- Sandbox tokens and organisations are fully isolated from production.
- General sandbox API limit is 100 requests per minute; the licence endpoints are 3 per second as in production.

Zero-money test in **production**, from account-reviews: "Don't run test purchases with real card details ... set up a free product or a 100% discount code so no real money changes hands."

---

## 5. Checkout and how the buyer gets the key

### Checkout link
Source: https://polar.sh/docs/features/checkout/links

- Dashboard, then **Products → Checkout Links → New Link** (`https://polar.sh/to/dashboard/products/checkout-links`), then select the product. The result is a persistent URL.
- Production format: **`https://buy.polar.sh/polar_cl_<secret>`** (from `terraform/production/environment.tf`: `checkout_base_url = "https://buy.polar.sh/{client_secret}"`).
- "The link itself doesn't expire, and you can share it indefinitely." Each visit creates a new short-lived session: "Always share the Checkout Link URL itself, never the URL of a generated Checkout Session."
- The app can open it with `shell.openExternal(url)`. A website can use it as a plain link.
- Options:
  - Success URL (supports `checkout_id={CHECKOUT_ID}`); **leave it empty** so the buyer sees the key on Polar's confirmation page.
  - Return URL.
  - A preset discount, and "Allow discount codes".
  - Metadata.
- Query parameters: `customer_email`, `customer_name`, `discount_code`, `locale`, `theme`, `reference_id`, `utm_*`.

### How the buyer gets the key
1. **Immediately**, on the Polar-hosted confirmation page, provided no Success URL is set. It shows the key with Copy. Code path: `CheckoutConfirmation.tsx`, then `CheckoutBenefits`, then `LicenseKeyBenefitGrant`.
2. **Email.** Polar sends "Your {description} order confirmation". Body: "Thank you for purchasing ... Your invoice is attached". It has an **"Included benefits"** section listing benefit *names*, and an **"Access purchase"** button. The button links to `/{org}/portal?customer_session_token=...&id={order}&email=...`, which is pre-authenticated. **The key string itself is not in the email.** Sources: `server/emails/src/emails/order_confirmation.tsx`, `server/emails/src/components/Benefits.tsx`, and `send_confirmation_email` in `server/polar/order/service.py`.
3. **Customer portal** at `https://polar.sh/<org-slug>/portal`: "Customers authenticate by entering the email address they used to purchase or subscribe. Polar then emails them a one-time code". The portal "is always available ... and it can't be turned off" (customer portal FAQ).

---

## 6. Fees, payouts to Switzerland, restrictions, minimum price

### Fees
Sources: https://polar.sh/resources/pricing and https://polar.sh/docs/merchant-of-record/fees.

| Plan | Monthly | Per transaction |
|---|---|---|
| **Starter** (default for new orgs) | Free | **5% + 50¢** |
| Pro | $20 | 3.8% + 40¢ (break-even vs Starter "~$1,379 /mo in sales") |
| Growth | $100 | 3.6% + 35¢ |
| Scale | $400 | 3.4% + 30¢ |

- **The claim "Starter 5% + $0.50" is confirmed** for new organisations: "Organizations created on or after May 27, 2026 start on Starter (5% + 50¢)." Older organisations keep "Early Member" at 4% + 40¢.
- **Additional fee:** "**+1.5%** for international cards (non-US)". This applies to nearly all Swiss and EU buyers, so the effective rate is **6.5% + 50¢**.
- Polar's worked example applies fees to the total **including VAT**: a $30 product plus 25% VAT = $37.50, total fees on Starter $2.94.
- Rough seller take for a VAT-inclusive price P, before payout fees: ≈ P/(1+VAT) − (6.5% × P + $0.50). Example: €20 to Germany (19% VAT) gives net €16.81, minus fees of about €1.75, so about €15.
- Refunds: "the initial transaction fees are not refunded to you". Disputes cost "$15 per dispute".
- The Master Services Terms add costs the pricing page does not mention:
  - **§10.4:** "a Chargeback prevention fee of $25 USD" per early-warning alert, credited back if no chargeback follows.
  - **§10.5:** on a chargeback **or refund**, the seller reimburses the amount, plus associated fees, plus "a per-incident fee of up to $30 USD, as updated by Polar on notice".
  - Whether §10.5(iv) is charged on ordinary refunds in practice is **unverified**.
- **Startup Program** (https://polar.sh/startup-program): the Scale plan free for 12 months, at 3.40% + 30¢. "Early-stage startups building digital products: SaaS, AI, developer tools, and similar. We typically look for teams under 50 people who have raised less than $5M. Applications are reviewed case by case." A solo developer can apply; whether Murmur would be accepted is **unverified**.
- **Switching plans:** "You can switch between plans anytime, and your rate adjusts immediately." The Early Member rate is not available to new organisations.

### Payouts to a Swiss bank account
Sources: supported-countries, finance/accounts, finance/payouts, finance/balance, account-reviews.

- **Switzerland** is on the payout list. Payouts go through Stripe Connect Express, which Polar uses only for transfers: "all payments from customers are made to Polar (US)".
- Bank account: "Stripe Connect requires the bank account you connect to be in the **same country as the business** and to use that country's **local currency**". For a Geneva seller that means a **Swiss CHF account**.
  - "For individual accounts, yes" to using a personal bank account. Business accounts need a business bank account.
  - Wise, Payoneer and Revolut "do not satisfy Stripe's verification" in most cases.
  - Whether Stripe offers the individual business type for Switzerland: Polar's docs point to Stripe's verification-requirements page. **Not checked.**
- Onboarding steps: Finance → Account, then "Submit for approval", then identity verification ("passport, ID card, or driver's license along with a selfie" via Stripe Identity), then connect the payout account.
  - "Initial reviews can take **up to 14 days**".
  - "Build first, submit second ... have a live website pointing to it."
  - Reviewers may ask for "a 100% discount code by email" or a video of the unpaid-to-paid flow.
- Settlement delay: "**7-day settlement delay** ... applies by default to organizations created on or after May 12, 2026".
- Minimum payout for CHF: **$15** (USD equivalent). Payouts are manual, "processed in batches 24 hours after initiation" and "typically take 4-7 business days".
- Stripe payout fees: "$2 per month in which you have at least one active payout", "0.25% + $0.25 per payout", and "Cross-border fees (currency conversion): 0.25% within the EU, up to 1% elsewhere". Which rate applies to Switzerland is not stated.
- The balance is kept in **USD**; foreign-currency sales are converted at transaction time.
- For accounting, Polar provides a "reverse invoice" per payout. The MSA (§4.3) says Polar collects tax forms such as W-8/W-9.
- Dormant accounts (MSA §16): "If you have no sales of any Product for a period of six (6) consecutive months, Polar reserves the right to deactivate your Supplier Account."

### Restrictions on selling software licences
Sources: https://polar.sh/legal/acceptable-use-policy (effective 25 Mar 2026) and the account-reviews doc.

- **Allowed:** "Software & SaaS". The policy also says: "acceptable services are digital goods, software, or services that can be fulfilled by (1) Polar on your behalf (License Keys, File Downloads, ...)".
- **Prohibited, but not relevant here:** "Reselling software licenses without authorization".
- **Possible closer review:** under "Restricted businesses that require closer review ... may not be accepted", the list includes "**AI Content Generation tools (text, image, video, voice)**". Murmur is speech-to-text through the user's own OpenAI key. How Polar classifies it is **unverified**; describe it clearly in the review submission.
- MSA §11.1(v): "you will not use the Services to facilitate the sale of Products on websites or applications other than the Supplier URL(s)". Declare the website, and the app, in the review.
- Chargebacks: accounts are held to a "**0.4% chargeback rate**". Escalation runs from refunds, to payout holds, to pausing payments, to blocking the account.
- Customer support: "When we include you in a customer support thread, we expect a response within **48 hours**."

### Minimum price and currencies
- The OpenAPI `price_amount` description gives the minimums: **USD 0.50, EUR 0.50, CHF 0.50**, GBP 0.40.
- Prices can be set in CHF, EUR and others ("130+ currencies"). A price in the organisation's default currency is required. The currency is picked by the buyer's geolocation.
- Tax display defaults to "Location-based": prices are VAT-**inclusive** for the EU and CH, and exclusive for the US, Canada and India.

---

## 7. EU consumer law: the 14-day right of withdrawal for digital content

### The law
- Directive 2011/83/EU, Art. 16(m), as replaced by Directive (EU) 2019/2161 Art. 4(12). The exception applies only to "contracts for the supply of digital content which is not supplied on a tangible medium if the performance has begun and, if the contract places the consumer under an obligation to pay, where:
  - (i) the consumer has provided prior express consent to begin the performance during the right of withdrawal period;
  - (ii) the consumer has provided acknowledgement that he thereby loses his right of withdrawal; and
  - (iii) the trader has provided confirmation in accordance with Article 7(2) or Article 8(7)."
- Art. 8(7): confirmation "on a durable medium ... That confirmation shall include: ... (b) where applicable, the confirmation of the consumer's prior express consent and acknowledgment in accordance with point (m) of Article 16."
- Art. 14(4)(b): "The consumer shall bear no cost for: ... the supply, in full or in part, of digital content ... where: (i) the consumer has not given his prior express consent ...; (ii) the consumer has not acknowledged that he loses his right of withdrawal ...; or (iii) the trader has failed to provide confirmation". In short: missing consent means a **full refund even after use**.
- Art. 10(1): "If the trader has not provided the consumer with the information on the right of withdrawal ... the withdrawal period shall expire 12 months from the end of the initial withdrawal period".
- After a withdrawal:
  - Art. 13(8) (2019/2161): "the trader may prevent any further use of the digital content";
  - Art. 14(2a): "the consumer shall refrain from using the digital content".
  - An offline Murmur cannot enforce this technically.
- German transposition: BGB § 356(6) (the four conditions, including (d) "der Unternehmer dem Verbraucher eine Bestätigung gemäß § 312f zur Verfügung gestellt hat") and § 312f(3) (the confirmation must record the consent and the acknowledgement).
- **New since 19 June 2026: the withdrawal function.** Directive (EU) 2023/2673 adds Art. 11a to the CRD, a withdrawal button for any distance contract concluded online. In Germany this is **BGB § 356a**: a function labelled "Vertrag widerrufen" that is "während des Laufs der Widerrufsfrist ... ständig verfügbar", followed by a "Widerruf bestätigen" confirmation step and an acknowledgement of receipt on a durable medium.
  - The EUR-Lex text could not be fetched (bot protection). The German text was read at gesetze-im-internet.de.
  - The June 2026 date comes from law-firm summaries (William Fry, Loyens & Loeff).

### What Polar does (checked 25 Sep 2026)
- **Checkout.** The one-time mandate text next to the pay button reads: 'By clicking "{buttonLabel}," you authorize Polar Software, Inc., our online reseller and merchant of record, to charge your selected payment method the amount shown above, and agree to the {buyerTermsLink}. This is a one-time charge.' Source: `clients/packages/i18n/src/locales/en.ts` and `MandateText.tsx`.
  - **There is no consent to immediate supply and no acknowledgement of losing the right of withdrawal.**
- **Buyer Terms** (https://polar.sh/legal/checkout-buyer-terms, last updated 25 March 2026):
  - They **do not mention a right of withdrawal at all.**
  - Polar is the seller: "Polar acts as merchant of record and authorized reseller ... You purchase the Product from Polar".
  - Refund clause: "Refunds are evaluated consistent with applicable law, the applicable refund policy and the card network rules. This Agreement does not limit any non-waivable consumer rights or remedies. Polar may deny a refund where we reasonably determine fraud, abuse, misuse or non-compliance with the applicable refund policy; however, we will not restrict your rights to pursue chargebacks as permitted by your card issuer."
- **Withdrawal button.** No match in Polar's code for a withdrawal function: searches for "withdraw from contract", "withdrawal function", "Vertrag widerrufen" and similar found nothing. The German locale's only "Widerrufen" is the licence status "Revoked".
  - Polar's docs contain no page on EU consumer withdrawal (searched llms-full.txt).
- **Polar's own refund powers:**
  - MSA §10.2: Polar may refund if the "Buyer requests a refund within ten (10) days of the date of a one-off Transaction ... AND Polar determines, in its sole discretion, that a refund is in the best interest", or if it is "required by any applicable law".
  - Refunds doc: "Polar reserves the right to issue refunds within 60 days of purchase, at its own discretion, in order to prevent chargebacks ... This applies even if you have a 'no refunds' policy".
- **Who carries the cost.** Polar is legally the trader, so the duties above are Polar's. The money flows back to the seller, though: MSA §10.5 means the seller reimburses refunds, and the transaction fee stays deducted.

### Answer to question 7
Polar's checkout does **not** collect the consumer's express consent or waiver. The seller has to cover the gap. Options inside Polar (unverified legally; this is a reading of the texts, not legal advice):
1. **A required checkbox Custom Field** on the Pro product: Settings → Custom Fields, then Checkbox, then add it to the product's Checkout Fields and mark it **Required**. The docs say: "If you make a **checkbox** field **required**, customers will have to check the box before submitting the checkout. Very useful for terms acceptance!" Suggested wording: "I ask for Murmur Pro to be supplied immediately and I acknowledge that I lose my 14-day right of withdrawal once the licence key is delivered." The value is stored on the Order (`custom_field_data`).
2. **A durable-medium confirmation.** Polar's order email does not echo custom fields. One workaround, **untested**: add a **Custom** benefit to the product whose **note** restates the consent and acknowledgement. The order email renders custom-benefit notes: `type === 'custom' && properties.note` in `Benefits.tsx`.
3. **The simplest risk control.** Publish a plain policy on the website and in the product description: a 14-day no-questions refund, and how to ask for it (email, or Polar support). With a 30-day local trial first, abuse should be low. Accept that refunded users keep Pro offline.
4. **The withdrawal button cannot be built by the seller inside Polar's checkout or portal.** Ask Polar support about their Art. 11a / § 356a plan. Get a short legal check from a Swiss lawyer with EU consumer-law experience.

**Switzerland:** the federal SME portal says "Swiss law does not provide for any withdrawal period or other right of return once the order has been placed" (https://www.kmu.admin.ch/en/statutory-obligations-swiss-and-european-e-commerce-laws). The only Swiss revocation right, CO Art. 40a ff., covers doorstep and telephone sales.

---

## 8. What could make Polar a bad fit

| # | Issue | Severity for Murmur | Evidence / mitigation |
|---|---|---|---|
| 1 | API versions removed after about 9 months; pinned calls then return 404 | **High** | §2.6. Omit `Polar-Version`, parse tolerantly, tell the two 404s apart, re-test each release. |
| 2 | Rate limit of 3 requests per second per IP with a 60-second block | Low | Irrelevant for one call per device. Handle 429 and `Retry-After`; never retry in a loop. |
| 3 | Periodic re-validation required? | **None** | Only a docs *recommendation*. The server never forces it. `/validate` even works without `activation_id`. |
| 4 | Device limit is soft | Medium | No de-duplication, so a reinstall uses a slot. A portal deactivation frees a slot while the offline device keeps working. **Owner decides** `enable_customer_admin`: on is friendlier; off is stricter but means more support email. An in-app "Release this device" calling `/deactivate` helps either way. |
| 5 | Refunds, chargebacks, Polar's proactive refunds, `disabled`/`revoked` status, and rotation are all invisible offline | Medium (accepted by design) | Inherent in "one call". Murmur is MIT-licensed, so the check is honour-based anyway; signed tokens would not add much. |
| 6 | No signed or offline-verifiable licence token | Low | The responses carry no signature, so local state is trusted. It does not matter for an open-source app. |
| 7 | Buyer PII in the public activation response | Medium (privacy promise) | `license_key.customer` includes email, name, billing address and tax ID. Discard it, never log it, and state in the privacy notice what activation sends (key, label, meta, IP) to Polar (US). |
| 8 | Dependence on the vendor and the account | Medium | MSA §18.3(i): on termination Polar "will disable access to any technology (including APIs)". The dormant rule (6 months), and chargebacks above 0.4%, can lead to holds or suspension. Existing activations are unaffected; **new buyers could not activate**. Keys can be exported with `GET /v1/license-keys/` (OAT); Polar has a "Migrate Away from Polar" doc. |
| 9 | Requirements for a Swiss seller | Low–Medium | Supported. Needs KYC, a CHF bank account in the seller's own name, a review of up to 14 days, a live website, and possibly a closer look under the "AI ... voice" category. |
| 10 | EU withdrawal-law gap | Medium | §7. |
| 11 | Fees | Medium | 6.5% + 50¢ for non-US cards, on the VAT-inclusive total; USD settlement plus FX plus Stripe payout fees; MSA refund and chargeback incident fees. |
| 12 | Removing the licence benefit from the product revokes every key | Low (footgun) | "Remove one and they lose access." Offline devices are unaffected, but the portal shows "Revoked" and new activations fail. |
| 13 | Docs drift | Low | The docs' response example shows `user_id` (outdated; the spec has `customer_id` and `customer`). The docs' prefix example uses `_`, the code uses `-`. The docs call `activation_id` "required" on validate, but it is not enforced. The SDK samples use an OAT for public endpoints. Build against the OpenAPI spec and the observed behaviour. |
| 14 | Swiss VAT | Unknown | Polar claims global merchant-of-record liability ("registered in jurisdictions around the world"). Its public docs do not say whether it is registered for Swiss VAT. The seller's own Swiss VAT and income-tax position is a question for a fiduciary. |

Not a problem:
- a 30-day local trial (Polar trials apply only to subscriptions, so the local trial is the right design);
- Windows/Electron (plain HTTPS POST);
- CORS (open).

---

## 9. Paddle, briefly

- **No native licence keys in Paddle Billing.** Paddle's docs (https://developer.paddle.com/llms.txt) compare the two platforms on product fulfilment:
  - Classic: "Licence keys and product downloads handled by Paddle";
  - **Billing: "Build your own workflows using transaction webhooks".**
- Only Billing is available to new sellers: "Anyone who signed up for Paddle after 2023-08-08 has Paddle Billing. New signups for Paddle Classic aren't allowed." Also: "Desktop SDKs aren't available."
- **The usual pattern.** From https://developer.paddle.com/get-started/how-paddle-works/digital-products: "Paddle sends a `transaction.completed` webhook. Your webhook handler grants access, sends a license key, or unlocks the download."
  - So you host a webhook endpoint and a key store, or pay a third-party licensing service; Keygen, Cryptlex and LicenseSpring are common examples (not researched here).
  - You email or display the key yourself.
  - The app activates against *your* service.
  - **That is a server Murmur does not have.**
- **Fees** (https://www.paddle.com/pricing): "5% + 50¢ per Checkout transaction", with "No migration fees, monthly fees, or hidden extras". The comparison table presents international cards as included. "If you're selling products under $10 ... contact us for custom pricing".
- **EU consumer law is handled by Paddle.**
  - Buyer Terms §15 (31 March 2026): "You have the right to withdraw from the Agreement for any reason within 14 days ... unless during that 14-day period, you started downloading, streaming, using or benefiting from the Product, when during your Transaction you agreed for us to make the Product available for your use before the end of that 14-day period."
  - Refund Policy 2.2.4: "The right to withdraw does not apply to the supply of digital content Products that have started to be downloaded, streamed or otherwise used, when you have given express consent to waive your withdrawal rights."
  - Refund Policy 3.1.1: "An online withdrawal button is available in the Paddle Customer Portal".

| | Polar | Paddle Billing |
|---|---|---|
| Licence keys | Built in, with a public activate/validate/deactivate API | None; build your own or buy a service |
| Server needed | No | Yes (webhook plus key store) |
| Fee for an EU or Swiss buyer | 5% + 50¢ **+ 1.5%** (Starter) | 5% + 50¢ (all-in) |
| EU withdrawal consent, button | Not provided | Provided |
| Payout | Stripe Connect Express, USD balance, CHF bank account | Not researched |

**Why Polar was chosen:** it is the only one that meets "keys issued automatically, device limit, one call, no server". Its costs are about 1.5 percentage points more per European sale and EU-withdrawal compliance work that Paddle would otherwise do.

---

## 10. What was verified and what was not

**Verified live** (25 Sep 2026, dummy data, no credentials):
- sandbox and production `/validate` and `/activate` accept unauthenticated requests (404 for an unknown key);
- the real 422 body shape;
- no version header means `2026-04`; `2026-10` is accepted; an unknown version gives `404 {"detail":"Not Found"}`;
- CORS allows `*`.

**Verified from Polar's source** (`main` @ `cfae1ba`):
- validate, activate and deactivate logic and error strings;
- no de-duplication; `activation_id` not enforced on validate;
- key format;
- rate-limit rule (per IP, 60-second block);
- order email contents (no key string, pre-authenticated portal link);
- checkout mandate text;
- no withdrawal function;
- where the organisation ID is shown;
- checkout link URL formats.

**Verified from docs and legal pages:** everything quoted above.

**Not verified:**
- A real end-to-end sandbox purchase followed by activation. This needs a Polar sandbox account, which is the owner's action.
- Whether MSA §10.5(iv) incident fees are charged on refunds.
- Polar's Swiss VAT registration.
- The Stripe cross-border payout fee for Switzerland.
- Whether Stripe Connect Express offers "individual" for Switzerland.
- How Polar's review classifies a dictation app.
- Acceptance into the Startup Program.
- The EUR-Lex text of Directive 2023/2673 (used § 356a BGB plus secondary summaries instead).
- Paddle's payout terms and seller onboarding for Switzerland.

**Decisions for the owner** (with a recommendation for each):
1. `enable_customer_admin`: recommend **on**, plus an in-app "Release this device".
2. Version header: recommend **omit** it.
3. EU policy: recommend a **14-day no-questions refund**, the **required consent checkbox**, and a quick legal check.
4. Price point and plan: stay on **Starter** until about $1.4k per month in sales; optionally apply to the Startup Program.

---

## Sources

**Polar docs**
- https://polar.sh/docs/features/benefits/license-keys
- https://polar.sh/docs/api-reference/2026-04/customer_portal/activate-license-key
- https://polar.sh/docs/api-reference/2026-04/customer_portal/validate-license-key
- https://polar.sh/docs/api-reference/2026-04/customer_portal/deactivate-license-key
- the matching `/2026-10/` pages
- https://polar.sh/docs/api-reference/2026-04/introduction (base URLs, auth, rate limits)
- https://polar.sh/docs/api-reference/current/versioning
- https://polar.sh/docs/changelog/api
- https://polar.sh/docs/openapi/2026-04.openapi.json and https://polar.sh/docs/openapi/2026-10.openapi.json
- https://polar.sh/docs/integrate/sandbox
- https://polar.sh/docs/features/checkout/links
- https://polar.sh/docs/features/customer-portal/introduction
- https://polar.sh/docs/features/customer-portal/navigate-customers
- https://polar.sh/docs/features/custom-fields
- https://polar.sh/docs/features/products
- https://polar.sh/docs/features/refunds
- https://polar.sh/docs/features/tax-inclusive-pricing
- https://polar.sh/docs/merchant-of-record/fees
- https://polar.sh/docs/merchant-of-record/introduction
- https://polar.sh/docs/merchant-of-record/supported-countries
- https://polar.sh/docs/merchant-of-record/account-reviews
- https://polar.sh/docs/merchant-of-record/acceptable-use/introduction
- https://polar.sh/docs/features/finance/accounts
- https://polar.sh/docs/features/finance/payouts
- https://polar.sh/docs/features/finance/balance
- https://polar.sh/docs/llms.txt

**Polar web and legal**
- https://polar.sh/resources/pricing
- https://polar.sh/startup-program
- https://polar.sh/legal/checkout-buyer-terms
- https://polar.sh/legal/master-services-terms
- https://polar.sh/legal/acceptable-use-policy

**Polar source** (https://github.com/polarsource/polar, `main` @ `cfae1ba`)
- `server/polar/license_key/service.py`
- `server/polar/license_key/schemas.py`
- `server/polar/license_key/repository.py`
- `server/polar/models/license_key.py`
- `server/polar/customer_portal/endpoints/license_keys.py`
- `server/polar/benefit/strategies/license_keys/properties.py`
- `server/polar/rate_limit.py`
- `server/polar/order/service.py`
- `server/emails/src/emails/order_confirmation.tsx`
- `server/emails/src/components/Benefits.tsx`
- `clients/packages/checkout/src/components/MandateText.tsx`
- `clients/packages/i18n/src/locales/en.ts` and `de.ts`
- `clients/apps/web/src/components/Checkout/CheckoutConfirmation.tsx`
- `clients/apps/web/src/components/Checkout/CheckoutBenefits.tsx`
- `clients/apps/web/src/components/Benefit/LicenseKeys/LicenseKeyBenefitGrant.tsx`
- `clients/apps/web/src/components/Settings/OrganizationProfileSettings.tsx`
- `terraform/production/environment.tf` and `terraform/sandbox/environment.tf`
- `docs/snippets/api-reference/versioning.mdx`
- GitHub issue #12027

**Law**
- https://www.legislation.gov.uk/eudr/2011/83/article/8
- https://www.legislation.gov.uk/eudr/2011/83/article/10
- https://www.legislation.gov.uk/eudr/2011/83/article/14
- https://www.legislation.gov.uk/eudr/2019/2161/article/4
- https://www.gesetze-im-internet.de/bgb/__356.html
- https://www.gesetze-im-internet.de/bgb/__312f.html
- https://www.gesetze-im-internet.de/bgb/__356a.html
- https://europa.eu/youreurope/citizens/consumers/shopping/returns/index_en.htm
- https://www.kmu.admin.ch/en/statutory-obligations-swiss-and-european-e-commerce-laws
- Secondary sources on Directive 2023/2673 (the 19 June 2026 date):
  - https://www.williamfry.com/knowledge/world-consumer-rights-day-part-3-mandatory-withdrawal-button-coming-june-2026/
  - https://www.loyensloeff.com/insights/news--events/news/new-eu-rules-on-withdrawing-from-online-contracts/

**Paddle**
- https://developer.paddle.com/llms.txt
- https://developer.paddle.com/get-started/how-paddle-works/digital-products
- https://www.paddle.com/pricing
- https://www.paddle.com/legal/buyer-terms (redirect target of /legal/checkout-buyer-terms)
- https://www.paddle.com/legal/refund-policy
