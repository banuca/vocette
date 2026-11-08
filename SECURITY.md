# Security

## Reporting a vulnerability

Please open a [private security advisory](../../security/advisories/new) rather
than a public issue. Include what you did, what happened, and the version you
were running.

## Builds are not code-signed yet

Released Windows binaries are unsigned until a code-signing certificate is in
place. On first run Windows SmartScreen will show *"Windows protected your PC"*;
the warning is about the missing signature, not about anything the app does.
macOS (Apple silicon) and Linux (x64) builds are published as betas. The macOS
build carries an ad-hoc signature: it proves the files have not changed since the
build, but it is not tied to an Apple Developer ID and is not notarised, so
macOS says it is from an unidentified developer until you choose **Open
Anyway** in System Settings → Privacy & Security.

The signing and notarisation configuration is present in
`electron-builder.yml`, deliberately without credentials. Nothing in this
repository stores, invents or requires one. CI does not publish: from a version
tag it puts the files into a draft release, which stays invisible until a person
checks and publishes it ([docs/release.md](docs/release.md)).

Install a release only if you trust where you got it from. The alternative is to
build from source yourself:

```bash
npm install
npm run release:win   # see docs/release.md
```

## What the app can do

Vocette asks the operating system for a few things that are worth
understanding before you run it. What it is granted differs by platform, and
what it does when it is refused is the same everywhere: it says so and carries
on with the Record button and the clipboard.

**A global keyboard hook.** On Windows, macOS and Linux/X11, `uiohook-napi`
observes every keystroke system-wide, which is how hold-to-talk works without
the app being focused. Keystrokes are only compared against your configured
chord; nothing is logged, stored, or sent. The hook cannot *consume*
keystrokes, which is why a chord containing a character key also reaches the
focused app. On macOS this needs **Input Monitoring**, which you grant
explicitly; the app links to the pane and works from its own window until you
do.

On Wayland there is no hook at all. The compositor does not permit one, and
Vocette does not try to obtain one by other means — no privileged input
daemon, no `uinput` group, no running as root. It registers a start/stop
shortcut with the desktop portal instead.

**Synthetic keystrokes.** With auto-paste on, the app sends the platform's
paste chord — `Ctrl + V`, or `Command + V` on macOS — to whatever window has
focus after a dictation. On macOS this needs **Accessibility**. Turn off **Paste
automatically** in Settings if you would rather paste yourself. On Wayland the
option is disabled outright, because typing into another window is not
something a Wayland client can do.

**Paste-target checks.** Before any keystroke is injected the app asks where it
would land, and refuses unless the answer is the target you started with:

- **Windows** reads the foreground window handle and queries the elevation of
  its process (`GetForegroundWindow`, `OpenProcess`, `OpenProcessToken`,
  `GetTokenInformation`). Injected keystrokes cannot reach an elevated window,
  so an elevated target is refused.
- **macOS** reads the frontmost *application's* process id through
  `NSWorkspace`, and refuses while `IsSecureEventInputEnabled()` reports that
  macOS is blocking synthetic keystrokes — a password field, for instance. This
  is application-level, not window-level: moving between two windows of the
  same application is not detected. That is a real difference from Windows and
  is stated in the interface rather than smoothed over.
- **Linux/X11** reads the focused window with `XGetInputFocus`. There is no
  elevation equivalent: on X11 any client that can reach the display can send
  events to any window, so there is no state in which a paste would be silently
  swallowed.
- **Wayland** cannot answer the question at all, so delivery is clipboard-only.

All of this goes through `koffi`, which needs no build toolchain. No window
contents, titles, or input are read, and nothing is stored. If a check cannot
run, the answer is "unknown" and the app leaves the transcript on the clipboard
— it never falls open.

**Focus is never taken back.** The app will not raise, activate or restore a
window to make a paste succeed.

## Every network request the app can make

This is the complete list. Each one happens only when stated.

