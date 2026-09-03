# Contributing

Thanks for taking an interest in Voice Hotkey! It is a small, deliberately
boring codebase: plain TypeScript, no UI framework, no global state beyond the
two JSON stores. The goal is a dictation tool anyone can read in an afternoon
and trust.

## Ground rules

- **Windows-first.** The product targets Windows; keep changes working there.
- **No telemetry, no analytics, no auto-update calls.** Ever. This is part of
  the privacy contract in [SECURITY.md](SECURITY.md).
- **Renderers stay sandboxed.** Keep `contextIsolation: true`, `sandbox: true`
  and the restrictive CSP; all network access stays in the main process.
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

## The moving parts

| Where | What |
| --- | --- |
| `src/main/dictation-controller.ts` | The hold → starting → recording → processing → success/error phase machine, with watchdogs. Dependency-injected so it is fully unit-testable. |
| `src/main/shortcut-controller.ts` | The global hook: chord matching, exclusivity, hold delay, capture mode. |
| `src/main/atomic-json.ts` | Crash-safe JSON writes with backup recovery. |
| `src/renderer/recorder.ts` + `audio-prep.ts` | Mic capture in a hidden window; silence trimming and 16 kHz WAV encoding. |
| `src/renderer/pages/` | The three main-window pages, rendered from plain DOM. |

## Before you open a PR

1. `npm test`, `npm run typecheck`, and `npm run lint` must all pass.
2. `npm run build` must complete.
3. Update [CHANGELOG.md](CHANGELOG.md) under an `Unreleased` heading and bump
   the version in `package.json` following [SemVer](https://semver.org/).
4. If you changed user-facing behaviour, reflect it in [README.md](README.md)
   and [SECURITY.md](SECURITY.md) where relevant.

## Notes on the weird bits

- **`require('koffi')` in `foreground.ts`** is intentional: the main bundle is
  CommonJS, and koffi is only needed for the Win32 foreground-window checks.
  It fails open (paste proceeds as before) if the module cannot load.
- **The keycode table in `src/shared/keycodes.ts`** duplicates
  `uiohook-napi`'s enum because the renderer cannot load native modules.
  `tests/keycodes.test.ts` keeps the two in sync; if you add keys, add them to
  both.
- **`uIOhook` events are typed loosely upstream** — see the cast in
  `ShortcutController.start()` for the `error` listener.

## Code of conduct

Be kind. This is a spare-time project; assume good faith, keep reviews about
the code, and remember the person on the other side may be dictating into it
right now.
