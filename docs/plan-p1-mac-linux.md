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
