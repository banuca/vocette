# Security

## Reporting a vulnerability

Please open a [private security advisory](../../security/advisories/new) rather
than a public issue. Include what you did, what happened, and the version you
were running.

## Builds are not code-signed

Released binaries are unsigned, because code-signing certificates are not free.
On first run Windows SmartScreen will show *"Windows protected your PC"*. That
warning is about the missing signature, not about anything the app does.

Install a release only if you trust where you got it from. The alternative is to
build from source yourself:

```bash
npm install && npm run build:win
```

## What the app can do

Voice Hotkey needs two capabilities that are worth understanding before you run
it:

**A global keyboard hook.** `uiohook-napi` observes every keystroke system-wide,
which is how hold-to-talk works without the app being focused. Keystrokes are
only compared against your configured chord; nothing is logged, stored, or sent.
The hook cannot *consume* keystrokes, which is why a chord containing a character
key also reaches the focused app.

**Synthetic keystrokes.** With auto-paste on, the app sends `Ctrl + V` to
whatever window has focus after a dictation. Turn off **Paste automatically** in
Settings if you would rather paste yourself. The app checks the foreground
window at paste time: if focus moved during transcription, or the focused app
runs elevated (injected keystrokes cannot reach it anyway), it copies only and
tells you to paste manually.

**Foreground-window checks.** To make that decision the app reads the handle of
the foreground window and queries the elevation of its process via Win32 calls
through `koffi`. No window contents, titles, or input are read, and nothing is
stored. If the check cannot run, the app falls back to pasting as before.

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
- Transcript text is stored locally in `%APPDATA%\voice-hotkey\history.json`.
- Your API key is encrypted with Windows DPAPI through Electron's `safeStorage`,
  scoped to your Windows user account, and stored in
  `%APPDATA%\voice-hotkey\settings.json`.
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
  channel is restricted to the window that owns it.
- Custom API endpoints are validated: `https` only, except plain `http` for
  `localhost`/`127.0.0.1` so a local transcription server can be used without
  leaking the key over the network.
