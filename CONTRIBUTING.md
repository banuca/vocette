# Contributing

Thanks for taking an interest in Vocette! It is a small, deliberately
boring codebase: plain TypeScript, no UI framework, no global state beyond the
two JSON stores. The goal is a dictation tool anyone can read in an afternoon
and trust.

## Ground rules

- **Cross-platform, honestly.** Windows, macOS and Linux (X11 and Wayland) are
  all targets. Every one of them must be able to open the app, configure a
  provider, record from the window, transcribe, copy and keep local history.
  A global hook or a tray is never a requirement for basic use.
- **Say what the platform cannot do; never fake it.** If a desktop cannot give
  us key-release events, hold-to-talk is reported unavailable — it is not
  simulated from a press callback. If the paste target cannot be identified,
  the transcript is copied and the user is told, rather than typed somewhere
  it might not belong.
- **Capability and preference are separate.** A capability that is missing now
  must never overwrite what the user chose. They may be on a different desktop
  tomorrow.
- **No privileged input.** No input daemon, no `uinput` group, no running as
  administrator or root, on any platform.
- **No telemetry, no analytics, no automatic updates.** Ever. The one update
  request is GitHub's latest-release lookup, and it runs only when the user has
  switched the check on or pressed Check now. This is part of the privacy
  contract in [SECURITY.md](SECURITY.md).
- **Renderers stay sandboxed.** Keep `contextIsolation: true`, `sandbox: true`
  and the restrictive CSP; all network access stays in the main process.
- **Never write a credential somewhere it is not really protected.** If the OS
  cannot encrypt it, offer the session-only key instead.
- **New behaviour ships with tests.** The dictation phase machine in
  `src/main/dictation-controller.ts` exists because it was untested and hid the
  two worst bugs; do not add branches to it without tests.

## Setup

Requires Node 22.12+ and npm 10+.

```bash
npm install
npm run dev     # run against the dev server, with HMR
npm test        # vitest
npm run typecheck
npm run lint
```

Packaging happens on the target platform, because the native prebuilds are
selected at install time and cannot be cross-built:

```bash
npm run build:win     # or build:mac / build:linux
node scripts/check-native-packaging.mjs
```

## The moving parts

| Where | What |
| --- | --- |
| `src/main/platform/` | The desktop boundary: `types.ts` defines it, `windows.ts` / `macos.ts` / `linux.ts` implement it, `index.ts` picks one. Global shortcuts, paste targets, key injection, permissions, launch-at-login. |
| `src/main/dictation-controller.ts` | The hold/toggle → starting → recording → processing → success/cancelled/error phase machine, with watchdogs. Dependency-injected so it is fully unit-testable. |
| `src/main/shortcut-controller.ts` | The keyboard-hook backend: chord matching, exclusivity, hold delay, capture mode. |
| `src/main/platform/accelerator-backend.ts` | The desktop-portal backend, for Wayland. Press only — it never claims hold support. |
| `src/main/secure-storage.ts` | Whether this system can hold a credential at all. |
| `src/main/atomic-json.ts` | Crash-safe JSON writes with backup recovery. |
| `src/renderer/recorder.ts` + `audio-prep.ts` | Mic capture in a hidden window; silence trimming and 16 kHz WAV encoding. |
| `src/renderer/recording-control.ts` | The Record/Stop/Cancel control, as a pure state function plus a thin view. |
| `src/renderer/theme.ts` | The palette: one attribute on `<html>`, every colour a custom property, and the sidebar switch. The overlay is told the theme over `app:theme`, being a separate document. |
| `src/renderer/setup-guide.ts` | First-run guidance, derived from what is genuinely outstanding. |
| `src/shared/capabilities.ts` | The capability vocabulary shared by both processes. |

## Adding a platform capability

1. Add it to `CAPABILITY_IDS` in `src/shared/capabilities.ts`.
2. Report it from every adapter — including the fallback one — with a sentence
   a person can act on, and a settings pane if the OS has one.
3. Derive behaviour from it in one place, and let the renderer show the reason.
4. Cover the new branch in `tests/platform-adapters.test.ts`.

## Evidence rules

These matter more than usual here, because most of the platform code cannot be
exercised by whoever wrote it.

- A mocked platform test is **not** an OS pass. A configured CI job is **not**
  an OS pass.
- Never mark macOS or Linux verified from a Windows machine, or the reverse.
  [docs/platform-support.md](docs/platform-support.md) keeps capability and
  verification in separate tables for exactly this reason; update it with your
  change.
- Fakes must behave like the real API. The Windows auto-paste defect that
  shipped in 0.3.1 survived a full test suite because the koffi fake returned
  bigints where real koffi returns opaque pointer objects. If you fake a native
  boundary, fake its awkward parts.
- Do not claim more than the evidence supports. "2,000 calls succeeded" is not
  "there is no handle leak"; say what was actually observed.

## Before you open a PR

1. `npm test`, `npm run typecheck`, and `npm run lint` must all pass.
2. `npm run build` must complete.
3. Update [CHANGELOG.md](CHANGELOG.md) under an `Unreleased` heading and bump
   the version in `package.json` following [SemVer](https://semver.org/).
4. If you changed user-facing behaviour, reflect it in [README.md](README.md),
   [SECURITY.md](SECURITY.md) and
   [docs/platform-support.md](docs/platform-support.md) where relevant.

## Notes on the weird bits

- **koffi returns opaque pointer objects, not numbers.** `koffi.address()` is
  the only way to get a comparable value out of one, and a fresh wrapper comes
  back on every call — so handles are compared by address, never by identity.
  `src/main/platform/native-address.ts` holds that logic for all three
  platforms.
- **Win32 `BOOL` is a 32-bit int**, not koffi's single-byte `bool`, and
  `PHANDLE` is a pointer *to* a handle. `tests/foreground.test.ts` asserts the
  declarations, because getting either wrong fails silently.
- **The keycode table in `src/shared/keycodes.ts`** duplicates
  `uiohook-napi`'s enum because the renderer cannot load native modules.
  `tests/keycodes.test.ts` keeps the two in sync; if you add keys, add them to
  both.
- **`uIOhook` events are typed loosely upstream** — see `hookErrors()` in
  `src/main/shortcut-controller.ts` for the `error` listener, which is attached
  per start and removed per stop so a hook put back after sleep reports once.
- **The overlay stylesheet does not transition colours that come from custom
  properties.** Chromium does not reliably re-target such a transition, and the
  badge silently kept the previous phase's colour when it did.

## Sign your commits (Developer Certificate of Origin)

Vocette is sold as well as given away, so every contribution needs a clear
right to include it. By signing off a commit you certify the
[Developer Certificate of Origin](https://developercertificate.org/): that you
wrote the change, or otherwise have the right to submit it under the project's
licence. Sign off with:

```bash
git commit -s
```

which adds a `Signed-off-by: Your Name <you@example.com>` line with the name
and email from your Git configuration. Pull requests with unsigned commits
cannot be merged; `git commit --amend -s` or `git rebase --signoff` fixes them.

## Code of conduct

Be kind. This is a spare-time project; assume good faith, keep reviews about
the code, and remember the person on the other side may be dictating into it
right now.
