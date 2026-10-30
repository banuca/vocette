# Platform support and verification

What Vocette can do on each desktop, and — separately — what has actually
been run there. The two are not the same thing and are never merged in this
document.

Evidence classes used below:

| Class | Meaning |
|---|---|
| **Verified** | Exercised on that operating system, by hand or by a native probe, and the result recorded. |
| **Automated** | Covered by unit tests against a fake of the platform API. Proves the logic, proves nothing about the OS. |
| **Not tested** | Implemented and type-checked, never executed on that operating system. |

A configured CI job is not an OS pass. A mocked platform test is not an OS
pass. Neither macOS nor Linux is called verified from a Windows machine.

## Capability matrix

| Capability | Windows | macOS | Linux / X11 | Linux / Wayland |
|---|---|---|---|---|
| Open the app, configure a provider, record from the window, transcribe, copy, local history | Yes | Yes | Yes | Yes |
| Global hold-to-talk (press **and** release) | Yes | Yes, with Input Monitoring | Yes | **No** — the compositor does not let an application watch the keyboard |
| Global press-to-start/stop shortcut | Yes | Yes, with Input Monitoring | Yes | Yes, through the desktop portal |
| Recording a shortcut from live keystrokes | Yes | Yes | Yes | **No** — pick a quick-pick chord instead |
| Paste-target verification | Window handle | Frontmost **application** | Focused X window | **No** |
| Refuses to paste into a blocked target | Elevated process (UIPI) | Secure input active | n/a — X11 has no such barrier | n/a — never pastes |
| Automatic paste | `Ctrl + V` | `Command + V`, with Accessibility | `Ctrl + V` | **No** — clipboard only |
| Tray | Yes | Yes | Desktop-dependent | Desktop-dependent |
| Launch at login | Yes | Yes | Yes (autostart entry; AppImage path handled) | Yes |
| OS-backed key storage | DPAPI | Keychain | libsecret / KWallet, else session-only | libsecret / KWallet, else session-only |
| On-device transcription (sherpa-onnx, Parakeet v3) | Yes, x64 | Yes, Apple silicon | Yes, x64 | Yes, x64 |

Where a capability is missing the app says so in its own words, in Settings and
in the first-run guidance, and keeps working with the Record button and the
clipboard. A missing capability never overwrites the user's stored preference.

### The Wayland position, stated plainly

Wayland deliberately prevents an application from watching the keyboard,
learning which surface has focus, or typing into another window. Vocette
does not work around that. It registers a start/stop shortcut with the desktop
portal, reports hold-to-talk as unavailable rather than faking a key release it
never receives, and delivers every transcript to the clipboard. No privileged
input daemon, no `sudo`, no `uinput` group.

## Verification status

**19 October 2026, branch `go-live`.** CI's engine check ran the packaged app's speech engine
on two public recordings and got the right text on Windows (AMD EPYC 7763), macOS (Apple M1,
virtual) and Linux (AMD EPYC 9V45), in run 39300274141. The Mac build is now Apple silicon only,
with an ad-hoc signature that CI verifies on the app and on the DMG (run 39329076117). Version
0.8.0-beta.1 is published as a GitHub pre-release with the Windows, macOS (Apple silicon) and
Linux (x64) files. Still not done: running any of it on a real Mac or Linux PC.

**8 October 2026, branch `go-live`, GitHub Actions run 37781426122** (after the repository was
renamed to `banuca/vocette`). Verify — typecheck, lint, 1,498 tests and the bundle — passed on
`windows-latest`, `macos-latest` (Apple Silicon) and `ubuntu-latest`. Package passed on all
three, with `--publish never`: Mac DMG and zip for arm64 and x64 (unsigned), Linux AppImage and
deb (x64), and the Windows installer and zip. On each, `check-native-packaging` reported
"Native packaging looks correct". Not yet done on any of them: running on real hardware. The Mac
build is for the owner's brother's Mac and the Linux build for the owner's Linux machine. The
x64 Mac build was made on an Apple Silicon runner, so its native modules are unproven on an
Intel Mac.

The table below is from 28 September and predates these runs.

