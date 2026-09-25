# Murmur — launch run plan (25 September 2026)

Working document for the autonomous "finish and launch" run. Written for Claude and
its worker agents. The owner reads only the chat; everything else lives here.

Supersedes the queue in `operating-plan.md` for this run. Product analysis stays in
`roadmap-world-class.md`; it is referenced, not repeated.

---

## 1. The brief

Owner, 25 Sep 2026: "an app that works like Wispr Flow… address common user
frustrations… launch as a product and start generating revenue." Decisions taken at
the start of the run (see memory `murmur-launch-decisions`):

| # | Decision | Consequence for the build |
|---|---|---|
| 1 | **On-device engine, one-off price** | Parakeet TDT 0.6B v3 via `sherpa-onnx-node` in an Electron utility process; model downloaded once. Own-key cloud stays as an option. No server, no account. |
| 2 | **Generous free tier; everyone gets Pro free for 30 days; after that free stays genuinely good; Pro is for power users** | Core dictation quality is never gated. Pro = power-user extras only (AI polish, large vocabulary/snippet lists, later per-app styles and learning). Trial is local, no server. No nagging. |
| 3 | **Rename: shortlist, owner picks at the end** | Name centralised in `src/shared/product.ts` + a rename script; build continues as "Murmur". |
| 4 | **Build everything, then a guided hand test** | One feature per commit on branch `launch`. `main` only moves after the owner's hand test passes. |

"Works like Wispr Flow" is read as: hold a key anywhere, speak naturally, release, and
clean, correctly spelled text appears at the cursor quickly — with no setup wall.

## 2. Principles for every change

1. One feature per commit, message states what and why, **no attribution trailers**.
2. Workers run `npm run typecheck && npm test && npm run lint` before reporting; Claude
   re-runs them and reviews the diff against the brief before committing.
3. Hazards from the roadmap §1 are enforced in review:
   - every new `HistoryEntry` field is **optional** (the `isHistoryEntry` filter drops
     entries silently otherwise), with a test that an old entry still loads;
   - `getPublic()` projects by deletion — before any secret (licence key) is added,
     convert it to an explicit allow-list;
   - settings rules are written twice (`normaliseSettings` load path, `update()` save
     path) — both must change together, with a round-trip test.
4. Renderer pages keep the existing idioms: `textContent` for user text, capability
   notes that say why a control is disabled, no silent no-ops.
5. Honest claims only. Nothing in UI or docs claims what has not been verified; latency
   and accuracy are measured, not asserted.
6. Privacy contract: every outbound request is user-initiated or user-enabled and named in
   SECURITY.md: model download (once), licence activation (once), cloud transcription and
   AI polish (only if the user configures them), update check (opt-in).
7. Verify against the running app, not just tests: build, launch with an isolated profile
   (`MURMUR_PROFILE_DIR`), drive it with Playwright-Electron and fake microphone audio.

## 3. Queue

Status: `todo` · `building` · `review` · `committed` · `hand-test pass/fail`.

