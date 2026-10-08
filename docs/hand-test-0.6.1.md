# Hand test 0.6.1, the small fixes (Claude's notes)

Build: `%LOCALAPPDATA%\vocette-release\0.6.1\Vocette-0.6.1-win-x64.exe`, built at 81da23a on
`go-live`, unsigned. It installs over 0.6.0; the profile is untouched. K1 (title bar) already
passed on 0.6.0.

Checked before handing over: tsc, lint, 1,507 tests.
- K6/K7: the makensis defines `COMPANY_NAME=Vocette` and `UNINSTALL_DISPLAY_NAME=Vocette`;
  the exe's CompanyName is Vocette.
- K3, in the built app: Electron's wheel-zoom event and Ctrl + -/0 step through 1 → 1.1 → 1.25
  → 1.5 → 1.25. The pill stays at 1. The size survives a restart, and Ctrl+0 resets it.
  Not checked: a physical mouse wheel, which can't be synthesised.
- K4, in the built app against a 1.5 s stand-in server: Transcribing, then Polishing with a
  clock from 0.0s to 1.5s, then success; the overlay was screenshotted.

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Install 0.6.1 over 0.6.0; look in Settings → Apps → Installed apps | "Vocette", publisher Vocette, version 0.6.1 | |
| 2 | Ctrl + mouse wheel up and down in the main window; Ctrl + 0 | Grows and shrinks in steps; resets | |
| 3 | Zoom in, quit, reopen | Opens at the same size | |
| 4 | Polish on: dictate 8 or more words | "Polishing…" with a running clock, then pasted | |
| 5 | Polish on: dictate under 8 words | No "Polishing…"; pasted straight away | |
