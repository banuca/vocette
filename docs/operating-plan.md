# Murmur — operating plan

The working document for the owner's brief of 17 September 2026: "a world-class dictation
tool in a nutshell — lightweight, easy to use, easy to customise for certain user groups,
and monetised." Claude is the strategist; implementation goes to worker agents; the owner is
the test gate. This file holds the state, the queue and the test record. The full product
analysis stays in `roadmap-world-class.md` and is not repeated here.

---

## 1. The goal, sharpened

**A dictation tool that gets *your* words right, is provably yours, does not get in the way,
and is bought once.** (Thesis from `roadmap-world-class.md` §2; unchanged.)

The owner's four words map onto it like this:

| Owner's word | What it means for Murmur | Where it lives in the roadmap |
|---|---|---|
| World-class | Accuracy on the user's own vocabulary, honest delivery, measured latency | Features 1, 2, 4, 5, 9, 11 |
| Lightweight | Electron idle memory measured and published; no account, no server, one outbound call | Feature 10; §5 "what not to build" |
| Easy to use | Zero-config local engine so no API key wall; press, speak, done | Features 3, 15 |
| Customisable by user groups | **Profiles**: a vocabulary + replacement rules + style bundle, importable as one file, shareable within a team (legal, clinical, developer, NGO analyst) | **New — see §4, proposed feature 6b** |
| Monetised | One-off licence, offline Ed25519, Windows first, MIT stays, merchant of record | Features 13, 14; §4 of the roadmap |

---

## 2. How we work

1. **Claude plans.** Each feature gets a brief in this repo's `docs/` before a line is written:
   what the user sees, the files that change, the tests, the hand-test steps.
2. **A worker builds.** One general-purpose agent per feature, given the brief and told to
   run `npm run typecheck && npm test` before reporting. Never two features in one worker.
3. **Claude reviews the diff** against the brief and the hazards in the roadmap §1
   (`isHistoryEntry` filter, `getPublic()` projection, twice-written settings rules).
4. **The owner tests by hand**, one step per message, Windows 11. Pass/fail is recorded in §6
   below, not in the chat. A failure stops the run.
5. **Commit** once the hand test passes. No attribution trailers.
6. **Only then** the next feature.

Chat carries: the outcome, any decision that is the owner's, and one step to act on now.

---

## 3. State on 17 September 2026

- `main` at `c07633f`, version `0.4.0` in `package.json`, feature 1 (custom vocabulary) in
  `[Unreleased]`.
- Automated: 30 test files, 437 tests passing; `tsc --noEmit` clean (re-run today).
- **Feature 1 has no hand-test record.** `docs/verification/windows-smoke.md` covers the 0.4
  milestone only; no document mentions vocabulary. Per the working rule it is *built,
  unproven* and blocks feature 2.
- macOS and Linux have never been launched. Windows-first stands.
- No signing credentials, no rename decision, no IP decision (see §5).

---

## 4. The queue

Straight from the roadmap §3, with one insertion. Effort and tier as ranked there.

| # | Feature | Status |
|---|---|---|
| 1 | Custom vocabulary | Built — **hand test pending** |
| 2 | Cleanup that actually runs | Next |
| 3 | Key-free local and self-hosted endpoints | |
| 4 | Clipboard custody and honest delivery | |
| 5 | Latency breakdown and payload discipline | |
| 6 | Spoken replacements and snippets | |
| **6b** | **Profiles — export/import a "user group" bundle** | **Proposed, owner to confirm** |
| 7 | History as a correction workspace | |
| 8 | Silent retry and in-window Retry | |
| 9 | Start listening at the keypress | |
| 10 | Network ledger and offline lock | |
| 11 | Learn from corrections | Pro |
| 12 | Polish pass with a visible diff | Pro |
| 13 | Offline licence and entitlement | Pro gate |
| 14 | Signed Windows build and opt-in update check | Pro |
| 15 | On-device transcription engine | Pro |
| 16 | Per-app style buckets | Pro |

