# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-08-10

The first published source release. `0.1.0` existed only as an unsigned Windows
preview build; everything below is relative to it.

### Added

- **Custom shortcuts.** Any 1–4 key chord, recorded by clicking **Change** and
  holding the keys. Captured through the same global hook that matches it, so
  left and right modifiers are distinguished. Quick-pick buttons for the common
  chords, and inline validation that rejects unusable chords and warns about
  chords with side effects.
- **Hold delay** (default 250 ms) so a chord that is a prefix of a longer
  shortcut no longer fires. Configurable, including off.
- **Exclusivity rule** for chord matching: a chord never fires while a modifier
  outside it is held.
- Tray item **Reset shortcut state**, to recover from a key-up missed while an
  elevated window had focus.
- Crash-safe JSON storage with backup recovery, and a warning dialog when a data
  file had to be recovered.
- Watchdogs on the microphone-start and recording-stop steps.
- Unit tests (84) covering chord matching and validation, settings migration,
  atomic writes, text cleanup, history storage, and keycode-table drift.

### Changed

- **Default shortcut is now Left Ctrl + Left Shift** (was Left Ctrl + Left Alt).
  Existing settings are migrated and keep the shortcut you were using.
- Settings files move to version 2, storing keycodes instead of one of three
  preset ids. Migration preserves the encrypted API key.
- The overlay is a redesigned, separate entry point: breathing halo rings while
  listening, a spinner while transcribing, a check on success, and an entrance
  and exit animation. It no longer loads the entire settings/history app — the
  overlay bundle went from 32 kB of JS to 1.2 kB. Animation is limited to
  `transform` and `opacity`, with no audio analysis and no per-frame IPC.
- History updates in place instead of rebuilding the page, so a dictation
  arriving while you type in the search box no longer steals focus.
- Dates follow your Windows regional format instead of being fixed to en-GB.
- History is written asynchronously and compactly.
- The About page no longer names a competing product.

### Fixed

- **The hotkey could stop working until restart.** If the microphone never
  reported back, the app stayed in its `starting` phase forever and every later
  press was ignored. Now watchdogged, with a `getUserMedia` timeout.
- **A lost stop request wedged a recording permanently.** The five-minute
  failsafe called the same guarded function that had already run, so it could
  never finish the take. Stop requests and forced stops are now separate paths.
- **The recorder silently ignored a stop it did not recognise**, leaving the main
  process waiting forever. Every stop now produces a reply.
- **A crash mid-write could destroy all history and the saved API key.** Writes
  were not atomic and a parse failure silently fell back to empty defaults,
  which the next write made permanent. Writes are now atomic with a backup, and
  a damaged file is preserved rather than overwritten.
- **Up to 4.5 s of dead time between dictations**, because the shortcut was
  ignored while a success or error message was still on screen.
- `model` and `language` were written to disk but never read back, so they could
  not be changed or persisted.
- The API-key badge still read “Key required” after a key was saved.
- Clearing history left the list and totals stale.
- Microphone names showed as “Microphone 1”, “Microphone 2” until you pressed
  refresh, because device labels require a granted permission in that document.
- A saved microphone that was temporarily unplugged was silently reset and then
  saved over, permanently losing the choice.
- The tray’s hold-to-talk toggle reset to on after every restart.
- Navigation from the tray could be dropped on a cold start; the renderer now
  announces when it is ready instead of the main process guessing with a timeout.
- `Ctrl + Alt + Space` was labelled without saying it meant the left-hand keys.
  Labels are now generated from the actual keycodes.
- Auto-paste's synthetic `Ctrl + V` was fed back into the app's own hook.
- `frame-ancestors` in a `<meta>` CSP is ignored by Chromium and logged a console
  error on every launch; replaced with `frame-src` and `child-src`.
- The sticky Save bar in Settings overlapped the fields behind it.
- The overlay's phase colours were stuck on whichever phase appeared first,
  because Chromium does not re-target a transition that reads a custom property.
- Navigation and `window.open` are now denied on all three windows, not just the
  main one; the API-key length is bounded; the keyboard hook has an error
  listener so a native fault cannot take the app down.

## [0.1.0] — 2026-08-04

- Unreleased Windows x64 preview build. Not published as source.
