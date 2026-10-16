# Site redesign (finish-list N4): working notes

Started 16 Oct 2026. Branch `banuca/site-redesign-0ca039`. Site only (`site/`); no app code.

## Status

| Step | What | State |
|---|---|---|
| 0 | Design direction artifact | Published, waiting for the owner: https://claude.ai/artifact/W2pPKzB1pGkDtuPaZ6PsvS |
| 1 | Home page rebuilt, pricing switch included (direction approved 16 Oct) | Built, checked, waiting for the owner's preview |
| 2 | (merged into step 1) | — |
| 3 | Legal pages (privacy, terms, refund) in the new style | Not started |
| 4 | Owner preview and approval | Not started |

## The direction: "Graphite, lit by one red light"

- Monochrome Graphite tokens from the Vocette Design System, restated, plus site-only
  tokens: `--hero-light`, `--desk-light`, `--glow-listen`, `--nav-glass`, `--bar-other`,
  `--radius-xl` (22px, tiles and stage), `--badge-ink`.
- The only colour is `listen` red, and its glow shows only while the mock pill is listening.
- Type: system faces only (Segoe UI Variable Display/Text; SF Pro on Mac). No web fonts:
  the privacy brand, and the app's own rule. Display at weight 600, tracking about -0.05em,
  line height 0.93. Heard speech in Georgia italic (`--font-spoken`), typed text in the sans.
- Hero: eyebrow, the D1 placeholder headline (marked as such), lede, two buttons, fine
  print (free 10,000 words, no account, not on Mac/Linux yet).
- Stage: a mock Windows window that cycles Mail → Chat → Code. Keys press, the pill opens
  (Listening, red badge, live bars, timer), heard words appear in italic serif, fillers are
  struck through on release, the pill turns to Writing, the text appears at the caret, the
  pill shows Pasted and folds. Tabs to pick a scene, a pause button (WCAG 2.2.2), stops
  when off screen or the tab is hidden. Labelled "An illustration of the app, not a recording."
- Bento: on-device (big tile, animated flow), no account, no screenshots, open source MIT,
  "a third of Wispr Flow's price" (bars to scale 49/144), 10,000 words free (example meter,
  marked "example month").
- Motion: opacity/transform only. Load sequence on a class removed after 2.2 s, so the page
  always rests fully drawn. Scroll reveals use CSS `animation-timeline: view()` where
  supported (Chromium; elsewhere tiles are simply static). Reduced motion: every animation
  and transition off, stage shows the finished state of the chosen scene.
- Layout uses container queries on `.site`, so the preview's Phone switch reflows the real
  layout. In the build, keep container queries (one `.site` container) or move to media
  queries; either works on GitHub Pages.

## Claims check (marketing-plan §3)

Used: on-device by default; nothing leaves the PC on that engine (worded "after the one-time
model download dictation needs no internet at all"); no account; no screenshots; open source
MIT; 10,000 free words a month; US$49/yr and US$4.99/mo; a third of Wispr Flow's price
(US$144/yr, US$15/mo). Not used: accurate, faster, lightweight, Wispr's privacy incident.

Carried over from the old page, to confirm before the build: "Scratch that" removes the
sentence before it; filler and spoken-correction removal; the pill strings "Writing…",
"Pasted", "Cleaning up what you said" are mock text, not the app's real strings.

## Checked for the direction artifact (local copy, Chromium in the browser pane)

- 1280 px dark, 360 px light: renders; no horizontal overflow at 360 (scrollWidth = 360).
- Reduced motion: no running animations, stage at its finished state.
- Phone switch at 1280: site frame 360 px, page does not overflow.
- Not checked: Firefox and Safari; real Windows ClearType rendering of Segoe at 130 px;
  the published artifact itself (checked a local copy with the same file).

## Things to carry into the build

- Branch rebased onto `go-live` (0421e56) on 16 Oct; backup of the old base is branch
  `backup/site-redesign-before-rebase`. marketing-plan.md and finish-list.md are uncommitted
  on go-live: read them from the main checkout, don't edit there.
- Old page facts that conflict with the 16 Oct pricing: "Unlimited dictation" free,
  US$5/US$50. Replace with 10,000 words a month free and US$4.99/US$49.
- Links not live: download (GitHub release), Polar checkouts, support address.
- `.claude/launch.json` (untracked) serves `site/` on 8123 and the scratchpad on 8124 for
  previews. Don't commit it.

## Step 1: home page (16 Oct)

Files: `site/index.html`, `site/styles.css` (rewritten), `site/site.js` (new).
Sections: nav, hero, demo stage, bento, How it works (heading sticky at 900 px+, step
marker follows the step in view), pricing (yearly first, switch), questions, closing, footer.
Real site uses media queries and `vw` (the artifact used container queries). Theme: OS by
default, button stores `vocette-theme` in localStorage. Load sequence on `.intro`, removed
after 2.2 s. All motion inside `prefers-reduced-motion: no-preference`; the demo shows its
finished scene and the pause button hides when motion is reduced. Without JS: scene 1 is
drawn finished, the billing switch hides, the Pro note still gives both prices.

Checked (Chromium, browser pane, local server):
- 1280 px dark and light, 360 px light: no horizontal overflow (scrollWidth = clientWidth).
- Pricing switch: monthly shows US$4.99, the button takes the monthly checkout link, tag hides.
- Reduced motion: simulated with a test copy (media query and matchMedia forced): no running
  animations, stage finished, tabs switch scenes without motion, pause hidden.
- privacy.html still renders at 360 px in the new colours (legal pages restyled in step 3).

Not checked: Firefox, Safari, a real phone, real Windows ClearType at 130 px, 360 px dark
(dark checked at 1280 only), GitHub Pages deploy, any outside link.

Decisions and gaps for the owner:
- Dropped the old "0.4 s" speed section: measured on 28 Sep, before 0.7.0, and the plan rules
  out speed claims for now. Bring back once re-measured, if wanted.
- Old screenshots (`assets/history.png`, `overlay-recording.png`) are the pre-Graphite purple
  design and history.png shows ITU-T text: not used. Files left in place. New Graphite
  screenshots needed if we want real ones.
- The launch offer in product.ts (first 100, half price yearly, until 31 Dec 2026) is not on
  the site. Owner decision.
- Links: download goes to github.com/banuca/vocette/releases/latest (no release yet);
  checkouts are product.ts's Polar links, untested from the site; contact is still
  support@example.com.

## Step 1b: Windows, macOS and Linux (16 Oct)

Owner, 16 Oct: all three ship together at launch (Mac tested by the owner's brother and a
friend, Linux by the owner). This replaces the brief's "Windows only for now".
- Copy says Windows, macOS and Linux (eyebrow, fine print, FAQ, closing, footer, meta);
  "PC" became "computer" throughout.
- Download buttons read "Download for macOS/Linux/Windows" from the visitor's platform
  (`navigator.userAgentData.platform` or `navigator.platform`); Windows without JS or when
  unsure, and on phones. All point at releases/latest. Checked on Windows only: macOS and
  Linux labels unproven.
- To confirm before launch: macOS/Linux requirements (placeholder line in the FAQ); whether
  the default shortcut is Left Ctrl + Left Shift on a Mac (the demo and How it works say so);
  a Gatekeeper/unsigned warning answer for macOS like the SmartScreen one; the demo window is
  drawn Windows-style.
- 360 px dark and 1280 px: no horizontal overflow.

Mobbin: needs a paid plan (every search refused). Web inspiration research running instead:
side-session notes folder, `site-inspiration.md`.
