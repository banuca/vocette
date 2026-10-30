# Site redesign (finish-list N4): working notes

Started 16 Oct 2026. Branch `banuca/site-redesign-0ca039`. Site only (`site/`); no app code.

## Status

| Step | What | State |
|---|---|---|
| 0 | Design direction artifact | Published, waiting for the owner: https://claude.ai/artifact/W2pPKzB1pGkDtuPaZ6PsvS |
| 1 | Home page rebuilt, pricing switch included (direction approved 16 Oct) | Built, checked, waiting for the owner's preview |
| 2 | (merged into step 1) | — |
| 3 | Legal pages (privacy, terms, refund) in the new style | Built on branch `site-v2` (30 Oct), see the last section |
| 4 | Owner preview and approval | Preview deployed 30 Oct (`site-v2`), waiting for the owner |

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

## Facts from go-live for the privacy page (from the project session, 19 Oct)

1. The on-device model now downloads from GitHub (pre-release `model-parakeet-v3-q8-1` on
   banuca/vocette), 935 MB (was 670 MB), SHA-256 checked; Vocette's own int8 build of NVIDIA
   Parakeet TDT 0.6B v3 (CC-BY-4.0). privacy.html still says Hugging Face. The home FAQ says
   "about 700 MB of disk space": fix to match.
2. 0.8.0 opt-in counts, off by default ("Help improve Vocette", first-run card and About):
   once a day, one POST to counts.vocette.com with version, system, engine, plan, weeks since
   install, days dictated and dictations in the last 7 days, and whether the free limit was
   reached. No words, audio or ID; server stores the UTC day, no IP. About → "Show what is
   sent". Switching off deletes the local tally. Source: README "Privacy" items 1 and 6,
   SECURITY.md item 6.
These also feed the "What leaves your computer" table idea (site-inspiration.md idea 2).

## 30 Oct: new brief, on hold for the owner's confirmation here

- CEO session brief: translators-first pitch; Pro US$9.99/mo or US$99/yr; Teams US$120/seat/yr
  from 3 seats (pilot, no checkout); /translators page; Mac/Linux betas only; download
  v0.8.0-beta.1 exe; legal placeholders [SELLER NAME], [POSTAL ADDRESS], [GOVERNING LAW];
  support@vocette.com; Cloudflare Pages preview (no DNS, no push, no merge).
- CEO session reports owner approval in its session (30 Oct); ceo-decision.md has an
  "Approved" section.
- Marketing session reports owner, 30 Oct: "let's remove the 10K ceiling" → free tier has no
  monthly word limit. Drop every 10,000-word mention. What Pro adds instead: ask, don't invent.
- Waiting on the owner here for: brief yes/no, public preview yes/no, step-by-step or one look,
  and what Pro offers now that Free is unlimited.

- Resolved (owner via CEO session, 30 Oct): "remove the 10K ceiling" meant the US$10k revenue goal. Free stays at 10,000 words a month; keep it in the copy.

- Fact (CEO session, 30 Oct): model stays loaded 30 minutes after the last dictation (was 5); change "five minutes of rest" in the FAQ. New and fine to say: transcripts are kept out of Windows clipboard history and cloud sync.

## 30 Oct: site-v2 build and Cloudflare Pages preview (web-engineer agent)

