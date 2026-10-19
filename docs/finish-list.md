# Finish list to 1.0 (Claude's notes, 16 Oct 2026)

Brief steps 4 and 5. Sources: `benchmark-results-2026-10-16.md`, `review-1.0.md` (K/N/S/L/O),
`owner-launch-checklist.md`, `ideas.md`, `mrr-gap-2026-10-16.md`, and Wispr Flow complaints
(secondhand, below). Ordered by what most moves someone from a first dictation to paying.

## Where Vocette must beat Wispr Flow (everything else only has to match)

1. **Price:** US$4.99/US$49 against US$15/US$144. Already true.
2. **Privacy:** nothing leaves the PC on-device; no screenshots, no account. Wispr's 2025–26
   privacy incident (active-window screenshots sent to its servers) is the most-cited reason
   for cancelling. Opt-in counts (M) must be worded so this promise stays true.
3. **Accuracy on the free engine:** on-device is what a new user meets first. Today it is far
   behind (22% vs 5% WER). It doesn't have to beat Wispr's cloud, but a new user must not hit
   mangled sentences on day one.

Match only: speed (already a tie on cloud, 0.81 s vs 0.77 s), reliability, formatting.
"Lightweight" (Wispr reportedly ~800 MB idle on Mac, secondhand) is unmeasured on this PC.
The owner declined a live measurement on 16 Oct, so don't claim it.

## The list

Tags: **Q** product quality · **M** must before taking money · **S** conversion/retention ·
**O** owner-only task · **L** after 1.0.

### Release candidate 0.7.0: close the quality gap (gate: the benchmark)

1. **Q1 Recorder: keep the start of every dictation.** A/B `echoCancellation`,
   `noiseSuppression` and `autoGainControl` off (`src/renderer/recorder.ts:166`), then a stream
   that's already open when the shortcut goes down (opened on modifier-down, or kept warm for a
   short time after each take). Mind the existing instant-capture behaviour and the Windows mic
   indicator (owner-launch-checklist, open questions). **Pass:** openings ≥ 17/20, and cloud
   WER within 1 point of Wispr's on the benchmark.
2. **Q2 On-device accuracy. Done 19 Oct: 9.3% through the app with Vocette's int8 build (docs/plan-model-q8.md).** Re-run after Q1. Then look for dropouts while the model prewarms
   (CPU contention during capture), and at the three takes that returned nothing. **Pass:**
   on-device WER ≤ 10% with no empty takes. If it can't get there, it's the owner's decision:
   new users start on cloud (needs a hosted key or proxy, which costs money per word), or on
   a better local model.
3. **Q3 Paste reliability.** The focus check declined to paste into a window that never lost
   focus (1 in 4 pilot takes). Find out why `foreground.check()` said "not the same window".
   **Pass:** 0 declined pastes across all benchmark runs.
4. **Q4 Mic open lag.** Part of Q1. **Pass:** the one-word passage p19 survives at 300 ms
   pre-roll, 10 runs in a row.
5. **Q5 Vocabulary.** "Polar" was missed by both Vocette runs. Check how user terms reach the
   cloud prompt and the local engine. Small.

### Release candidate 0.8.0: ready to take money

6. **M1 Opt-in counts (decision M).** A first-run question, default off, with events only
   (a take happened, the limit was reached, app version). Update README, SECURITY, About and
   the site to say exactly what is sent. Needs an endpoint: the cheapest is a tiny serverless
   counter. Decide where, as part of planning.
