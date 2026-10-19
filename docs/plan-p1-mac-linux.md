# Plan: P1 Mac and Linux release candidates (Claude's notes, 19 Oct 2026)

Facts (Explore, 19 Oct): electron-builder already has mac dmg+zip (arm64, x64; hardened
runtime; unsigned, notarize false) and linux AppImage+deb (x64). CI (`.github/workflows/ci.yml`)
verifies and packages on windows/macos/ubuntu, but only on push to main, PRs or manual
dispatch; go-live has never been pushed. The x64 Mac build is cross-built on an Apple-silicon
runner. sherpa-onnx (on-device engine) has never run on macOS or Linux;
`scripts/check-native-packaging.mjs` checks its files on win32 only. No publish config; releases
are Windows-only (`scripts/release-win.mjs`). Platform adapters for macOS (Accessibility, Input
Monitoring, per-app target check) and Linux (X11 hold + paste; Wayland toggle + clipboard only)
exist and are untested on hardware.

## Steps

1. **Push go-live and run CI on it** (owner's OK: public repo). Add `go-live` and `v*` tags to
   the workflow triggers.
2. **Engine smoke on every OS in CI.** After packaging, run the packaged app's sherpa-onnx with
   the published q8 model on sherpa's own public test WAVs (never the owner's recordings), and
   fail the job if the text is wrong. Extend `check-native-packaging.mjs` to darwin and linux.
   This is the first time the on-device engine runs off Windows.
3. **Mac builds that open.** Ad-hoc sign (`identity: "-"`) so Apple-silicon Macs run it at
   all, verify with `codesign --verify` in CI, and build x64 on an Intel runner where GitHub
   still offers one; otherwise ship arm64 only and say so.
