# Brief 19 — New prices, the launch offer and 10 devices (app only)

Owner decisions, 7 October 2026:

- Pro costs **US$4.99 a month** or **US$49 a year**.
- **Launch offer:** the monthly plan is **25% off forever** (US$3.74) and the yearly plan is
  **half price forever** (US$24.50).
- The offer can be taken up until **31 December 2026**. Anyone who takes it keeps the discount
  for as long as that subscription runs; Polar's "forever" discount behaves the same way.
- One subscription covers **10 devices** through the licence key. There are no accounts.
- **The first 100 subscribers to each plan** (owner: the cap is for us; on review, said in public too, so
  that nobody is shown a price they cannot get). Polar: maximum redemptions 100 per discount.
- The headline wording is the owner's: "half price forever" and "25% off forever". The small
  print ("for as long as that subscription runs") goes in the site's terms, not in the app.

The website copy is a separate feature: the Graphite rewrite. The free monthly word limit
(10,000 words) is also a separate feature, number 20. Neither belongs in this change.

## Changes

1. `src/shared/product.ts`
   - `PRO_MONTHLY_PRICE_LABEL` becomes `'US$4.99 a month'` and `PRO_YEARLY_PRICE_LABEL`
     becomes `'US$49 a year'`.
   - `PRO_YEARLY_SAVING_LABEL` stays `'two months free'`. Twelve monthly payments come to
     US$59.88, so the yearly plan saves US$10.88, a little over two months.
   - `PRO_DEVICES` becomes `10`, and its comment says "devices" instead of "PCs".
   - New `LAUNCH_OFFER_ENDS_AT = '2027-01-01T00:00:00Z'`, the end of 31 December in UTC. Polar
     discount `ends_at` must be set to the same instant.
   - New `LAUNCH_MONTHLY_PRICE_LABEL = 'US$3.74 a month'` and `LAUNCH_YEARLY_PRICE_LABEL =
     'US$24.50 a year'`. Polar rounds 75% of 499 cents to 374.
   - The header comment changes "PCs" to "devices".
2. `src/shared/types.ts`: `LicenceStatus` gains
   `launchOffer: { monthlyPriceLabel; yearlyPriceLabel; endsLabel } | null`. It is `null` once
   `now` reaches `LAUNCH_OFFER_ENDS_AT`, or when that constant is empty. The `devices` comment
   changes to say "devices".
3. `src/main/licence.ts`
   - `licenceStatusFor(…, now)` fills `launchOffer`. `endsLabel` reads "31 December 2026".
   - `LICENCE_MESSAGES.activationLimit` says "devices" instead of "PCs".
4. `src/renderer/licence-text.ts`
   - `subscribeLabels`: while the offer is on, the buttons show the launch price, as
     "Yearly — US$24.50 a year" and "Monthly — US$3.74 a month". Otherwise they show the
     normal labels, as now.
   - New `launchOfferLine(status)` returns "Launch offer until 31 December 2026: the yearly
     plan at half price forever (normally US$49), the monthly plan at 25% off forever
     (normally US$4.99)." When there is no offer, or no checkout is open, it returns an
     empty string.
   - `plansNote` says "up to 10 devices".
5. `src/renderer/pages/pro.ts`: add `<p class="launch-offer" id="launch-offer">` above the two
   buttons. It is hidden when the line is empty.
6. `resources/eula.txt`: "three PCs" becomes "ten devices".
7. Tests
   - Update the fixtures and the existing label assertions.
   - Add tests for: the offer before and after `LAUNCH_OFFER_ENDS_AT`, including the exact
     boundary; no offer line while checkout is not configured; the plans note with 10
     devices.
8. Docs
   - `docs/owner-launch-checklist.md` §2: new prices, activation limit 10, and the two Polar
     discounts. Monthly: 25%, forever, restricted to the monthly product. Yearly: 50%,
     forever, restricted to the yearly product. Both end on 31 December 2026 and are pinned
     on their checkout links, so nobody has to type a code.
   - README and CHANGELOG pick up the new prices and the offer.

## Checks

- tsc, lint, vitest.
- The built app with a fake checkout URL, so that the buttons show. Before the end date, the
  page shows the offer line and the launch prices. Run again with the clock past the end
  date, using a test-only override of `now`: the line is gone and the normal prices show.
  Take screenshots of both.

## Owner hand test

This comes after the Polar products exist: the Pro page shows the launch prices, and a 100%
discount-code purchase lands at the right discounted price in Polar's checkout.

## As built (7 October 2026)

- The launch line reads "Launch offer for the first 100 subscribers, until 31 December 2026: the
  yearly plan at half price forever, the monthly plan at 25% off forever." (`launchOfferLine`).
- `LAUNCH_OFFER_PLACES = 100`, and `LicenceStatus.launchOffer` carries `places`.
- The buttons show the launch price with the normal price struck through (`<s class="was-price">`).
- Test-run overrides read in the main process, never sent to the window:
  `MURMUR_CHECKOUT_URL_MONTHLY`, `MURMUR_CHECKOUT_URL_YEARLY` (https only) and
  `MURMUR_LAUNCH_OFFER_ENDS_AT` (`checkoutConfig`). `app:open-external` uses the same links.
- `resources/eula.txt` also corrected: it still called Pro a one-off purchase.
- Verified: tsc, lint, 1,489 tests. In the built app with stand-in checkout links: during the
  offer the line, launch prices and struck prices show; with the end moved into the past the
  normal prices return and the line hides; with no checkout links, both plans say "opens soon"
  and the line hides (screenshots in the session's e2e/offer).