| # | Feature | Tier | Status | Commit |
|---|---|---|---|---|
| 0 | Dev CSP fix (D1) + isolated test profile env var | — | todo | |
| 1 | Product name centralised + rename script | — | todo | |
| 2 | Cleanup that actually runs, and smarter (fillers, repeats, spoken corrections, new line) | Free | todo | |
| 3 | Snippets / replacements (`spoken => written`) | Free (cap later) | todo | |
| 4 | Clipboard custody (restore) + honest delivery + "paste last" | Free | todo | |
| 5 | Silent retry (cloud) + Retry in window | Free | todo | |
| 6 | Key-free custom endpoints + `transcriptionReady` gate | Free | todo | |
| 7a | On-device engine runtime (utility process, model store, router) | Free | todo | |
| 7b | Engine UI: Settings engine card, first-run download, progress | Free | todo | |
| 8 | Vocabulary on the local engine + fuzzy vocabulary correction (all engines) | Free | todo | |
| 9 | Start listening at the keypress + engine prewarm | Free | todo | |
| 10 | Latency shown per dictation | Free | todo | |
| 11 | Licence, 30-day trial, Account page, Pro gates | Gate | todo | |
| 12 | AI polish with styles, time budget, raw fallback | Pro | todo | |
| 13 | History edit, undo delete, show original | Free | todo | |
| 14 | Opt-in update check | Free | todo | |
| R1 | Silence guard: no text invented from a silent take, no engine call | Free | todo | |
| R2 | Live microphone level in the overlay ("is it hearing me?") | Free | todo | |
| R3 | Esc cancels a hands-free (toggle) recording | Free | todo | |
| R4 | Bluetooth headset hint beside the microphone picker | Free | todo | |
| R5 | Re-arm the keyboard hook after sleep/resume and unlock | Free | todo | |
| 15 | Packaging (sherpa-onnx unpack, native check, release build outside synced folder) | — | todo | |
| 16 | Docs: README, SECURITY, CHANGELOG, CONTRIBUTING (DCO), platform matrix | — | todo | |
| 17 | Website: landing, pricing, privacy, terms, refund | — | todo | |
| S1 | Stretch: learn from corrections | Pro | later | |
| S2 | Stretch: per-app styles | Pro | later | |
| S3 | Stretch: command mode (voice-edit selected text) | Pro | later | |
| S4 | Stretch: transcribe an audio file | Pro | later | |

Order rule: foundations and pure modules first; the engine as soon as the spike reports;
licence only once there is Pro value; packaging and docs last.

## 4. Research

Preserved in `docs/research/` (scratchpad copies are temporary):

- `licensing.md` — Polar licence-key API (verified live), fees, Swiss payouts, EU
  withdrawal gap (Polar's checkout collects no waiver → required checkbox field + a plain
  refund policy), API-version risk.
- `frustrations.md` — 20 ranked user frustrations (152 sources; Reddit/G2 not readable).
  Mapped to the queue: 1 paste failures → 4; 2 stuck processing → watchdogs + 07a timeouts;
  3 lost long takes → retry take + chunking; 4 names/jargon/silence → 8 + R1; 5 slow → 07a +
  9; 6 first word cut → 9; 7 subscriptions → 11; 8 cloud privacy → 07; 9 crashes → packaging
  + signing; 10 hotkeys after sleep → R5; 11 wrong language → Parakeet auto-detect; 12 AI
  changes meaning → 2 is deterministic, 12 keeps the original; 13 setup friction → 07b; 14
  RAM → idle unload; 15 clipboard → 4; 16 terminals → paste only, newlines only on request;
  17 noise → noise suppression; 18 Bluetooth → R4; 19 offline → 07; 20 focus moved → existing
  target check.
- Engine spike (`engine-spike/REPORT.md`, to be copied as `engine-spike.md`) and naming
  shortlist (`naming-shortlist.md`, to be copied as `naming.md`) still arriving.

## 5. Verification protocol (Claude, per feature)

1. `npm run typecheck`, `npm test`, `npm run lint`, `npx electron-vite build`.
2. Diff review against the brief and §2.
3. Where the feature has a runtime surface: launch the built app with
   `MURMUR_PROFILE_DIR=<scratch profile>`, Chromium fake-audio flags and a SAPI-generated
   WAV, drive with Playwright-Electron, read results back (history file, clipboard, DOM,
   screenshots). Record what was and was not verified in §7.

## 6. Final guided hand test (owner)

Built at the end from §7; one step per message; stop at first failure. Includes the
still-pending feature-1 vocabulary steps 2–6 from `operating-plan.md` §6.

## 7. Verification record

| # | Automated | Runtime (Claude) | Not verified |
|---|---|---|---|

## 8. Owner actions before the first sale (collected for the end)

- Employment IP: written confirmation from ITU that they have no claim (first commit uses the work identity).
- Pick the name from the shortlist; then run the rename script; register the domain.
- Create the merchant-of-record account (Polar), the Pro product and licence-key benefit; paste the organisation id and checkout URL into `src/shared/product.ts`.
- Windows code-signing identity (Azure Trusted Signing if eligible, else OV certificate).
- Enable GitHub Pages for the site; add a support email.
- Legal pages reviewed by a person (templates are provided, not legal advice).
