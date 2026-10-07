# Brief 17 — The website: one page that sells honestly, plus the legal pages

Queue item 17 of `docs/launch-plan.md`. One commit. Static files in `site/`, no build step,
no external scripts, fonts or trackers (the product's privacy promise starts on its own
website). Deployable to GitHub Pages from the `site/` folder.

## Pages

- `site/index.html` — the landing page:
  - Hero: "Dictation that stays on your PC." / "Hold a key, speak, let go. Your words appear
    wherever you're typing — spelled right, tidied up, and never sent anywhere." Primary
    button "Download for Windows — free"; secondary "What Pro adds".
  - How it works (three steps, with a real screenshot of the overlay and of History taken
    from the running app by Claude).
  - "Built around what people hate about dictation apps" — six to eight claims, each true
    and verified by the record in `docs/launch-plan.md` §7 (e.g. private by default and works
    with Wi-Fi off after the one-time model download; puts your clipboard back; never pastes
    into a window you've left — it tells you instead; starts listening the moment you
    press; corrects your own names and jargon; understands "no sorry, Wednesday"; nothing
    invented from silence; no account, no subscription). Use `docs/research/frustrations.md`
    §4 "claims not to make" as a hard filter: no "most accurate", no "instant", no "works in
    every app", no competitor names.
  - Measured speed, with the method: hardware, audio length, and the release-to-text time
    Claude measured in the packaged app.
  - Pricing: Free forever (list) · Pro — price label from `src/shared/product.ts` — (list),
    "Every install includes 30 days of Pro. After that, keep using the free version as long as
    you like." Buy button links to the checkout URL (placeholder `#buy` until the owner adds
    it, clearly marked in a comment).
  - FAQ: really free?; what Pro adds; languages (the 25, and cloud for others); system
    requirements (Windows 10/11 x64; ~700 MB disk for the model; ~1 GB memory while
    dictating, released after 5 minutes idle); is audio stored (no — held in memory only);
    offline; macOS/Linux (in the code, not yet tested — "not available yet" on the site);
    refunds (30 days, no questions); open source (MIT, you may build it yourself; buying Pro
    funds the work and gets you a signed build and support); SmartScreen warning (until
    signed).
  - Footer: Privacy · Terms · Refunds · Source code · contact email placeholder.
- `site/privacy.html` — the app collects nothing about you; the exact list of requests the
  app can make (same as SECURITY.md); purchases handled by Polar as merchant of record
  (their policy applies to payment data); the licence activation request and what it sends;
  the website is static hosting (GitHub Pages logs, no cookies, no analytics).
- `site/terms.html` — terms of sale and the Pro licence: one-off purchase, use on up to 3
  PCs you own or control, personal or commercial use, lifetime of the major version, no
  warranty, liability limited, merchant of record is Polar, governing law placeholder
  `[to be confirmed by the owner — Switzerland?]`. The MIT licence of the source is
  unaffected.
- `site/refund.html` — 30 days, no questions, how to ask (email or Polar), what happens (the
  licence key is revoked; the free version keeps working).
- `site/styles.css`, `site/assets/` (screenshots, icon). Light and dark via
  `prefers-color-scheme`; readable at 360 px wide; system font stack; no JavaScript needed
  (a few lines for the year in the footer at most).
- `resources/eula.txt` — the installer's licence text: MIT notice + a pointer to the Pro
  terms page.

Every legal page carries: "This text is a template, not legal advice. Have it reviewed
before selling." in an HTML comment at the top and a visible "Last updated" date.

## Done when

The pages render correctly at 360 px and 1280 px in light and dark (Claude checks with
Playwright screenshots); every factual claim traces to the verification record.
