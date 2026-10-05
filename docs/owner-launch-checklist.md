# Launch checklist (owner)

Everything that only you can do before the first sale, in the order to do it. Each step
says where to click. Nothing here is done by the app or by Claude.

Status of the product itself: built and verified feature by feature on branch `launch`
(see `docs/launch-plan.md` §7); `main` has not moved. Pro is a subscription: US$5 a month
or US$50 a year. The guided hand test comes next.

## 1. Before anything is public

1. ~~Confirm you may sell it.~~ **Done** — ITU has confirmed (29 September 2026).
2. ~~Pick the name.~~ **Done** — **Vocette**; the code is renamed on `launch` (the profile
   and model folders keep the name `Murmur` on disk, on purpose).
3. **Register the domains now, before anything named Vocette is pushed or shown in
   public:** `vocette.com` and `vocette.app` (and `getvocette.com`; optionally `vocette.io`,
   `vocette.ai` and the typo `vosette.com`). All were unregistered on 25 September. The
   `launch` branch is only on this PC, so nothing public mentions Vocette yet.
4. **Trade mark:** ask an attorney for a clearance search on VOCETTE in classes 9 and 42
   (CH, EU, UK, US, including sound-alikes); if clear, file in Switzerland first, then
   the EU, UK and US through the Madrid system. See `docs/research/naming.md`.
5. **Rename the GitHub repository** from `murmur` to `vocette` when you publish
   (Settings → General → Repository name; GitHub redirects the old address). Then change
   `UPDATE_REPOSITORY` in `src/shared/product.ts` to `banuca/vocette`.
6. **Decide the copyright holder.** `LICENSE` says "Vocette contributors". For a product
   you sell, it should probably be your own name or your company's. Change the line in
   `LICENSE` and `copyright:` in `electron-builder.yml`.

## 2. Polar (payments and licence keys)

Polar is the merchant of record: it sells the Pro subscriptions, handles VAT, charges
renewals, and issues the licence keys the app activates and checks daily.

1. Sign up at **polar.sh** and create an organisation. Complete the payout details
   (Settings → Payouts) so money can reach you.
2. **The licence-key benefit:** Products → Benefits (`polar.sh/to/dashboard/products/benefits`)
   → **+ New Benefit** → Type **License Keys**.
   - Prefix: `VOCETTE`.
   - Expiry: **none** (a subscription's key follows the subscription by itself).
   - **Activation limit: 3**, and allow customers to deactivate devices themselves.
     Without an activation limit, activation in the app fails.
3. **The two products** — Polar has one product per billing interval:
   - Products → **New product** → **Subscription**, **monthly**, US$5 → name "Vocette Pro
     (monthly)" → Automated Benefits → attach the licence-key benefit.
   - The same again, **yearly**, US$50 → "Vocette Pro (yearly)" → attach **the same**
     benefit. One shared benefit means switching plans keeps the same key. (If Polar
     will not let one benefit sit on both, make one per product and list both ids in
     step 7.)
   - Never remove the benefit from a product later: that revokes its customers' keys.
   - Leave Polar's own trial off: the app already gives everyone 30 days of Pro, with
     no card.
   - Settings → Subscriptions (or Billing): choose the **grace period for failed
     payments** — 7 days recommended. Polar retries a failed renewal after 2, 5, 7 and 7
     days before ending a subscription.
4. **The EU withdrawal acknowledgement** (Polar's checkout does not collect it):
   Settings → **Custom Fields** → **Checkbox**, wording:
   *"I ask for Vocette Pro to be supplied immediately and I acknowledge that I lose my
   14-day right of withdrawal once the licence key is delivered."*
   Then on the product: Checkout Fields → add it → mark **Required**.
   *Have a lawyer with EU consumer-law experience look at this; see
   `docs/research/licensing.md` §7.*
5. **The refund policy** (`site/refund.html`): the first payment of a subscription is
   refundable within 30 days, no questions; later renewals are not, but cancelling stops
   the next one. Put the same sentences in both product descriptions. A refund revokes
   the key, and the app notices at its next daily check.
6. **The checkout links:** Products → **Checkout Links** → **New Link** → the monthly
   product; then another for the yearly one. Copy both URLs.
7. **The ids the app needs** — paste into `src/shared/product.ts`:
   - `CHECKOUT_URL_MONTHLY` and `CHECKOUT_URL_YEARLY` — the two links from step 6.
   - `CUSTOMER_PORTAL_URL` — `https://polar.sh/<your-org-slug>/portal` (customers cancel,
     switch plans and change cards there).
   - `POLAR_ORGANIZATION_ID` — Settings → **Organization** → **Identifier** (Copy).
   - `POLAR_PRO_BENEFIT_IDS` — the licence-key benefit's id, e.g. `['…']` (two ids if each
     product has its own), from the benefit's own page (where exactly Polar shows it has
     not been checked on screen; the API also lists it).
   - If you change the prices, change `PRO_MONTHLY_PRICE_LABEL` and
     `PRO_YEARLY_PRICE_LABEL` to match.
   Commit. Until these are filled in, the app says subscriptions open soon and the licence
   field is disabled.
