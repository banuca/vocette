# App checks (e2e)

Scripts that launch the **built** Vocette with Playwright, drive it, and measure or screenshot
what it does. They are how a build is "checked in the app" before a hand test. They are not
unit tests: `npm test` does not run them, lint skips them, and the installer doesn't include them.

## Set-up, once

```sh
npm install --prefix e2e
```

The checks also need files that are kept out of git. They live in the work folder,
`%LOCALAPPDATA%\vocette-e2e` (override with `E2E_WORK`):

- `audio\a-itu-kirinde.wav`: the test recording, used as the fake microphone.
- `models\`: a copy of the on-device speech model (about 640 MB), so no check downloads it.
  Any installed model folder will do.
- `fake-polar-key.pem` and `fake-polar-cert.pem`: a self-signed certificate for 127.0.0.1, used only by
  `subscription-check` for its stand-in Polar server. To make a new one:
  `openssl req -x509 -newkey rsa:2048 -nodes -subj /CN=127.0.0.1 -keyout fake-polar-key.pem -out fake-polar-cert.pem -days 3650`.
- `profiles\` and the screenshot folders are created as the checks run.

## Running one

```sh
npm run build                 # the checks launch out/, not the sources
node e2e/quiet-check.mjs
```

- To check a packaged build instead, set `E2E_EXE` to its `win-unpacked\Vocette.exe`.
- Unset `ELECTRON_RUN_AS_NODE` first. VS Code sets it, and with it set Electron runs as plain
  Node. The harness drops it from the app's environment as well.
- Every check uses a fresh profile under the work folder (`MURMUR_PROFILE_DIR`), never the real
  one. The harness puts the clipboard back as it was when the app closes.

## The checks

| Script | What it looks at |
|---|---|
| `smoke-full` | Packaged build: model download into an empty folder, then one on-device dictation |
| `first-run` | What a brand-new user sees, with no speech model |
| `graphite-check` | Every page in light and dark, and the pill in each phase |
| `switch-check` | The sun and moon theme switch |
| `titlebar-check` | The window's title bar follows the theme (K1) |
| `engine-download-check` | Settings: picking "On this PC" and pressing Download saves the engine (S4) |
| `stats-narrow-check` | The History stats row at narrow widths and zoomed in, with screenshots (K2) |
| `zoom-check` | Ctrl + wheel and Ctrl + = / - / 0 zoom, remembered (K3) |
| `polishing-check` | "Polishing…" with its own clock, against a slow stand-in server (K4) |
| `rise-check` | The pill's Rise motion and live waveform (K5) |
| `pill-check` | Smoked glass over several backdrops, sized to its words (K10) |
| `polish-look-check` | Polishing looks different from transcribing (K10) |
| `quiet-check` | A paste that lands: the tick beat, the fold, back to rest (K10) |
| `resting-check` | The resting pill from start-up, springing open and back (K10) |
| `peek-check` | Point at the pill and it fades; away and it comes back. Moves the real pointer (K11) |
| `resting-switch-check` | The "Show the pill while idle" switch (K10) |
| `word-limit-check` | Free past its trial at 9,995 words: History line, the crossing take, the refused next take with its pause sign (N1) |
| `offer-check` | The Pro page during and after the launch offer (checkout never clicked) |
| `subscription-check` | Activation and renewal against a stand-in Polar over HTTPS |
