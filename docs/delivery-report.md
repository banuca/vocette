# Delivery report — Murmur 0.4 milestone

Branch `fix/v0.3.2-safety`, on top of `941a4d9`. **Nothing is committed,
pushed, merged, released or published.** The working tree holds everything
described here.

---

## 1. What was delivered

### The milestone as briefed

- **A main-process platform boundary** (`src/main/platform/`) covering global
  shortcuts, paste-target capture and verification, key injection, permission
  and capability reporting, and launch-at-login, with one adapter per operating
  system and a fallback for anything unrecognised. Every native dependency is
  loaded lazily: a missing library, a refused permission or an absent desktop
  service becomes a reported capability, never a failed startup.
- **macOS and Linux support**, alongside Windows. Capability and preference are
  held apart, so a desktop that cannot honour hold-to-talk today does not
  overwrite what the user chose.
- **Toggle recording mode**, and **Record / Stop / Cancel** in the window on
  every page and in the tray — all routed through the one dictation controller,
  so there is still exactly one microphone owner.
- **Cancellation**: a take abandoned before or during transcription leaves no
  transcript, no history entry, no paste, and a zeroed audio buffer.
- **Session-only API keys** where the operating system has no storage fit to
  hold a credential, instead of writing plaintext.
- **First-run guidance** that lists only what is genuinely outstanding and
  clears itself.
- **Three-platform packaging and CI**, and a platform support matrix that keeps
  what a platform *can* do separate from what has actually been *run* on it.

### Requested after the brief was agreed

Recorded in [design-requests.md](design-requests.md) with who asked and why.

- **A light theme and a switch for it** at the foot of the sidebar, modelled on
  VS Code's Light Modern. Saved with the rest of the settings; the overlay
  follows it.
- **A new visual identity**: warm near-black and warm off-white in place of the
  cold editor greys, an indigo accent, larger radii, soft shadows instead of
  drawn grid lines.
- **A layout that opens with the control, not the log**: History leads with a
  large round record button, the phase beneath it and one line of guidance;
  statistics became hairline-separated figures; transcripts became rows that
  light up rather than a ruled table. The same control element moves into the
  top bar on other pages — moved, not duplicated.
- **The product is now Murmur**, including a first-run profile migration so the
  rename does not orphan anyone's settings or transcripts.
- **A drawn icon set** replacing text glyphs.

### Defects fixed during the work

| Defect | How it was found |
| --- | --- |
| Toggle mode started but never stopped: the hold delay was applied to the press that ends a dictation, so a normal tap was discarded | Reported by the product owner, then reproduced deterministically in a new test |
| The record button kept the idle colour while recording — its computed style was correct throughout | Sampling pixels in a screenshot |
| The window said "Ready" while telling the user it had no API key | Looking at the first-run screenshot |
| The sidebar overflowed the window, carrying its status footer off-screen | Looking at a screenshot |
| The overlay badge kept the previous phase's colour | Looking at a screenshot |
| A simplified cog icon reads as a sun at 16px, directly above the theme switch | Looking at a screenshot |
| An empty history repeated the same guidance twice | Looking at a screenshot |
| The transcription payload carried the take's internal delivery state to the provider | Self-review |
| The tray offered a stale action after a take ended on its own | Self-review |
| Capabilities were not re-read when the window regained focus | Self-review |

Two of these — the record button and the overlay badge — are the same hazard:
a CSS transition on a value that comes from a custom property, which Chromium
does not reliably re-target. Neither has a failing computed style, so no test
could have caught either. Both are now documented where they bit.

---

## 2. The diff, and what in it is pre-existing

`git diff --stat HEAD`: **40 tracked files changed, 4,385 insertions,
1,008 deletions**, plus **30 untracked paths**.

**Pre-existing uncommitted work carried through untouched in substance** — the
safety, storage, save-warning and foreground-pointer corrections that were in
the tree before this milestone began:

- `src/main/foreground.ts` — the corrected Win32 pointer, `BOOL` and `_Out_`
  bindings. It now also `implements TargetTracker` and takes its address
  helper from `src/main/platform/native-address.ts`, but the behaviour is
  unchanged and **all 21 of its original tests still pass unmodified**, which
  is the evidence for that claim.
- `src/main/atomic-json.ts` — serialized atomic writes, destructive
  recovery-copy scrubbing, retryable cleanup failures.
- `src/main/history-store.ts`, `src/main/history-retention.ts`,
  `src/renderer/history-save-warning.ts` — retention and the non-modal save
  warning.