8. **Test a purchase in Polar's sandbox first** (`sandbox.polar.sh`, same steps), with the
   app pointed at it: set `MURMUR_POLAR_API_BASE=https://sandbox-api.polar.sh`,
   `MURMUR_POLAR_ORG_ID` and `MURMUR_POLAR_BENEFIT_ID` to the sandbox values before
   launching. Subscribe with Stripe's test card, activate in the app, press **Check now**;
   then cancel in the sandbox and confirm the app drops to Free, at its next check, once
   the subscription has ended.

## 3. Website

1. **Domain:** buy the name's domain (e.g. `vocette.app`) at a registrar you trust.
2. **Hosting:** the site is in `site/`, published by the workflow in
   `.github/workflows/pages.yml`. Repository Settings → **Pages** → Source **GitHub
   Actions** → then **Custom domain** → your domain → **Enforce HTTPS**. At the registrar,
   add the DNS records GitHub shows. (Pages' "deploy from a branch" can only publish the
   root or `/docs`, which is why the workflow is there.)
3. Fill in the site's placeholders (search the `site/` files for `Owner:`): the download
   link, the checkout link, your support email (`support@example.com` today), the legal
   name and address the terms and privacy pages need, and the governing law. Pro promises
   **support by email**, so that address must be one you read.
4. Before publishing, the hand test must have confirmed the clipboard, paste and
   Alt + Shift + V claims on the page.

## 4. Code signing (removes the SmartScreen warning over time)

1. Recommended: **Azure Trusted Signing** — Azure portal → create a **Trusted Signing
   account** → identity validation (as an individual or organisation; takes days) →
   create a **certificate profile**.
2. Fill in `win.azureSignOptions` in `electron-builder.yml` (the commented block) and set
   `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` when building.
   Details: `docs/release.md` → Signing.

## 5. Release

1. After the hand test passes: merge `launch` into `main` and push.
2. Make the repository public if it is not (the app's update check reads its releases).
3. `npm run release:win` on the release commit (`docs/release.md`), run its smoke test.
4. GitHub → Releases → **Draft a new release** → tag `v0.5.0` → attach the `.exe`, the
   `.zip` and `SHA256SUMS.txt` → paste the changelog section → **Publish**.
5. Point the website's download button at the release.

## Open questions to settle (not blocking the build)

- The instant-capture trade-off: the microphone opens a tenth of a second into holding the
  shortcut, so the Windows microphone indicator can flash for other Ctrl + Shift
  shortcuts. On by default now; it can be switched off in Settings.
- Loading the speech engine at startup would make the very first dictation after launch
  fast too, at the cost of about 1 GB of memory while idle. Not done; yours to decide.