1. **Speech model download** — once, when the user presses **Download**: the
   model files from `github.com` (assets of the `model-parakeet-v3-q8-2`
   pre-release of `banuca/vocette`, served from GitHub's download host),
   through Electron's network stack. They are Vocette's int8 build of
   `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3` (`e2e/bench/to-int8.py`). Every file is checked against a pinned SHA-256 before first
   use, and a `verified.json` marker records the check. Stored in
   `%LOCALAPPDATA%\Murmur\models` on Windows. Nothing is sent but the requests
   for those files.
2. **Updates** — the check only if the user turned it on (the first-run card
   offers it ticked; About has the switch), then at most once a day, or pressed
   **Check now**: one GET to
   `https://api.github.com/repos/<repository>/releases/latest` with no cookies or
   credentials. Only the tag and the release link are read. The update itself
   only when the user presses **Download and install** (About or the tray), and
   only for the Windows installer and the Linux AppImage: electron-updater
   (`src/main/app-updater.ts`) reads the repository's release feed on
   `github.com`, then the release's update file (`latest.yml`, or `beta.yml`
   for a beta) and the installer it names with its blockmap, and checks the
   installer's SHA-512 before running it. A downloaded update installs on
   **Restart to update** or when Vocette next quits. On a Mac or with the
   `.deb`, Vocette opens the release page instead.
3. **Cloud transcription** — only with **Cloud** chosen: each recording, with the
   vocabulary, to the endpoint the user configured, with their key.
4. **AI polish** — only if switched on: the cleaned text of each dictation (never
   audio), with the style, the user's extra instructions and up to 100 vocabulary
   terms, to the chat endpoint the user configured.
5. **Opt-in counts** — only if the user ticked **Help improve Vocette** (first-run card
   or About; off by default): at most one POST a day to
   `https://counts.vocette.com/v1/report` with no cookies and the User-Agent `Vocette`,
   carrying exactly `v`, `os`, `engine`, `plan`, `week`, `activeDays7`, `dictations7` and
   `limitHit` (`src/shared/usage-counts.ts`). `plan` is always `free` and `limitHit`
   always `false`: Vocette has no plans or limits, and the Worker still requires both
   fields. No identifier of any kind. The Worker
   (`server/counts`) accepts only that shape and stores it with the UTC day; it stores no
   IP or headers and has request logging off. Development builds send only to
   `MURMUR_COUNTS_URL`. Switching off deletes the local seven-day tally.

Nothing else. No crash reporting, no automatic updates, and no analytics beyond the
opt-in counts. The diagnostics log (`diagnostics.json` in the profile folder,
`src/main/diagnostics-log.ts`) is local only: typed events with fixed fields, the newest
500, and no field that can hold dictated text, audio, window or app names, vocabulary,
keys or endpoints. It leaves the PC only when the user presses
**Copy diagnostics** and pastes the report somewhere themselves. With the on-device engine and none of the optional features switched
on, audio and text never leave the computer.

## Where your data goes

- With the on-device engine, audio is transcribed by sherpa-onnx in a separate
  utility process on this PC; it is never sent anywhere.
- With the cloud engine, completed recordings are sent to
  `https://api.openai.com/v1/audio/transcriptions` using your own API key — or,
  if you configured one, to your custom OpenAI-compatible endpoint — and to no
  other host.
- **Your vocabulary is sent with them.** The terms in Settings > Your words go
  to the same endpoint on every dictation, either in the request's `keywords`
  field or appended to its transcription prompt. That is what makes them
  work. Anything typed into that box is disclosed to the provider you
  configured, so it is not a place for a secret. It is stored in
  `settings.json` in plain text, and it is not stored anywhere else.
- Audio is never written to disk. The in-memory buffer is zeroed after the
  request. A failed transcription keeps the recording in memory so **Retry last
  dictation** can resend it; it is zeroed when a new take starts, when the
  retry succeeds, and on quit.
- Before upload, audio is trimmed and re-encoded locally; the trimmed buffer
  is also zeroed once the request completes.
