# Security

## Reporting a vulnerability

Please open a [private security advisory](../../security/advisories/new) rather
than a public issue. Include what you did, what happened, and the version you
were running.

## Builds are not code-signed or notarised

Released binaries are unsigned, because code-signing certificates are not free.
On first run Windows SmartScreen will show *"Windows protected your PC"*, and
macOS Gatekeeper will refuse to open the app until you allow it from Privacy &
Security. Both warnings are about the missing signature, not about anything the
app does.

The signing and notarisation configuration is present in
`electron-builder.yml`, deliberately without credentials. Nothing in this
repository stores, invents or requires one, and CI never publishes.

Install a release only if you trust where you got it from. The alternative is to
build from source yourself:

```bash
npm install
npm run build:win     # or build:mac / build:linux, on that platform
```

## What the app can do

Murmur asks the operating system for a few things that are worth
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
Murmur does not try to obtain one by other means — no privileged input
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

## Where your data goes

- Completed recordings are sent to `https://api.openai.com/v1/audio/transcriptions`
  using your own API key — or, if you configured one, to your custom
  OpenAI-compatible endpoint — and to no other host.
- Audio is never written to disk. The in-memory buffer is zeroed after the
  request. A failed transcription keeps the recording in memory so **Retry last
  dictation** can resend it; it is zeroed when a new take starts, when the
  retry succeeds, and on quit.
- Before upload, audio is trimmed and re-encoded locally; the trimmed buffer
  is also zeroed once the request completes.
- Transcript text is stored locally in the app's own data folder — on Windows
  `%APPDATA%\Murmur\history.json`,
  beside the `.bak` and `.tmp` recovery copies Murmur manages for it.
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
  encrypted would be a lie. Murmur refuses to save there and instead
  offers a clearly labelled **session-only key**: held in main-process memory,
  never written to disk, never exposed through public settings or diagnostics,
  and gone when the app quits. Unlocking a keyring and saving again is the
  other option, and the app says so.
- There is no telemetry, no analytics, and no auto-update channel.

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
