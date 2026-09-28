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
| 0 | Dev CSP fix (D1) + isolated test profile env var | — | committed | b65f2c8 |
| 1 | Product name centralised + rename script | — | folded into 11 (product.ts) and 16 (rename script) | |
| 2 | Cleanup that actually runs, and smarter (fillers, repeats, spoken corrections, new line) | Free | committed | 979cb47 |
| 3 | Snippets / replacements (`spoken => written`) | Free (cap later) | committed | 96bb8bc |
| 4 | Clipboard custody (restore) + honest delivery + "paste last" | Free | committed | f067a4e |
| 5 | Silent retry (cloud) + Retry in window | Free | committed | a319fea |
| 6 | Key-free custom endpoints + `transcriptionReady` gate | Free | committed | 98e4c5b |
| 7a | On-device engine runtime (utility process, model store, router) | Free | committed | 1767354 |
| 7b | Engine UI: Settings engine card, first-run download, progress | Free | committed | e355adc |
| 8 | Vocabulary on the local engine + fuzzy vocabulary correction (all engines) | Free | committed | faebde1 |
| 9 | Start listening at the keypress + engine prewarm | Free | committed | 5f73e73, 486be33 |
| 10 | Latency shown per dictation | Free | committed | 183d7fb |
| 11 | Licence, 30-day trial, Account page, Pro gates | Gate | committed | 4f6e46b |
| 12 | AI polish with styles, time budget, raw fallback | Pro | committed | (next) |
| 13 | History edit, undo delete, show original | Free | committed | d4702a4, 98ab971 |
| 14 | Opt-in update check | Free | committed | 85f2a90 |
| R1 | Silence guard: no text invented from a silent take, no engine call | Free | committed | e1480e5 |
| R2 | Live microphone level in the overlay ("is it hearing me?") | Free | committed | 5230a6e |
| R3 | Esc cancels a hands-free (toggle) recording | Free | committed | 06b284d |
| R4 | Bluetooth headset hint beside the microphone picker | Free | committed | 11c3d57 |
| R5 | Re-arm the keyboard hook after sleep/resume and unlock | Free | committed | 38fdf96 |
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
| 0 | tsc, 437 tests | Built app launched with MURMUR_PROFILE_DIR; settings written to the scratch profile; dev server CSP shows style-src 'unsafe-inline' | — |
| 8 | 807 (lane C) → 1015 merged; SCOWL size 50 list (72,835 words); scan of 238,657 words of real English with 49 terms: 1 unintended change left ("Nitin" → "Notion") | Merged build, fake mic: engine heard "…ITUT draft to Kyranda…", delivered "Please send the ITU-T draft to Kirinde before Friday." | possessives; names absent from SCOWL that sound like a term |
| 9 | 963 tests; arm announced only after the chord is held alone for 100 ms; mic-open race cases by the builder | Merged build: prewarm at the keypress slowed the cold mic start 1.1 → 2.0 s (first take lost words) → fixed: prewarm once confirmed and live → cold mic 0.98 s, first release→text 0.49 s (was 4.7 s cold before prewarm), warm 0.39–0.40 s; transcripts word-perfect | real keyboard arm/disarm with a physical key press; Bluetooth headset behaviour |
| R1 | 844 (lane B) | covered by unit + IPC tests | real accidental press with a real mic |
| R2 | 971 (lane C) | Built app, fake mic: level messages ~14/s varying 0–0.83; bars moved (15–19 distinct heights over 5 s); once saw the bars frozen (not reproduced in 5 further takes) → added a stale-reading decay so a stall shows rest, not a frozen shape | reduced-motion dot on screen |
| R4 | 931 (lane B); matcher accepts/rejects listed labels | — | a real Bluetooth headset label on this PC |
| 7b | tsc, lint, 812 tests | Real first run in the built app: fresh profile + empty models folder → setup card "Download the speech model" → Download clicked → 670 MB fetched through Electron net in 20 s on the corporate network → hashes verified, verified.json written → installed → fake-mic dictation succeeded with the downloaded model. Screenshots: missing, downloading (124 of 670 MB), installed, Settings "Ready". Copy fixes after review: reason "Download the speech model first."; sidebar "Not set up yet". | cancel/resume against the real server; failed state on screen |
| 4 | 671 tests (lane B) → 857 after merge; paste now waits up to 1.5 s for Ctrl/Shift/Alt/Win release (GetAsyncKeyState) | pending: idle-gated real-keystroke test in its own test window (hold Ctrl+Shift, paste, sentinel clipboard restored, Alt+Shift+V) against frozen worktree e2e-clipboard | image/rich clipboard round trip |
| 5 | 832 (lane B) → 889 after merge; fetch counts asserted per case; retry now always clipboard-only (window/tray Retry would have pasted into Murmur itself) | — | a real 429/5xx from a provider |
| 2 | tsc, lint, 572 tests; probe of 25 realistic sentences incl. real engine output | E2E: fake-mic c-disfluent.wav through the built app → "So I think we should. Move the meeting to Wednesday." (fillers and spoken correction applied; the recogniser's own full stop kept) | Settings rows by hand |
| 3 | tsc, lint, 626 tests (lane B); 755 after merge | — (no runtime surface beyond settings) | Settings box on screen; {date} locale in packaged app |
| R3 | 1329 tests; Esc only on its own (modifier = other shortcut), not while capturing/disabled/echo; cancels toggle or window takes while starting/recording, never held or processing | Built app, fake mic: window take shows "Press Stop when you have finished · Esc to cancel" and it fits (230 of 248 px measured); longer chords fall back to "the shortcut"; Settings shows the Esc line under Press to start and stop | a real Esc key press (not injected: it would reach the owner's foreground app) |
| R5 | 1340 tests; rearmPlan (debounce 3 s, clock set back); hook error listener attached once per start; startup wiring: resume/unlock re-arm once, suspend/lock finish a recording take, a take still recording at wake is cancelled | Built app: F24 injected via SendInput seen by the hook through Change-shortcut capture before and after a genuine powerMonitor 'resume' (native uiohook stop+start, 4 ms); capability stayed available | a real sleep/wake and Win+L cycle |
| 10 | 1352 tests; wait from stop request (or Retry press, or audio arrival for a take the recorder ended) to text ready; History optional waitMs round-trips and survives Undo; median over newest 50 | Built app, on-device engine, fake mic, 3 takes × 2 runs: app-measured wait equals the outside stop→success time within 5–9 ms (IPC); warm 0.39–0.46 s, first take 0.49 s; overlay readout "0.4s", History "ready in 0.4s", Typical wait card fits beside the four others at 1060 px. Found: a first take shorter than the engine load (mic slow to open → 3 s recorded) waited 3.6 s — prewarm cannot finish; candidate: load the engine at startup when the model is installed (memory trade-off, owner decision) | narrow window (single column below 940 px) |
| 14 | 1380 tests; semver order incl. v prefix and pre-releases, non-versions never offered; release link must be this repository's release page (else built fallback); 404/403/429/5xx/unreadable/offline/10 s timeout sentences; off = no request ever; 60 s after start then ≤ once per 24 h; Check now single-flight; IPC main-window only; tray line + release target only while available | Built app, real network: Check now → one GET to api.github.com/repos/banuca/murmur/releases/latest, no cookie or Authorization, 389 ms, "You have the latest version (0.4.0)" (repo public, v0.4.0 published); available state pushed to the window: Download link and sidebar dot drawn | no request at startup, watched at runtime (tests only); tray line on screen; a real newer release; the daily timer in real time |
| 12 | 1430 tests; guard (wrapping quotes/fences, preambles, length bounds), prompt rules and order, request shape, no Authorization without a key, temperature-400 retry, error reasons, time limit, cancel; controller: cleaned text in, replacements after, unpolished note, cancel mid-polish pastes nothing, wait includes polish; store fields and encrypted key; card; IPC guards; key borrowed only OpenAI→OpenAI | Built app, on-device engine, fake mic, stand-in chat server on 127.0.0.1 (3 good runs): request carried the cleaned and vocabulary-corrected text, style and terms, no key, temperature 0.2; History kept text, originalText and heardText; 6 s server vs 4 s limit → unpolished in 4.4 s with "— unpolished (took too long)"; Test and the card, the Polished tag and About's sentence on screen. One earlier run stalled on the first take straight after a window reload (no status captured) — not reproduced in 3 runs | **polish quality with a real model** (no model or key on this PC): prompt adherence, not answering questions, language kept — owner test with OpenAI or Ollama |
| 7a | tsc, lint, 701 tests; build has out/main/engine-worker.js | E2E through built app, fake mic: cold stop→text 4.5–4.7 s (spawn + load), warm 0.36 s for a 4–5 s take (3 rounds); model id recorded in History; clipboard delivery; worker smoke by the builder incl. damaged-model recovery, 65 s split, packaged --dir build with native check passing | full 640 MB download; cancel/resume vs real server; idle unload in real time; NSIS installer |

## 8. Owner actions before the first sale (collected for the end)

- Employment IP: written confirmation from ITU that they have no claim (first commit uses the work identity).
- Pick the name from the shortlist; then run the rename script; register the domain.
- Create the merchant-of-record account (Polar), the Pro product and licence-key benefit; paste the organisation id and checkout URL into `src/shared/product.ts`.
- Windows code-signing identity (Azure Trusted Signing if eligible, else OV certificate).
- Enable GitHub Pages for the site; add a support email.
- Legal pages reviewed by a person (templates are provided, not legal advice).

## 9. Lanes (parallel build)

- Lane A — main tree `C:\Users\KIRINDE\Desktop\voice-hotkey`, branch `launch`: 07a → 07b → 8 → 6 → 9 → R2 → R3 → R5 → 10 → 11 → 12.
- Lane B — worktree `C:\Users\KIRINDE\murmur-worktrees\lane-b`, branch `lane-b`
  (node_modules is a junction to the main tree's): 3 → 4 → 5 → R1 → R4 → 13 → 14.
- Integration: at each lane-A commit boundary, cherry-pick finished lane-B commits onto
  `launch` (conflicts are additive in the settings five-place recipe), re-run all checks,
  then rebase `lane-b` onto `launch` before its next feature starts.