Last updated 28 September 2026, branch `launch`. The per-feature evidence for 0.5.0
is in [launch-plan.md](launch-plan.md) §7.

| Check | Windows 11 (x64) | macOS | Linux X11 | Linux Wayland |
|---|---|---|---|---|
| Unit suite (64 files, 1438 tests) | Verified | Not tested | Not tested | Not tested |
| Typecheck, lint, `electron-vite build` | Verified | Not tested | Not tested | Not tested |
| Platform adapter logic | Automated | Automated | Automated | Automated |
| Native target verification | **Verified** (native probe) | Not tested | Not tested | n/a |
| Real dictation, end to end | **Verified** (manual) | Not tested | Not tested | Not tested |
| Automatic paste into an unchanged target | **Verified** (manual) | Not tested | Not tested | n/a |
| Refusal on a changed target | **Verified** (manual) | Not tested | Not tested | n/a |
| Refusal on a blocked target | **Verified** (manual, elevated) | Not tested | n/a | n/a |
| On-device engine: model download, verification, dictation | **Verified** (built app, fake microphone) | Not tested | Not tested | Not tested |
| Packaging | **Verified** (NSIS + zip, `npm run release:win`) | Not tested | Not tested | Not tested |
| Packaged app starts and dictates on-device | **Verified** (unpacked and installed) | Not tested | Not tested | Not tested |
| Silent install and uninstall, user data kept | **Verified** | n/a | n/a | n/a |
| Rendered dark interface, 100% and 150% | **Verified** (captured) | Not tested | Not tested | Not tested |

Only Windows has been exercised on real hardware. Everything in the macOS and
Linux columns is implemented, type-checked and unit-tested against fakes. Since
this table, CI has run the unit tests, the packaging and the packaged app's
speech engine on macOS and Linux (the entries above); nothing else in those
columns has been run on that operating system. See
[verification/windows-smoke.md](verification/windows-smoke.md) for the Windows
evidence.

## What remains, and how to run it

Each of these needs a machine running that operating system. No credentials or
paid services are involved.

### macOS (Apple silicon)

```bash
npm ci
npm run build          # typecheck, tests, bundle
npm run pack:mac       # dmg + zip, arm64, ad-hoc signature
node scripts/check-native-packaging.mjs
open "dist/mac-arm64/Vocette.app"
```

Then, in order:

1. Grant **Input Monitoring** when the first-run guidance offers the button;
   confirm the shortcut capability flips to available without a restart.
2. Grant **Accessibility**; confirm automatic paste becomes available.
3. Dictate into TextEdit with the shortcut and confirm exactly one paste.
4. Switch application mid-transcription; confirm "focus moved" and no paste.
5. Focus a password field (secure input) and dictate; confirm the refusal.
6. Confirm `Command + V` is the chord shown in Settings, not `Ctrl + V`.

### Linux, X11 session

```bash
npm ci && npm run build && npm run pack:linux
node scripts/check-native-packaging.mjs
./dist/Vocette-*-linux-x86_64.AppImage
```

1. Confirm hold-to-talk starts and stops from the shortcut.
2. Dictate into a text editor; confirm exactly one paste.
3. Switch window mid-transcription; confirm "focus moved" and no paste.
4. Confirm `XGetInputFocus` is being used by turning off the display server's
   focus-follows-mouse and repeating step 3.

### Linux, Wayland session

1. Confirm Settings reports hold-to-talk unavailable, with the Wayland reason,
   and that the stored preference is still `hold`.
2. Set a shortcut containing an ordinary key (a quick pick) and confirm the
   portal registers it; confirm a modifier-only chord is refused with the
   "needs one ordinary key" message.
3. Confirm one press starts and the next stops.
4. Confirm every transcript is copied and nothing is ever typed into another
   window.
5. Confirm the launcher icon associates with the window (`StartupWMClass`).

### Signing and notarisation

Configured, never credentialled. Set `CSC_LINK` and `CSC_KEY_PASSWORD` for
Windows or macOS signing, and `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and
`APPLE_TEAM_ID` plus `mac.notarize: true` for notarisation. Nothing in this
repository invents or stores a credential. CI does not publish: a version tag
produces a draft release that a person checks and publishes ([release.md](release.md)).