7. **M2 Copy (N2, N3, N5).** Terms with the seller's legal name, 10 devices, launch-offer small
   print and the word limit; installer EULA; privacy and refund pages; version 1.0.0 and the
   changelog. Needs O2. **Correction (owner, 16 Oct): Windows, macOS and Linux all ship at
   launch** (Mac tested by the owner's brother and a friend, Linux by the owner), so the About
   page keeps "for Windows, macOS and Linux".
7b. **P1 Mac and Linux release candidates.** The 0.7.0 recorder changes (raw capture,
   warm-up, lead-in) are shared code but only benchmarked on Windows. Build the Mac DMG on
   GitHub Actions and the Linux AppImage. Each platform's tester runs the 0.8.0 hand test.
   Mac stays an unsigned beta until demand (decision of 8 Oct); Linux is marked beta.
8. **S1 Diagnostics (L2, moved up).** "Copy diagnostics" and a small local error log. There
   are no logs today, and beta users can't report what they can't see. Without it, problems
   like Q2's empty takes are invisible.
9. **S2 Release-candidate hand test** (one session, guided one step at a time): every change
   since 0.6.7, plus the still-unproven items: K8 install and restart, NSIS uninstall removing
   the Run entry, K11 while dictating, the rest of the 0.6.6 steps (5–7) and the 0.6.7 steps.
10. **S3 Beta, 5–10 outside users** (O4). Two weeks. **Pass:** 5 of 8 dictate on at least 4 of
    7 days in week 2 (measured by M1 for those who opt in, otherwise by asking).

### 1.0.0: go live

11. **N4 Website** in Graphite: real prices, yearly first (decision P), 10,000 free words,
    theme switch, download and checkout links. Waits for the owner's D1 headline. Separate
    area (site/marketing) but it blocks launch.
12. **N6 Release:** push go-live, publish v1.0.0 with installer, zip and SHA256SUMS, site live
    on vocette.com (DNS).

### Owner-only, in parallel (start now: some take days)

- **O1 Code signing (S1 in the review).** Azure Trusted Signing identity validation takes
  days. An unsigned installer meets SmartScreen's "Windows protected your PC" on every first
  download, which is the biggest single leak in the funnel.
- **O2 Legal name, address and governing law** for the terms; copyright holder (LICENSE).
- **O3 Polar live (N7):** payouts, identity, country, support email, EU withdrawal checkbox,
  refund sentence. Check the Polar plan (Starter 5% + 50¢).
- **O4 Pick 5–10 beta users.**
- **O5 support@vocette.com (N8)**, forwarded at the registrar.
- **O6 D1 headline** for the website (recommended A: "Dictation that stays on your computer.").
- O7 Trade mark clearance (review O5). A risk, not a blocker.

### After 1.0 (L)

- K9 History dashboard redesign (decided: after 1.0).
- I1 Basic/Advanced settings and I2 the first-run simple/developer choice. They help retention
  for non-technical users, so they could be first after launch, once M1 shows where people
  get stuck.
- I3 Icons instead of words on the pill.
- K12 double-click to dictate (out for launch).
- Friends link (L3), phones. (Mac and Linux moved to 0.8.0, P1.)
- Remove the ~100 benchmark entries from the owner's History (needs the owner's OK).

## How we test now (brief step 5)

- **Every change:** its own commit, with unit tests and an e2e check, run by Claude. Audio or
  engine changes also re-run the benchmark (`e2e/bench`, ~20 minutes, VB-CABLE, needs the PC
  hands-off). No owner hand test per change.
- **Each release candidate (0.7.0, 0.8.0):** one guided hand test by the owner, one step per
  message, covering every change in it plus anything still unproven.
- **Before 1.0:** the beta (S3) is the external check, alongside the benchmark.
- What an automated check can't prove (installer, restart, real microphone, other PCs) is
  listed as unproven until the RC hand test or the beta covers it.

## Wispr Flow complaints (secondhand, for positioning)

- Privacy: screenshots of the active window sent to the cloud without clear disclosure; the
  company apologised and changed its policy (May 2026). ModelPiper:
  https://modelpiper.com/blog/wispr-flow-privacy-incident ; Voibe review:
  https://www.getvoibe.com/resources/wispr-flow-review/
- Reliability: "great in the trial, inconsistent after paying"; 75+ outages in six months by
  StatusGator count (source is a competitor). https://www.getvoibe.com/resources/is-wispr-flow-reliable/
- Resources: ~800 MB RAM and ~8% CPU idle (Mac, Reddit reports via a review); reports of the
  Windows app freezing target apps such as VS Code (unverified).
- Trustpilot ~2.7/5 against 4.8 on the App Store (via the same review site; not checked
  first-hand, because the owner declined the fetch on 16 Oct).
- Cancellation: no prorated refunds by default. https://docs.wisprflow.ai/articles/3307336566-canceling-your-wispr-flow-subscription