### Proposed feature 6b — Profiles

**What the user sees.** In the "Your words" card, an **Export profile** button writes one
JSON file containing the vocabulary, the replacement rules, cleanup level, language and
(later) polish style. **Import profile** reads one, showing a preview and asking whether to
merge or replace. A profile file is what a team lead, a clinic administrator or a course
tutor hands to their group. Nothing about the user's key, endpoint, history or device is in
the file, and the importer refuses any file that contains those keys.

**Why it belongs here.** It is the literal meaning of "easy to customise by certain user
groups", and it is the commercial hook: a curated profile ("UK legal", "ITU-T standards",
"React/TypeScript") is a natural Pro download and, later, the thing an organisational
licence distributes. It costs almost nothing once features 1 and 6 exist — a pure
serialise/validate module plus two IPC handlers and two buttons — which is why it sits
directly after 6 and not later.

**Why not earlier.** It has nothing to bundle until 6 ships rules. Building the container
before the contents would be batching.

**Risk.** The importer is an attack surface for a file the user did not write. Validate with
an allow-list, clamp with the same limits as the settings store, never execute or eval, and
never accept a key or endpoint from a profile. Tier: export and import free; curated packs
Pro.

---

## 5. Decisions that are the owner's

Ranked by what they block. Recommendations are the roadmap's, restated.

| # | Decision | Blocks | Recommendation |
|---|---|---|---|
| A | **Employment IP** — first commit carries an `@itu.int` identity | Any sale | Ask HR or legal in person before any money changes hands. Does not block features 1–12. |
| B | **Rename** — "Murmur" collides with ≥4 dictation products | Signing, site, first sale | Rename before feature 13. Check trademark and app-store collisions first. |
| C | **Licence** — stay MIT | — | Stay MIT; sell the signed build and support. |
| D | **DCO in CONTRIBUTING.md** | First external PR | Add now; cheapest irreversible decision. |
| E | **Price / tier line** | Feature 13 | $39 two devices, $69 five, one-off. Never meter dictation. |
| F | **Windows signing identity** | Feature 14 | Check Azure Trusted Signing eligibility first; OV certificate as fallback. |
| G | **Renegotiate the no-update-call promise** | Feature 14 | Opt-in, refusable, visible in the ledger, changed in the three documents in the same commit. |
| H | **Confirm feature 6b** | Queue order after 6 | Yes. |

Nothing in this table blocks testing feature 1 today.

---

## 6. Test record

Kept here so the chat only carries the current step.

### Feature 1 — custom vocabulary (hand test, Windows 11)

Steps are §7 of `roadmap-world-class.md`. Test words: **ITU-T**, **Kirinde**, **Dataverse**.

| Step | What | Result | Date |
|---|---|---|---|
| 1 | Baseline sentence, box empty | Pass — "ITUT" for "ITU-T"; Kirinde correct | 2026-09-17 |
| 2 | Enter three terms, save | — | |
| 3 | Same sentence again | — | |
| 4 | Quit and relaunch; terms persist | — | |
| 5 | Unrelated sentence; no hallucinated terms | — | |
| 6 | Model switch changes the note under the box | — | |

---

## 7. Defects found while testing

| # | Found | Defect | Cause | Fix | Status |
|---|---|---|---|---|---|
| D1 | 2026-09-17, feature 1 step 1 | Under `npm run dev` the settings window renders with no stylesheet (serif text, no cards). Built app unaffected. | `styles.css` is imported from `main.ts`, so the Vite dev server injects it as an inline `<style>`; the page CSP has `style-src 'self'` and the dev-only plugin in `electron.vite.config.ts` relaxes `connect-src` but not `style-src`. | Extend `devCspAllowHmr()` to also replace `style-src 'self'` with `style-src 'self' 'unsafe-inline'` when serving. Dev only; production CSP unchanged. | Logged. Fix after the feature 1 run completes. |