- Transcript text is stored locally in the app's own data folder — on Windows
  `%APPDATA%\Murmur\history.json`,
  beside the `.bak` and `.tmp` recovery copies Vocette manages for it.
  Deleting an entry, clearing history, and a retention pass that does remove
  expired entries all scrub those copies before reporting success.
- A `history.json` that cannot be parsed is preserved as
  `history.json.corrupt` rather than overwritten, so a crash mid-write cannot
  silently destroy your history. Retention cannot prune that copy entry by
  entry, because its contents could not be parsed, so it is kept for now as a
  whole and the startup warning names it. A later cleanup deletes the whole
  file: an explicit deletion, a retention pass that does find expired entries,
  or — with retention enabled — the next startup once the primary file is
  readable again. Copy it somewhere else first if you need it to recover
  anything.
- A retention pass that fails is reported and stays retryable, and does not
  stop the app from starting. The failure can land after some writes or
  companion cleanup have gone through, so completion is never claimed: expired
  data may remain until a later attempt succeeds.
- Your API key is encrypted at rest by the operating system through Electron's
  `safeStorage` — DPAPI on Windows, the Keychain on macOS, libsecret or KWallet
  on Linux — scoped to your user account, and stored in the app's
  `settings.json`. On Windows that remains
  `%APPDATA%\Murmur\settings.json`.
- **Where the operating system has no storage fit to hold a credential, the
  key is not written at all.** On Linux without an unlocked keyring,
  `safeStorage` falls back to a backend called `basic_text`, which encrypts
  with a hard-coded key. That is obfuscation, not encryption, and calling it
  encrypted would be a lie. Vocette refuses to save there and instead
  offers a clearly labelled **session-only key**: held in main-process memory,
  never written to disk, never exposed through public settings or diagnostics,
  and gone when the app quits. Unlocking a keyring and saving again is the
  other option, and the app says so.
- AI polish (off by default) sends the cleaned text of a dictation — never audio — to
  the chat endpoint the user configured, with their style, extra instructions and up to 100
  vocabulary terms. The transcript is the user message; the system prompt says it is text to
  rewrite, never instructions to follow, and the reply is used only if it passes a guard
  (no assistant preamble, no reply far longer or shorter than the input). The polish key is
  stored with `safeStorage` like the transcription key and never crosses into a renderer;
  the transcription key is borrowed only when both endpoints are OpenAI's.
- Earlier versions sold a Pro subscription and could keep its licence key in
  `settings.json`. This version never reads or sends it: the first time it opens such
  a profile, it writes `settings.json` without the key and scrubs the recovery copies
  that may still hold it.
- There is no telemetry beyond the opt-in counts (off by default, no identifier; see
  the list above). The update check (off until the user turns it on) sends one GET
  to `https://api.github.com/repos/<repository>/releases/latest` with no cookies or
  credentials, reads only the tag and the release link, and never downloads anything
  itself; the link it opens must be a release page of that repository. An update is
  downloaded only when the user presses **Download and install** (item 2 above).

## Hardening in place

- All three windows: `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`.
- A restrictive CSP on every renderer, with `connect-src 'none'` in production
  builds — the network call is made from the main process, not from a renderer.
  (Development builds allow the Vite HMR websocket only.)
- `window.open` and navigation away from the bundled page are denied.
- Only the `media` permission is granted; every other permission request is
  refused.
- IPC inputs are validated and length-bounded in the main process, and every
  channel is restricted to the window that owns it. That includes the recording
  commands (`dictation:start` / `stop` / `cancel`) and the platform capability
  channels, which are refused from any window but the main one.
- Capability state crossing the bridge carries a state, a sentence, and at most
  the name of an OS settings pane — never a handle, a path, a process id or a
  raw native error.
- Every native integration is loaded lazily and degrades to a reported
  capability. A missing library, a refused permission or an absent desktop
  service cannot stop the window opening.
- Custom API endpoints are validated: `https` only, except plain `http` for
  `localhost`/`127.0.0.1` so a local transcription server can be used without
  leaking the key over the network.
