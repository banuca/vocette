# Launch checklist (owner)

Everything that only you can do before the first sale, in the order to do it. Each step
says where to click. Nothing here is done by the app or by Claude.

Status of the product itself: built and verified feature by feature on branch `launch`
(see `docs/launch-plan.md` §7); `main` has not moved. The guided hand test comes first.

## 1. Before anything is public

1. **Confirm you may sell it.** You work at ITU. Check your employment terms (or ask HR /
   legal) that a personal side project built in your own time, on your own equipment, is
   yours to sell. Get the answer in writing. *This comes before everything else.*
2. **Pick the name.** Shortlist in `docs/research/naming.md` (recommended: **Vocette**;
   runner-up **Quietword**). Before choosing, search the trademark registers for your
   markets (Swiss IGE Swissreg, EUIPO eSearch, USPTO) and check the domain is free.
3. **Rename the product** once chosen, on a clean tree:
   `node scripts/rename-product.mjs "Vocette" app.vocette --dry-run` (read the list), then
   the same without `--dry-run`, then `npm test`, then commit. The profile and model
   folders keep their current names on purpose.
4. **Decide the price.** Currently `US$29, once, for up to 3 PCs`
   (`PRO_PRICE_LABEL` in `src/shared/product.ts`; the price itself is set in Polar).
5. **Decide the copyright holder.** `LICENSE` says "Murmur contributors". For a product you
   sell, it should probably be your own name or your company's. Change the line in
   `LICENSE` and `copyright:` in `electron-builder.yml`.

## 2. Polar (payments and licence keys)

Polar is the merchant of record: it sells Pro to the buyer, handles VAT, and issues the
licence keys the app activates.

1. Sign up at **polar.sh** and create an organisation. Complete the payout details
   (Settings → Payouts) so money can reach you.
2. **The licence-key benefit:** Products → Benefits (`polar.sh/to/dashboard/products/benefits`)
   → **+ New Benefit** → Type **License Keys**.
   - Prefix: `VOCETTE` (or the chosen name).
   - Expiry: **none**.
   - **Activation limit: 3**, and allow customers to deactivate devices themselves.
     Without an activation limit, activation in the app fails.
3. **The product:** Products → **New product** → **One-time** price, US$29 (or your price)
   → Automated Benefits → attach the licence-key benefit.
   - Never remove the benefit from the product later: that revokes every key.
4. **The EU withdrawal acknowledgement** (Polar's checkout does not collect it):
   Settings → **Custom Fields** → **Checkbox**, wording:
   *"I ask for Vocette Pro to be supplied immediately and I acknowledge that I lose my
   14-day right of withdrawal once the licence key is delivered."*
   Then on the product: Checkout Fields → add it → mark **Required**.
   *Have a lawyer with EU consumer-law experience look at this; see
   `docs/research/licensing.md` §7.*
5. **The refund policy:** publish the one on the website (`site/refund.html`: 14 days, no
   questions) and put the same sentence in the product description.
6. **The checkout link:** Products → **Checkout Links** → **New Link** → select the product.
   Copy the URL.
7. **The ids the app needs** — paste into `src/shared/product.ts`:
   - `CHECKOUT_URL` — the checkout link from step 6.
   - `CUSTOMER_PORTAL_URL` — `https://polar.sh/<your-org-slug>/portal`.
   - `POLAR_ORGANIZATION_ID` — Settings → **Organization** → **Identifier** (Copy).
   - `POLAR_PRO_BENEFIT_ID` — the licence-key benefit's id, from the benefit's own page
     (where exactly Polar shows it has not been checked on screen; the API also lists it).
   Commit. Until these are filled in, the app says purchases open soon and the licence
   field is disabled.
8. **Test a purchase in Polar's sandbox first** (`sandbox.polar.sh`, same steps), with the
   app pointed at it: set `MURMUR_POLAR_API_BASE=https://sandbox-api.polar.sh`,
   `MURMUR_POLAR_ORG_ID` and `MURMUR_POLAR_BENEFIT_ID` to the sandbox values before
   launching. Buy with Stripe's test card, activate in the app, release the PC.

## 3. Website

1. **Domain:** buy the name's domain (e.g. `vocette.app`) at a registrar you trust.
2. **Hosting:** the site is in `site/`, published by the workflow in
   `.github/workflows/pages.yml`. Repository Settings → **Pages** → Source **GitHub
   Actions** → then **Custom domain** → your domain → **Enforce HTTPS**. At the registrar,
   add the DNS records GitHub shows. (Pages' "deploy from a branch" can only publish the
   root or `/docs`, which is why the workflow is there.)
3. Fill in the site's placeholders: the checkout link, your support email, the legal name
   and address the terms and privacy pages need.

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
