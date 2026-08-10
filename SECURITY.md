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
Settings if you would rather paste yourself.

## Where your data goes

- Completed recordings are sent to `https://api.openai.com/v1/audio/transcriptions`
  using your own API key, and to no other host.
- Audio is never written to disk. The in-memory buffer is zeroed after the request.
- Transcript text is stored locally in `%APPDATA%\voice-hotkey\history.json`.
- Your API key is encrypted with Windows DPAPI through Electron's `safeStorage`,
  scoped to your Windows user account, and stored in
  `%APPDATA%\voice-hotkey\settings.json`.
- There is no telemetry, no analytics, and no auto-update channel.

## Hardening in place

- All three windows: `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`.
- A restrictive CSP on every renderer, with `connect-src 'none'` — the network
  call is made from the main process, not from a renderer.
- `window.open` and navigation away from the bundled page are denied.
- Only the `media` permission is granted; every other permission request is
  refused.
- IPC inputs are validated and length-bounded in the main process.
