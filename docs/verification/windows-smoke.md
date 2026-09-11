# Windows dictation smoke test

Manual, on-device verification of the real dictation workflow: microphone →
transcription provider → clipboard → automatic paste → History persistence.
Automated tests and mocked runs are recorded separately from native and manual
evidence, and never count as a manual pass.

Branch `fix/v0.3.2-safety`, HEAD `941a4d9`, with the uncommitted safety,
storage and save-warning work in the tree throughout.

## Test isolation

All runs use an external launcher held outside the repository, started as
`electron.exe <launcherDir>` with its own `package.json`. Before the app is
required it:

- sets `userData` and `sessionData` inside a disposable profile root and
  verifies both canonically with `fs.realpathSync.native`, aborting if either
  resolves outside that root;
- deletes `ELECTRON_RUN_AS_NODE` from the child environment (it is `1` in the
  agent's shell);
- replaces `app.setLoginItemSettings` with a no-op, so **launch-at-login is
  excluded from this test** and the real Run key is never written;
- points `app.getAppPath()` at the repository so icons resolve.

The launcher is re-inspected and re-run in verify-only mode (isolation printed,
app not loaded, no keyboard hook started) before each reuse. Any already-running
Voice Hotkey copy is quit by the user first, so no second keyboard hook competes
for the shortcut. No real profile, API key or recording is read; the user enters
their own key into the empty disposable profile, where it is stored as
`encryptedApiKey`.

Typical isolation output:

```
canonical profile root : ...\smoke\profile-20260910-150035
userData               : ...\profile-20260910-150035\userData        INSIDE
sessionData            : ...\profile-20260910-150035\sessionData     INSIDE
logs                   : ...\profile-20260910-150035\userData\logs   INSIDE
crashDumps             : ...\profile-20260910-150035\userData\Crashpad INSIDE
appPath                : <repository>
ELECTRON_RUN_AS_NODE   : unset
blocked setLoginItemSettings: {"openAtLogin":false,"args":["--background"]}
```

---

## Run 1 — 2026-09-10, before the handle fix

### Result

| Check | Result |
|---|---|
| Isolated launch: windows, tray, keyboard hook | PASS |
| Settings save and persistence | PASS |
| Microphone → provider → transcript | PASS |
| Clipboard delivery | PASS |
| History written to `history.json` | PASS |
| No unexpected save warning | PASS |
| **Automatic paste into an unchanged target** | **FAIL** |
| Clipboard vs auto-insertion vs History comparison | BLOCKED — nothing was auto-inserted |
| Clean quit through the tray | PASS |
| History survives quit and relaunch | PASS |
| Shortcut and microphone after relaunch | PASS |
| **Real Windows dictation, end to end** | **FAIL** — the paste leg never ran |

The end-to-end status is FAIL. The individual legs above passed, but the
workflow this test exists to prove did not complete.

### The failure

Every dictation ended on:

    Copied — paste manually (focus could not be verified)

That is `manualPasteMessage(null)` in `dictation-controller.ts`, reached when
`getForegroundState()` returns `null`. `pasteOrExplain` returns early and
`paste()` is never called, so this was never a Windows/UIPI problem — the app
did not attempt the keystroke.

Root cause, confirmed by a native probe rather than inferred: `foreground.ts`
declared `void * GetForegroundWindow()` and then passed the result through an
`asHandle()` that accepted only `bigint` or `number`. koffi 2.16.3 returns a
pointer as an opaque external object, so every handle was discarded and
`check()` always returned `null`. Probe output under the repository's Electron
binary:

```
koffi version = 2.16.3
"void *" typeof        = object
"void *" asHandle()    = null      <- app discarded this
koffi.address(raw)     = 788304n
"uint64" typeof        = number | value = 788304
```

The defect was unconditional and machine-independent: auto-paste could not work
for any user of that build. `foreground.ts` was committed at `941a4d9`, so it
did not come from the uncommitted save-warning work; the installed 0.3.1 copy
predates that commit, which is consistent with auto-paste working there.

### Storage evidence recorded during run 1

`history.json` held 4 entries before quitting and was unchanged afterwards
(compared with `diff -q`: identical). The bounded three-second quit flush
neither truncated nor rewrote the file, `lockfile` was released, and no Voice
Hotkey process remained. After relaunch all four entries were listed and a
further dictation added exactly one more.

A "SHA-256" value quoted in the original working notes was a **truncated
prefix**, not a full digest, and is not valid checksum evidence. The byte
comparison above is what supports the persistence claim; the truncated value
is disregarded.

### Harness incidents, not product failures

1. The first launch was backgrounded through the agent's shell and died with
   it. Later runs used a detached `Start-Process`.
2. The scratchpad was wiped between sessions, removing the launcher and the
   first disposable profile. A report of "The transcription service returned no
   speech" (the app's wording when the provider returns an empty transcript)
   arrived while **no** Voice Hotkey or Electron process was running, so it did
   not come from the isolated instance. Recorded as NOT TESTED.

---

## Run 2 — 2026-09-10, after the handle fix

Same branch and HEAD, with `src/main/foreground.ts` and
`tests/foreground.test.ts` corrected. `out/` rebuilt from source before the run.

### Result

| Check | Evidence | Result |
|---|---|---|
| Unchanged, non-elevated target receives exactly one automatic paste | manual | PASS |
| Overlay reports "Copied and pasted" | manual | PASS |
| Auto-inserted text, clipboard and newest History entry all match | manual | PASS |
| Switching target before completion prevents automatic paste | manual | PASS |
| Elevated focused app prevents automatic paste | manual | PASS |
| Notepad gained nothing from either refused dictation | manual | PASS |
| History persistence during the run | file inspection | PASS |
| **Real Windows dictation, end to end** | manual | **PASS** |

### Manual evidence

- **Paste restored.** With Notepad focused and unchanged throughout, the
  overlay ended on "Copied and pasted" and the transcript appeared in Notepad
  exactly once — not twice, so the clipboard write and the injected Ctrl+V do
  not both land.
- **Agreement.** Pasting the clipboard manually onto a new line produced a line
  identical to the automatically inserted one, and both matched the newest
  History entry. Provider punctuation was not required to match what was
  spoken.
- **Focus-moved refusal.** Dictating into Notepad and clicking the Voice Hotkey
  window before transcription completed ended on
  "Copied — paste manually (focus moved)". Nothing was inserted anywhere.
- **Elevated refusal.** An earlier attempt in which the focused window was a
  genuinely elevated process ended on
  "Copied — paste manually (focused app runs elevated)", again with nothing
  inserted. This branch was therefore observed on real hardware as well.
- Notepad was confirmed afterwards to contain only the two identical lines from
  the successful case.

A focus sampler was run to rule out a false-positive elevation verdict. It
reports the owning process id, image name and the tracker's verdict only — no
window contents, no keystrokes:

```
pid=42772  image=Notepad.exe      tracker={"sameWindow":false,"elevated":false}
pid=23136  image=electron.exe     tracker={"sameWindow":false,"elevated":false}
pid=42772  image=Notepad.exe      tracker={"sameWindow":false,"elevated":false}
```

Neither Notepad nor the isolated test instance is reported as elevated, so the
elevated verdict in the earlier attempt described some other window that really
was elevated, not a misread.

### Native evidence

A probe runs the **production** `ForegroundTracker` (bundled unmodified from
`src/main/foreground.ts`) under the repository's own Electron binary, through
the whole chain: `GetForegroundWindow` → `GetWindowThreadProcessId` →
`OpenProcess` → `OpenProcessToken` → `GetTokenInformation`. It reads focus and
elevation state only: no keyboard injection, no window contents, no
credentials, no recording.

```
[native] PASS  tracker reports available
[native] check() after capture = {"sameWindow":true,"elevated":false}
[native] PASS  check() returned a state, not unknown
[native] PASS  full chain resolved elevation
[native] PASS  same window across two separate pointer wrappers
[native] PASS  this probe is not elevated  (elevated=false)
[native] check() again        = {"sameWindow":true,"elevated":false}
[native] PASS  repeat check still reports the same window
[native] check() after clear  = {"sameWindow":false,"elevated":false}
[native] PASS  cleared target reports focus moved but stays known
[native] PASS  2000 consecutive checks, none unknown (no handle leak)  unknown=0
[native] failures = 0
```

**Correction to that last line.** The probe's own wording overstates what the
loop shows, and the claim is withdrawn here.

2,000 successful calls do not prove the absence of a handle leak. A default
Windows process can hold on the order of 10,000 handles before allocation
starts failing, and the loop runs well below that; a leak of one handle per
call would very likely still be invisible at this scale, and a leak that only
occurs on a rarely taken error path would not be touched at all. What the loop
actually establishes is narrower and still worth having: the chain survives
repeated use without degrading, so there is no *fast* leak on the success path.

The real evidence for cleanup is structural, not statistical — every acquired
handle is closed in a `finally` block, and `tests/foreground.test.ts` asserts
exactly which handles are closed on the success path and on each failure path
(`closes both handles when the elevation query fails`, `closes the process
handle when the token cannot be opened`, `closes nothing when the process
cannot be opened`). A handle count sampled from the live process across the
loop would be the direct measurement; it has not been taken.

### Automated evidence (mocks — not a manual pass)

- `tests/foreground.test.ts`: 21 passed. Its fake now returns opaque pointer
  objects that throw on primitive coercion, plus a `koffi.address()`
  implementation, so it reproduces the real ABI. The previous fake returned
  bigints, which is why it never caught the defect.
- `tests/dictation-controller.test.ts`: passed, unchanged.
- Full suite via `npm run build`: 17 files, 206 tests passed, plus typecheck.
- `npm run lint` clean, `git diff --check` clean.
- Mutation check: rejecting pointer objects again (the original behaviour) fails
  9 of the 21 foreground tests, so the suite genuinely covers the regression.

---

## Run 3 — 2026-09-10, cross-platform milestone

The dictation path itself is unchanged from run 2 and was not re-run by hand.
What follows is what this milestone added and what was checked for it.

### Result

| Check | Evidence | Result |
|---|---|---|
| Unit suite (25 files, 354 tests), typecheck, lint | automated | PASS |
| `electron-vite build` | automated | PASS |
| NSIS installer and portable zip produced | packaging | PASS |
| Native modules present, unpacked, for win32-x64 | `scripts/check-native-packaging.mjs` | PASS |
| Packaged app starts and creates a profile | automated, disposable profile | PASS |
| Rendered dark interface at 100% and 150% | screenshots | PASS |
| Overlay in every phase, including the new cancelled state | screenshots | PASS |
| Real Windows dictation, end to end | — | **NOT RE-TESTED** since run 2 |

### Packaging

`npx electron-builder --win --x64` produced `voice-hotkey-0.3.1-win-x64.exe`
(105 MB) and `voice-hotkey-0.3.1-win-x64.zip` (147 MB), and
`scripts/check-native-packaging.mjs` confirmed both native modules are present
outside the asar for the architecture actually built:

```
ok    koffi (win32-x64) in ...\pkg\win-unpacked
ok    uiohook-napi (win32-x64) in ...\pkg\win-unpacked
Native packaging looks correct.
```

That check exists because both failure modes are silent: if `asarUnpack` stops
matching, the app still starts and merely loses the global shortcut and every
paste-target check.

**Packaging had to be written outside the repository.** Every attempt to build
into `dist/` failed with `EBUSY`/`EPERM` on `app.asar` and `default_app.asar`,
in a freshly created directory, with no Voice Hotkey or Electron process
running. The repository lives under `Desktop`, which is synced, and the same
build succeeded immediately when directed at a temporary folder. This is a
property of this machine, not of the configuration.

### Packaged startup

`Voice Hotkey.exe --user-data-dir=<temp> --background` with a seeded
`settings.json` containing `hotkeyEnabled: false` — deliberately, so an
unattended check never installs a chord matcher that could react to the user's
typing. The process stayed alive for 14 seconds, wrote a complete profile
(`Local State`, `Preferences`, `Network`, `lockfile`, caches), produced no
output on stderr, and was stopped with no Voice Hotkey process left behind.

Note: the packaged binary must be launched with `ELECTRON_RUN_AS_NODE` unset.
With it set — as it is in this agent's shell — any Electron binary behaves as
plain Node and rejects the application's own switches with `bad option`.

### Visual verification

Seventeen screenshots of the **built** renderer under
[docs/screenshots](../screenshots), captured with a synthetic bridge: invented
transcripts, no profile, no key, no microphone, no network. They cover History
(populated, empty, first-run, save-failure, recording), Settings (Windows,
Wayland, 150%), first-run on macOS, About, the fatal-error state, and the
overlay in all six phases.

Two real defects were found by looking at them, neither of which any test had
caught:

1. **The sidebar overflowed the window.** `.main-panel` is a grid whose rows
   default to a content-sized minimum, so a long page grew the shell past the
   viewport and carried the sidebar's status footer off the bottom of the
   screen. Fixed with an explicit `grid-template-rows: 100%` on the shell and
   `min-height: 0` on the panel.
2. **The overlay badge kept the previous phase's colour.** It transitioned
   `background-color`, whose value comes from a custom property, and Chromium
   does not reliably re-target such a transition — so the badge stayed the idle
   blue while the microphone was live. This is the exact hazard the overlay
   stylesheet's own header warns about. Fixed by transitioning only `transform`.

### Not covered by run 3

- The dictation path was not re-exercised by hand; run 2 remains the evidence
  for it, and the paste decision logic it verified is unchanged.
- macOS and Linux remain untested on real hardware. See
  [platform-support.md](../platform-support.md) for exactly what is outstanding.

---

## Run 4 — 2026-09-11, guided manual pass of the 0.4 milestone

Eight steps driven by hand against the isolated instance, one at a time, on
Windows 11 Enterprise 26100. The profile was the disposable one from run 3
(`scratchpad/smoke/profile-20260910-223446`); the key in it is the user's own,
entered by them, and is never read here.

### Result

| # | Check | Result |
|---|---|---|
| 1 | Window opens on Settings, Modern Dark applied | PASS |
| 2 | API key saved to the disposable profile, badge confirms | PASS |
| 3 | Window Record → Stop: "Copied to clipboard", one history entry, nothing typed elsewhere | PASS |
| 4 | Cancel discards the take: "Dictation cancelled", no history entry | PASS, after two fixes |
| 5 | Hold-to-talk from the global shortcut auto-pastes into Notepad, exactly once | PASS |
| 6 | Toggle mode: tap to start, tap to stop | PASS, after one fix |
| 7 | Tray Start recording, then tray Cancel dictation | PASS |
| 8 | Tray Quit leaves nothing running; history survives a relaunch | PASS |

Step 5 is the one that matters most for regression: it is the corrected Win32
pointer/`BOOL` path from run 2, unchanged by this milestone and still correct.

### Defect found at step 6: toggle mode could start but never stop

Reported as "it's only starting and not stopping". Reproduced deterministically
in `tests/toggle-mode.test.ts`, which wires the real `ShortcutController` to the
real `DictationController` the way `src/main/index.ts` does.

The hold delay (250 ms by default) guards against a chord that is the prefix of
a longer OS shortcut: the chord must be held on its own before it arms. That
guard was applied to *every* press, including the press that stops a toggle
dictation — and nobody holds a shortcut for a quarter of a second to stop
something. A normal tap was therefore discarded and the dictation ran on.

Both halves passed their own unit tests throughout. The defect lived in the
seam between them, which is why the new test exercises both together.

Fixed by `ShortcutController.setTapToFire()`: when toggle recording is in
force, a chord released before the delay elapses still counts as a press. The
guard itself is untouched — a key pressed outside the chord still cancels the
arm, so Ctrl+Shift+T still does not fire a Ctrl+Shift chord, and hold-to-talk
still records nothing from a tap. `src/main/index.ts` applies the mode at
startup, when the preference changes, and when a capability change alters the
mode actually in force.

Four tests cover it: tap-to-stop, tap-to-start, the prefix guard, and hold mode
being left alone.

### Step 4 investigation: cancel, and what the evidence actually showed

The first attempt at step 4 failed twice by hand — once reported as "dictation
failed", once as no visible change at all — with nothing in the DevTools
console. Calling `window.voiceHotkey.cancelRecording()` directly worked.

`scratchpad/smoke/diagnose-cancel.js` then loaded the real application under
the same disposable-profile isolation and drove its own window: three
consecutive start/cancel cycles, all three cancelled, with the history count
unchanged at 11 before and after. That exonerates the IPC channel, the
controller and the recorder; the clicks were not reaching the button.

That is a diagnosis of the harness, not a fix, so two changes were made
regardless:

1. `createRecordingControl` no longer swallows a rejected `invoke`. A failed
   command now shows its reason in the hint line instead of doing nothing
   visible — the exact symptom reported.
2. Both buttons were enlarged to a 34 px minimum height (Cancel also 78 px
   wide) and given `title` text.

Step 4 passed on the next attempt.

### Evidence from disk, not from the interface

Read directly from the disposable profile after the steps above:

- The cancelled take at step 7 left no entry: `grep -ic "tray control"` over
  `history.json` returns 0.
- After Quit: no `electron` process remained, the `lockfile` was released, and
  all 20 history entries were present in `history.json`.

### Not covered by run 4

- macOS and Linux remain untested on real hardware. Nothing in this run says
  anything about either; see [platform-support.md](../platform-support.md).
- Storage fault injection, retention pruning and export were not re-exercised
  by hand; their unit tests are the only evidence.
- One provider, one machine, one Windows version, one microphone.

---

## Run 5 — 2026-09-11, post-milestone requests

Five changes requested after the milestone was agreed: a light theme and its
switch, a new visual identity, a layout that opens with the recording control,
the rename to Murmur, and a drawn icon set. What was checked for them.

### Result

| Check | Evidence | Result |
|---|---|---|
| Unit suite (28 files, 381 tests), typecheck, lint, build | automated | PASS |
| Theme switch changes the window, both directions | manual, Windows | PASS |
| Light and dark rendered at 100% and 150%, overlay included | screenshots | PASS |
| History hero: Record, Stop and Cancel from the round control | manual, Windows | PASS |
| Nothing anywhere still says Voice Hotkey | manual, Windows | PASS |
| Profile migration from a seeded legacy folder | automated, real app | PASS |
| Icons legible and unambiguous at 16px | screenshots, then manual | PASS |
| macOS and Linux | — | **NOT RUN** |

### The profile migration, exercised rather than asserted

A legacy profile was seeded at `<root>/Voice Hotkey/` containing a settings
file (toggle mode, 400 ms hold delay, 90-day retention) and two transcripts,
with an empty `userData` beside it. The real application was then started
against it.

Result: both files arrived in the new profile with their contents intact, and
both originals were still present afterwards. A second launch against a profile
that already had its own `settings.json` copied nothing, which is the rule that
matters most — an existing profile is never overwritten.

### Defects found, and how

Six of the ten defects fixed across this work were found by looking at rendered
output, not by any test. Two deserve recording here because they are the same
hazard and neither has a failing computed style:

- **The record button kept the idle indigo while recording.** `getComputedStyle`
  reported the correct red throughout; the painted pixels were indigo. It was
  caught by sampling the pixel colour out of a screenshot, and confirmed by the
  contradiction between the two. Cause: a CSS transition on a value that comes
  from a custom property, which Chromium does not reliably re-target — exactly
  what the overlay stylesheet's own header warns about, and exactly what had
  already happened to the overlay badge.
- **A simplified cog icon reads as a sun at 16px**, and sat in the sidebar
  directly above the theme switch, which is a sun. Settings uses sliders.

The lesson both carry: a screenshot is not a nicety here. For anything that
changes colour by class, the computed style and the painted pixel are separate
claims and only one of them is what the user sees.

### Not covered by run 5

- macOS and Linux, entirely. Nothing in this run touches either.
- The dictation path was not re-run by hand after the layout change beyond the
  hero Record/Stop cycle; run 4 remains the evidence for auto-paste, the tray
  and the shortcut.
- Packaging was not repeated after the rename. The installer name, executable
  name and application id all changed, so **`npm run build:win` and
  `scripts/check-native-packaging.mjs` need running again before any release.**

---

## Not covered

- Cancellation, storage fault injection and packaging are out of scope here.
- The default `require('koffi')` resolution path is exercised by the app run
  itself; the native probe injects the loader explicitly.
- Calling convention is not declared (`__stdcall`); this is correct for the x64
  build the project ships and untested for a 32-bit build.
- Only one provider, one machine, one Windows version and one non-elevated
  target application were exercised.