- `src/main/dictation-controller.ts` — cancellation ownership, single
  microphone owner, and the paste-target checks. Extended here, not replaced.

**New in this milestone**: `src/main/platform/` (9 files),
`src/main/secure-storage.ts`, `src/main/legacy-profile.ts`,
`src/shared/capabilities.ts`, `src/shared/accelerator.ts`,
`src/renderer/recording-control.ts`, `setup-guide.ts`, `theme.ts`, `icons.ts`.

---

## 3. Results, kept apart

### Automated

- **28 test files, 381 tests, all passing.**
- `npx tsc --noEmit` clean. `npm run lint` clean. `npx electron-vite build`
  clean. `git diff --check` clean.
- These are unit tests against fakes. **A mocked platform test is not an
  operating-system pass**, and none of them says anything about macOS or Linux.

### Native (Windows only)

- The Win32 foreground path was exercised against the real API through koffi:
  real opaque pointer objects, real `BOOL` widths, real handle closing.
- **A claim was corrected in the record**: 2,000 successful native calls do not
  prove the absence of a handle leak. What that loop shows is narrower — no
  fast leak on the success path. The evidence for cleanup is the `finally`
  based closing and the per-path tests that assert which handles are closed.

### Visual

- 23 screenshots of the **built** renderer under `docs/screenshots`, with a
  synthetic bridge: invented transcripts, no profile, no key, no microphone, no
  network. Both themes, 100% and 150% scaling, every overlay phase, the
  first-run and save-failure states, and the fatal-error state.
- Six defects in the table above were found this way and by no other means.

### Manual, on Windows 11 (26100)

Eight guided steps, driven one at a time against an isolated instance with a
disposable profile. All eight passed — see
[verification/windows-smoke.md](verification/windows-smoke.md) run 4. The
profile migration was additionally exercised against the real application with
a seeded legacy profile: settings and both transcripts arrived, the originals
were left in place.

---

## 4. How to run and build it

```bash
npm install
npm run dev            # development, with HMR
npm test               # 381 tests
npm run typecheck
npm run lint
npm run build          # typecheck + test + electron-vite build
npm run build:win      # NSIS installer and portable zip, into dist/
node scripts/check-native-packaging.mjs
```

`build:mac` and `build:linux` exist and must be run on those platforms: the
native prebuilds are selected at install time and cannot be cross-built.

**Local artefacts from this session** live outside the repository, in the
session scratchpad — the isolated smoke profiles, the screenshot and variant
harnesses, and the pre-restyle stylesheet backups. Nothing there is needed to
build or run the app.

**A packaging caveat specific to this machine**: `electron-builder` writing
into `dist/` fails with `EBUSY`/`EPERM` on `app.asar`, reproducibly, in a fresh
directory, with no Electron process running. The repository sits under a synced
`Desktop`. The same build succeeds immediately when directed at a temporary
folder. This is a property of the machine, not of the configuration.

---

## 5. What is still outstanding

| Severity | Item |
| --- | --- |
| **High** | **macOS and Linux have never been run.** Every line of `macos.ts`, `linux.ts`, `macos-native.ts` and `linux-native.ts` is unexecuted outside unit tests. They must not be described as working until someone runs them on that hardware. `platform-support.md` lists the exact checks. |
| **Medium** | Signing and notarisation are configured but carry no credentials, so packaged builds are unsigned. Windows SmartScreen will warn on first run. |
| **Medium** | The **Murmur** name has not been checked for trademark or app-store collisions. That must happen before anything is published. |
| **Low** | `package.json` is still at `0.3.1` while the changelog holds a milestone's worth of `Unreleased` change. A SemVer bump to `0.4.0` is owed but is a release decision, so it has not been made. |
| **Low** | On macOS and Linux a migrated profile loses its saved API key, because the secret lives in a keychain entry named after the application. Murmur says so and asks for the key again. This cannot be fixed from inside the app. |
| **Low** | Storage fault injection, retention pruning and export were not re-exercised by hand this run; their unit tests are the only evidence. |
| **Low** | One provider, one machine, one Windows version, one microphone, one non-elevated target application. |

---

## 6. Screenshots and verification documents

- `docs/screenshots/` — 23 captures, indexed in its own README.
- `docs/verification/windows-smoke.md` — runs 1 to 4, including what each run
  did *not* cover.
- `docs/platform-support.md` — capability and verification in separate tables,
  deliberately.
- `docs/design-requests.md` — the four requests made after the brief, each with
  what was asked, what was decided, and what it cost.