4. **A release-candidate pre-release** `v0.8.0-rc.1` with the Windows installer and zip, the
   Mac dmg and zip, the Linux AppImage and deb, and SHA256SUMS (owner's OK at publish time).
   Pre-release, so the update check ignores it.
5. **Tester page** (artifact): per-OS install steps (Mac "Open Anyway" in Privacy & Security;
   AppImage make-executable), the three Mac permissions, and the 0.8.0 checks in order, so the
   brother and friend can test without me. The owner's own Linux test is guided by me, one step
   at a time.

## Questions for the owner

- Which Macs: Apple silicon (M1–M4) or Intel? Decides whether x64 matters.
- Which Linux: distro, and X11 or Wayland? On Wayland, hold-to-talk and auto-paste are off by
  design.
- OK to push go-live to GitHub (public)?

## Owner answers (19 Oct)

- Macs: Apple silicon. Ship arm64 only for the RC; drop the cross-built x64 from the RC.
- Linux: latest Ubuntu. Since 25.10 Ubuntu's GNOME has no X11 session, so the owner's test
  runs on Wayland: toggle + clipboard only. Hold-to-talk and auto-paste on Linux go untested
  unless someone has an X11 desktop. Say so on the tester page.
- Push go-live: still to answer.

## Unproven after this

- Real microphones, permissions prompts and paste on real Macs and Linux desktops: only the
  testers can prove that.
- Mac auto-update: not possible while unsigned; Mac users get a download link.

## Finding, step 2 (19 Oct): the q8 model garbles on CPUs without VNNI

CI run 39293449127, same packaged build, same model files:

| Runner CPU | Result |
|---|---|
| Owner's Intel Core Ultra 7 265U (AVX-VNNI) | correct |
| Apple M1 (virtual), CI macOS | correct |
| Linux runner, run 39292418991 (CPU not recorded, likely newer EPYC) | correct |
| AMD EPYC 7763 (Zen 3, AVX2, no VNNI), CI Windows and Linux | garbled: "Ask not what you're comstrich and do for you…", "Alles hat and the west hat's my." |

Cause (very likely): `to-int8.py dyn` uses U8S8 (uint8 activations, int8 weights) without
`reduce_range`. On x86 AVX2/AVX-512 without VNNI, ONNX Runtime's U8S8 kernel uses VPMADDUBSW,
which saturates; ORT's quantisation docs warn about exactly this and recommend reduce_range or
U8U8. Affected users: Intel before 10th-gen Ice Lake / 12th-gen desktop, AMD Zen 3 and earlier
— a large share of PCs. Not shipped yet: no released app uses the q8 model.

Fix plan (owner to approve):
1. Build two candidates: `reduce_range=True`, and U8U8 (`weight_type=QUInt8`).
2. Model-only WER on the owner's PC (local-direct.ps1) for both.
3. A manual CI workflow that builds the candidate from the pinned fp32 export and runs
   engine-smoke on the EPYC runners — nothing published.
4. Publish the winner as `model-parakeet-v3-q8-2` (owner OK), manifest id `-q8b`, retire `-q8`.

## Result of the fix test (19 Oct)

Model-only, owner's PC (20 benchmark recordings, greedy):

| Model | WER | Openings | Wait p50 |
|---|---|---|---|
| q8 dyn (published) | 11.1% | 13/20 | 277 ms |
| **q8 dynrr (reduce_range)** | **10.1%** | **15/20** | **267 ms** |
| q8 dynu8 (uint8 weights) | 11.1% | 13/20 | 468 ms |

Model-check run 39296005272 (CI builds the models itself from the pinned fp32 export):

| Runner CPU | dyn | dynrr | dynu8 |
|---|---|---|---|
| AMD EPYC 9V74 (Zen 4), Linux | **garbled** | ok | ok |
| AMD EPYC 9V45 (Zen 5), Windows | ok | ok | ok |
| Apple M1 (virtual), macOS | ok | ok | ok |

Earlier run 39293449127: EPYC 7763 (Zen 3) garbled dyn on Windows and Linux.

Correction: Zen 4 has AVX-512 VNNI and still garbles, so "CPUs without VNNI" is not the exact
rule. What is proven: U8S8 without reduce_range garbles on some x86 CPUs (Zen 3, Zen 4 seen),
and reduce_range fixes it on the same Zen 4 runner. dynrr not yet run on a Zen 3 runner.

Pick: **dynrr**. Same size and speed, no worse accuracy. Files (bench names → app names):
- encoder 881498555 f1103b2adcd067232a88d8f65d4918909be63c3fb84ebfe1bd0be6a42d14429b
- decoder 47235689 167873a811f683e6ce94204887954297e77a2c6604a5121dcc234394a7fbfe3e (unchanged)
- joiner 6402684 c1e0fea6822eae1c378810cf7d712907f352cf30e0dd4c9bcfea370d17d40151
- tokens 93939 d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d (unchanged)

Next (after owner OK to publish): release `model-parakeet-v3-q8-2` with these four files;
manifest id `parakeet-tdt-0.6b-v3-q8rr`, retire `-q8`; release notes; model check on main.

## Switched (19 Oct)

Published `model-parakeet-v3-q8-2` (owner OK); manifest id `parakeet-tdt-0.6b-v3-q8rr`, `-q8`
retired. CI run 39300274141 downloaded it from the release on all three and transcribed both
recordings: Windows on **EPYC 7763 (Zen 3, the CPU that garbled q8)**, Linux on EPYC 9V45,
macOS on M1. Real-app dictation on the owner's PC (e2e/diagnostics-check.mjs) PASS.
Step 2 done. Next: step 3, Mac builds that open (arm64 only).

## Step 3 done (19 Oct)

CI run 39329076117: arm64-only Mac build, ad-hoc signed with hardened runtime and the
microphone entitlement; `codesign --verify --deep --strict` passes on the app and on the DMG copy;
engine check passes. Unproven: opening a downloaded copy on a real Mac (Gatekeeper, Open Anyway).
Next: step 4, the v0.8.0-rc.1 pre-release (needs a version bump; owner OK to publish).

## Step 4 plan: the tester build (19 Oct, not built)

Facts checked:
- electron-updater 6 (node_modules/electron-updater/out/providers/GitHubProvider.js): an app
  whose version is a pre-release looks for newer releases on its own channel. Channel `rc` is
  a custom channel: `0.8.0-rc.1` would get later rc builds but **never the stable 0.8.0**.
  Channel `beta` takes the newest of beta and stable. Non-semver tags (model-*) are skipped.
  Stable apps read /releases/latest, which pre-releases never become.
  → Use **v0.8.0-beta.1**, not rc.1.
- v0.4.0 on GitHub has exe, zip, SHA256SUMS but **no latest.yml or blockmap**: the Windows
  updater cannot work from a release like that. The CI artifact upload also omits *.yml and
  *.blockmap. Fix for this build and note in docs/release.md.
- Ubuntu 24.04+: AppImages need libfuse2 (not installed by default), and AppArmor blocks
  Electron's sandbox from an AppImage. The .deb installs normally. → The owner tests with
  the .deb; the AppImage is offered but not the recommended file. Unproven until tried.
- A GitHub pre-release on a public repo is visible to anyone who opens the releases page.

Changes:
1. `package.json` version 0.8.0-beta.1; CHANGELOG `Unreleased` → `0.8.0-beta.1`.
2. CI: upload *.yml and *.blockmap with the installers; new `release` job on `v*` tags
   that collects the three platforms' files plus SHA256SUMS.txt into a **draft** release
   (GITHUB_TOKEN, `contents: write`). A draft is invisible to the public and to the updater.
3. docs/release.md: the tag-driven flow, the yml files, the beta channel.
4. Tag v0.8.0-beta.1 and push the tag (owner's OK = this plan).
5. Check the draft's files and hashes; then **ask the owner** before turning it into a
   published pre-release.

Not in this build: M2 legal text (needs O2), search placeholder fix, payments live (O3).

## Step 4 built (20 Oct)

Tag v0.8.0-beta.1, CI run 39331728565: all checks green; draft release (draft, pre-release) holds
exe, zip, dmg, mac zip, deb, AppImage, blockmaps, latest.yml / latest-linux.yml / latest-mac.yml
(all name 0.8.0-beta.1 and the right files) and SHA256SUMS.txt; GitHub digests match the CI log.
A beta app asks for beta.yml first and falls back to latest.yml. Unproven: the update path
beta.1 → beta.2, and installing on real machines. Waiting for the owner OK to publish.
Published 20 Oct (owner OK): public pre-release, anonymous download 200, /releases/latest still v0.4.0. Next: step 5, tester page.