Branch `site-v2`, cut from `banuca/site-redesign-0ca039` at ae87c30 (that worktree untouched).
Brief: CEO session, owner-authorised 30 Oct ("proceed with the entire task, including the build
of the website"). Not pushed, not merged.

**Pages.** `/` (home, with the pricing section), `/translators`, `/privacy`, `/terms`, `/refund`,
and `404.html` (without it Pages serves the home page for any unknown address). Links use clean
URLs: Pages serves `x.html` at `/x`, and `/x.html` gets a 308 to `/x`.

**Download URL: one place.** `site/_redirects`: `/download` → the v0.8.0-beta.1 win-x64 `.exe`
(302), `/download/betas` → the v0.8.0-beta.1 release page. Every button links to those paths.
A new release is a one-line change there. The SmartScreen note sits under every primary
download button.

**Preview.** Project `vocette-site`, production branch `main` (never deployed:
`vocette-site.pages.dev` answers 404). Preview alias `https://preview.vocette-site.pages.dev`.
Wrangler 4.156 now hands `pages project create` to "Pages in Workers", which fails in a folder
with no Wrangler config; the project was created with `--force` (classic Pages), as Wrangler's
own notice says. Later deploys need no flag:
`npx wrangler pages deploy site --project-name vocette-site --branch preview`.

**Placeholders (visible, monospace).** `[SELLER NAME]` and `[POSTAL ADDRESS]`: privacy.html
("Who is responsible"), terms.html ("Who we are"), refund.html (box at the end).
`[GOVERNING LAW]`: terms.html. Switzerland was removed because the owner now plans to register
the business in Sri Lanka (ceo-decision.md, 30 Oct).

**Sources for the copy.** README.md and SECURITY.md on go-live (9e40f1c): network list, Free/Pro
table, requirements, limits, betas. src/shared/product.ts: US$9.99/US$99, 10 devices, 50/500
words, 20/200 replacements, 30-day trial and grace. CHANGELOG [Unreleased]: 30 minutes,
clipboard history. NVIDIA model card (fetched 30 Oct): the 25 FLEURS error rates, credited to
NVIDIA, with its European Portuguese note.

**Gaps and decisions for the CEO.**
- The download is beta.1, which predates the site's facts: in-app Pro is US$4.99/US$49 with
  the launch offer, memory is freed after 5 minutes, transcripts still reach clipboard history.
  Point `/download` at beta.2 before go-live.
- support@vocette.com is on every page, but Email Routing is not set up yet: mail to it fails
  until it is. Go-live blocker.
- No Polar checkout on the site: Polar is not repriced yet. Pro's button downloads (trial
  first) and the text says to subscribe in the app. Add checkout links once Polar charges
  US$9.99/US$99.
- Teams: price and seats only, pilot by mailto. No feature claims (none are built).
- The privacy page links the repository, not SECURITY.md: main still shows Murmur's
  SECURITY.md. Link it once main is updated.
- No og:image, og:url or canonical yet: add them with the final domain.
- At go-live on vocette.com: turn off Scrape Shield "Email Address Obfuscation" for the zone,
  or Cloudflare injects an email-decode script into every page (the site promises no
  third-party scripts).
- Removed: the Wispr price tile, the 10,000-word meter tile, the OS-detecting button label (the
  button always says Windows; the Mac and Linux betas are small links in the footer and FAQ).
- The demo's scenes: German translation and French chat typed as said (clean-up is English
  only), English email with fillers and "no sorry" removed (backed by the 0.6.0 changelog).
- FAQ "Who makes Vocette?" says one developer (CMO's honest-limits list). The owner may
  prefer to drop it.
- Not done, not in the brief: a real demo video, a comparison row, a Mac/Linux waitlist,
  analytics.

**Checked (30 Oct).**
- `wrangler pages dev site`: pages 200, unknown address 404, `/download` 302 to the `.exe`,
  `/download/betas` 302 to the release page, `/privacy.html` 308 to `/privacy`.
- Headless Chrome through the DevTools protocol with device emulation (scratchpad
  `snap.mjs`; plain headless Chrome on Windows will not go below ~500 px): full pages at
  1280 px light and 375 px light and dark, for home, translators, privacy, terms, refund and
  404. scrollWidth equals the width on all of them.
- Pricing switch: monthly US$9.99 (tag hidden), yearly US$99 with "Saves a little over two
  months".
- grep of site/: no example.com, `href="#"`, unlimited, US$5/US$50/US$4.99/US$49, three
  computers, 700/670 MB, ITU, Kirinde, half price, first 100, launch offer, "third of",
  ordinary people, Wispr. No outside scripts, styles or fonts; no cookies.
- Outside links answer 200: Polar portal, GitHub repository, release page, model card.
- Live preview (deployment cbf4fc42, alias `preview`): five pages, CSS, JS and icons 200 with
  `X-Robots-Tag: noindex` and no Set-Cookie; unknown address 404; `/download` and
  `/download/betas` 302 to GitHub; `/privacy.html` 308 to `/privacy`; title and og: tags
  served; `vocette-site.pages.dev` (production) 404. Full-page screenshots of the preview
  home page at 1280 px light and 390 px dark: no overflow, nothing broken. The new
  subdomain's certificate took about a minute after the first deploy.

**Not checked.** Firefox, Safari, a real phone, Windows ClearType at display sizes, the
installer itself, what the Polar portal shows, mail to support@vocette.com.
