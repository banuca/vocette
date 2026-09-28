# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Transcription on this PC, by default.** Dictation now runs on your computer with
  NVIDIA's Parakeet v3 (25 European languages): no API key, no account, and nothing sent
  anywhere once the 670 MB model is downloaded. A first run opens on **Get started**, whose
  one step is that download — with progress, Cancel (the next download resumes), and the
  reason plus **Try again** if it fails. **Settings → Transcription** switches between **On
  this PC** and **Cloud, with your API key**, showing only the fields for the one chosen;
  the model row can also remove the model, though never mid-dictation, and a language the
  model cannot recognise is named in a warning. Until a take could be transcribed, the tray
  does not offer Start recording and says why. About says where audio goes for the engine
  in use, and credits the model, sherpa-onnx and ONNX Runtime.

- **Cleanup that actually runs.** The switch used to do nothing unless the language
  was set to exactly English, so Automatic — a common choice — got no cleanup while
  the switch showed as on. Hesitation sounds are now removed in every language, and
  the English rules also run for Automatic whenever the text reads as English.
- **Stutters and comma-delimited fillers**: “I I think” → “I think”; “it was, like,
  really good” → “it was really good”.
- **Follow spoken corrections** (new switch, on by default): “Scratch that” drops the
  sentence before it, and “move it to Tuesday, no sorry, Wednesday” becomes “move it
  to Wednesday” — including when the recogniser put a full stop before the correction.
  A repair happens only when the replacement clearly lines up with a word just said
  (a day with a day, a number with a number, a name with a name); anything else is
  left exactly as spoken.
- **Spoken line breaks** (new switch, on by default): “new line” and “new paragraph”,
  when said as a phrase of their own.

- **Your words — a custom vocabulary.** A new Settings card takes a list of
  names, acronyms and product terms, one per line, and biases the recogniser
  towards them on every dictation. `gpt-transcribe` and `gpt-live-transcribe`
  receive them in the `keywords` field that OpenAI documents for exactly this;
  every other model — `gpt-4o-transcribe`, `whisper-1`, Groq, a local server —
  is given them at the end of the transcription prompt, because that is the
  only biasing channel an OpenAI-compatible endpoint is guaranteed to accept.
  The line under the box says which of the two is in use for the model you have
  selected, and changes when you change the model.
- **The terms are sent to your provider**, on every dictation, in the request
  that was already being made. That is how they work, and it is now said in
  the box, in the README, on the About page and in SECURITY.md: this is not a
  place for a secret.
- Blank lines, duplicates (ignoring case) and terms over 48 characters are
  dropped rather than truncated. The list holds up to 500 terms (Free uses the
  first 50, Pro all of them), and the 20,000-character ceiling cuts on a line
  boundary so a half-word can never be biased into a request.
- On the prompt path the list is budgeted to about 480 characters, because
  `whisper-1` keeps only the last 224 tokens of a prompt and an unbounded list
  would push out the language hint it is appended to. The note under the box
  says how many terms are actually being sent.
- The terms are appended as a bare list rather than an English sentence:
  Whisper echoes prompt prose into the transcript when the audio is short, and
  an English sentence welded onto a French prompt shifts the decoder.
- `keywords` is only sent to OpenAI itself, never to a custom endpoint that may
  reject an unknown field — and if a request carrying it is rejected anyway,
  Murmur retries once with the terms in the prompt instead, so an unverified
  parameter can cost one request some accuracy but cannot break dictation.

- **Your words, spelled right on every engine.** After recognition, and before
  cleanup, Murmur corrects near-misses of your terms on this computer: “ITUT” and
  “I T U T” become “ITU-T”, “data verse” becomes “Dataverse”, and “Kirinda”,
  “Kiranda” and “Kurindi” become “Kirinde”. It runs for the on-device engine,
  which takes no prompt to bias, and for cloud models, which still miss. A common
  English word is never turned into one of your terms — “coffee” stays “coffee”
  with “koffi” in the list, “an apple” is never “an Apple”, and “who” stays “who”
  with WHO — checked against about 73,000 common English word forms from SCOWL.
  Sound-alike matching is English only; a match that differs only in spacing,
  capitals or punctuation applies in every language. A correction never reaches
  across sentence punctuation, and the note under the box now says it happens.

- **Replacements and snippets.** A second box on the Your words card rewrites
  what you said into what you meant, one `spoken => written` rule per line:
  `itu => ITU`, `console log => console.log()`, `my email => name@example.com`.
  `\n` in the written side is a line break, so a spoken trigger can expand into a
  whole signature or address, and `{date}` and `{time}` become today's date and
  the time. Rules run on this computer, after cleanup, and are never sent to your
  provider. They match whole words only (“itu” never fires inside “situation”),
  ignore capitals, and tolerate a comma the recogniser put between words, but never
  match across a line break you asked for; the longest phrase wins, and replaced
  text is never rewritten again. What you wrote goes in exactly as typed — no
  capital is added, so code keeps its case — and a snippet that spans lines takes
  the full stop or comma after its trigger with it, so a signature does not end on
  a stray full stop. The note under the box counts the rules and says how many
  lines could not be read as one.

- **Your clipboard, given back.** Automatic paste used to leave every transcript on
  the clipboard, so whatever you had copied was gone. Now the clipboard is only
  borrowed: after the paste, what you had copied — text, formatting, an image — is
  put back about ¾ s later. A file list copied in Explorer, or an application's own
  private format, cannot be restored. When Murmur does not paste (clipboard-only
  delivery, focus moved, an elevated window) the transcript stays on the clipboard as
  before. On by default; **Put my clipboard back** in Settings turns it off. The
  overlay now says **Pasted** rather than “Copied and pasted”, which stopped being
  true once the clipboard is given back.
- **Paste last dictation — Alt + Shift + V** (Windows, on by default) pastes your
  newest transcript again into the window in front, with the same focus and
  elevation checks as a dictation: for a paste that went to the wrong place. If
  another app already owns the combination, Settings says so. It is deliberately not
  in the tray menu — opening the menu takes focus away from the window you want it in.
- **A retry is copied, not pasted.** Retry is pressed in Murmur's own window or tray,
  so the window in front is Murmur itself; a retried take used to be pasted there (into
  whatever field had focus) and, with the clipboard given back, could end up only in
  History. It now goes to the clipboard, like a take started from the window.
- **A busy service is retried once, and Retry is in the window.** A rate limit (429),
  a server error (5xx) or a dropped connection used to cost a 4.5-second error and a
  hunt through the tray. Now the cloud request is quietly sent once more — after the
  pause the service asks for in `Retry-After`, held to between 0.25 and 5 seconds, or
  0.7 seconds otherwise — while the overlay says “The service was busy — trying once
  more”. Only once, and never for a rejected request — a bad key, a wrong address or
  model, a recording that is too large — nor after a two-minute timeout, which would
  only fail the same way again; a dictation cancelled during the pause sends nothing
  more. When a take still fails, **Retry** appears beside Record in the window, in the
  top bar and at the head of History, for as long as the recording is kept, and sends
  it again without re-speaking — on-device takes included. Starting a new dictation or
  cancelling removes it, just as it greys out **Retry last dictation** in the tray.
- **The first word is less likely to be cut off.** The microphone used to open only
  once the hold delay had passed (250 ms by default), and then had to start up —
  slower still on a Bluetooth headset — so “Send it by Friday” could arrive as “it by
  Friday”. It now opens once the keys have been held on their own for a moment (a
  tenth of a second), while the hold delay is still running, so it has a head start
  and what you say from then on is in the take. A shortcut typed at speed, such as
  Ctrl + Shift + T, brings its third key within that moment and never opens the
  microphone at all. If it has opened and the keys turn out to be part of another
  shortcut, or are let go before the delay, what was captured is thrown away unheard:
  nothing is transcribed or stored, and no overlay appears, though the system's
  microphone indicator may flash briefly. With the on-device engine, the speech model
  starts loading at the same moment. **Start listening as soon as the shortcut is
  held** (Settings → Recording, on by default) turns it off. It needs a keyboard Murmur
  can watch, so on Wayland, or wherever the keyboard hook cannot start, the switch is
  disabled and says why.
- **Is it hearing me? A live level in the overlay.** While you record, five small bars
  beside the timer move with your voice, and rest as dots when nothing is heard — so a
  muted or wrong microphone shows while you speak, not after an empty transcript. Where
  the system is set to reduce motion, one still dot brightens instead. The level goes
  from the recorder to the overlay and nowhere else, and is never stored or logged.
- **A plain note about Bluetooth headsets.** While a Bluetooth headset's microphone is
  open, Windows switches the headphones to call quality — mono and muffled — and nothing
  said why. When the microphone chosen in Settings looks like a Bluetooth headset (or,
  for the system default, the device Windows is using does), a note under the picker now
  says so and suggests the computer's built-in microphone instead. It follows the picker
  before Save and is worked out again on refresh. It is a guess from the device's name —
  “Headset”, “Hands-Free”, “AirPods”, “Buds”, “Bluetooth”, “BT”, Sony's WH- and WF- models
  — so a wired headset can get the note too; with no name to read, nothing is shown.
- **Correct a dictation in History, and undo a delete.** **Edit** turns an entry's text
  into a box of the same size and type, with **Save** and **Cancel** (Ctrl + Enter saves —
  Command + Enter on a Mac — and Esc cancels); the entry then says “Edited” beside its
  time, and keeps its date, length and model. An empty text is refused — delete the
  dictation instead. **Delete** no longer asks first: the entry goes at once, on disk too,
  and a bar at the foot of the page offers **Undo** for 8 seconds, or until the next
  delete, putting it back exactly where it was. Deleting all history in Settings still
  asks, because that cannot be undone. Whenever cleanup, your words or a replacement
  changed what the recogniser heard, its own words are now kept beside the text: **Show
  original** switches the entry to them and **Copy original** copies them, so a rule that
  misfires never costs you what you said. Dictations saved before this version were stored
  without them. An edit keeps the text it replaced in the same way, so to remove words for
  good, delete the dictation. The `.json` export includes both.

- **Pro, with a 30-day trial — and a Free version that stays complete.** Everyone gets
  Pro for their first 30 days (an existing user from their first launch of this
  version). Afterwards Free keeps everything dictation needs, for good: on-device and
  cloud dictation of any length, cleanup, spoken corrections and line breaks, clipboard
  restore, paste last, Retry and history. Pro is for power users: 500 vocabulary terms in
  use instead of 50, 200 replacement rules instead of 20, and AI polish when it ships.
  Nothing is deleted when Pro lapses — a longer list keeps every line, only its first
  part is used, and the note under each box says so. A new **Pro** page shows the plan,
  **Buy Pro** (Polar's checkout, in the browser) and a **Licence key** field: **Activate**
  sends the key and a device label (“Murmur on Windows · 7F3A”) to Polar once — no
  credentials, no API-version pin — and Murmur never checks again; the buyer details in
  Polar's answer are discarded, never logged. **Release this PC** frees a device slot,
  and without a connection **Remove from this PC anyway** clears it here, saying the slot
  stays in use. The key is encrypted by the operating system where it can be, and kept
  plain, marked as such, where it cannot. The sidebar shows “Trial · 23d” during the
  trial and nothing otherwise; when it ends, History shows one notice, dismissed for
  good. A cloud request still carries at most 100 keywords. Purchases stay closed (“Pro
  purchases open soon”) until the Polar values in `src/shared/product.ts` are filled in.
- **A server of your own needs no key.** whisper.cpp's server, Speaches or a corporate
  Whisper deployment often has no key to give, yet Murmur refused to record without one.
  Now, with an **API endpoint** set in Settings → Transcription, the key is optional: the
  badge reads “No key needed for this server”, Record works, and the request goes out
  with no `Authorization` header at all, rather than an empty one. OpenAI itself, used
  when the endpoint is empty, still asks for a key before anything is sent. When a server
  refuses (HTTP 401 or 403), the message names it — “The server at localhost:8080 refused
  the request (HTTP 401). If it needs a key, add one in Settings.” — or, when a key was
  sent, says to check it, instead of blaming an OpenAI key. A server on this computer that
  cannot be reached is asked about rather than your internet connection: “Could not reach
  the transcription server at localhost:8080. Is it running?” **Test connection**, beside the
  endpoint, sends one second of silence as a WAV to the saved endpoint, once, with no
  retry and a 10-second limit, and says “Connected — the server answered in 180 ms” or
  why not. An empty transcript of the silence counts as connected; a web page served at
  the wrong address does not. It uses saved settings only — your saved key never goes to
  an address you have not saved — so while the endpoint, model or key fields hold unsaved
  changes it waits for **Save settings**, and says so.

- **Esc cancels a hands-free recording.** In **Press to start and stop**, and for any take
  started from the window, Esc on its own cancels the recording as Cancel does: nothing is
  transcribed, kept or pasted. The overlay says so — “Press Left Ctrl + Left Shift to
  finish · Esc to cancel” — and a chord too long to fit beside it is called “the shortcut”
  so the Esc part is never cut off. Esc with a modifier is left alone (Ctrl + Shift + Esc
  is Task Manager), as is a take held to talk and one already being transcribed. Murmur
  only watches the key, so the app in front sees the same Esc; Settings says so. Where the
  keyboard is not watched (a Wayland desktop) or the shortcut is off, Esc is not offered.

### Fixed

- In **Press to start and stop**, and for a take started from the window, the overlay said
  “Release Left Ctrl + Left Shift to finish” once recording began, which was wrong for both.
  It now keeps the words for how the take was started.

- Only the main window can ask for app info, as for every other channel, and the
  settings the window sees are now listed field by field — a new stored field no longer
  crosses into the window unless it is added on purpose.
- Cleanup no longer inserts a space after punctuation, which turned `example.com`
  into `example. com`, `3.5` into `3. 5` and `10:30` into `10: 30`; and it keeps an
  ellipsis instead of collapsing it to a full stop.
- German “um 10 Uhr” and Portuguese “um carro” keep their “um”, and a measurement in
  `mm` is not a hesitation.
- **Silence stays silent.** Pressing and releasing the shortcut without saying anything
  used to send the recording anyway: a cloud provider billed for the silence, Whisper
  could paste “Thank you.” into your document, and an empty result came back as a failed
  dictation with a Retry. Now a take with no speech in it is not transcribed by either
  engine. The overlay says “No speech heard — nothing was sent.” for a moment, as a
  neutral note rather than an error, and nothing is pasted, kept in History or offered
  for Retry. The bar is low on purpose — a take counts as silent only when every 30 ms of
  it stays below about −56 dBFS — so a whisper still goes through, and a recording Murmur
  cannot decode is still sent as before.

## [0.4.0] — 2026-09-11

### Changed — the product is now called Murmur

- **Voice Hotkey is Murmur.** The name, the window, the tray, the installer,
  the application id (`dev.murmur.app`), the Linux desktop entry and the
  preload bridge (`window.murmur`) all follow. Requested after the milestone
  was agreed; see `docs/design-requests.md`.
- **Existing profiles are carried across.** The storage folder is named after
  the application, so the rename would otherwise orphan a user's settings and
  transcripts. On first run Murmur copies `settings.json` and `history.json`
  out of the old folder — but only when its own is empty, and it never deletes
  the originals. A failure is reported and startup continues.
- **The saved API key survives on Windows only**, where `safeStorage` encrypts
  against the user account rather than the path. On macOS and Linux the secret
  is held in a keychain entry named after the application and cannot follow a
  rename: there Murmur says so and asks for the key again, rather than
  appearing to have one it cannot read.
- The application name is now pinned in code, so a development run and a
  packaged run share one profile folder instead of quietly using two.

### Added

- **macOS and Linux support.** Murmur now targets Windows, macOS (Apple
  Silicon and Intel) and Linux (X11 and Wayland). Every platform can open the
  app, configure a provider, record from the window, transcribe, copy and keep
  local history; a global shortcut and automatic paste vary, and the app says
  which it has.
- **A main-process platform boundary** (`src/main/platform/`) covering global
  shortcuts, paste-target capture and verification, key injection, permission
  and capability reporting, and launch-at-login. Every native integration loads
  lazily: a missing library, a refused permission or an absent desktop service
  becomes a reported capability instead of a failed startup.
- **A light theme, and a switch for it at the foot of the sidebar.** Modelled
  on Visual Studio Code's Light Modern. The choice is saved with the rest of
  the settings, so it survives a restart, and the overlay follows it rather
  than floating a black pill over a light window. Modern Dark stays the
  default. Requested after the milestone was agreed; see
  `docs/design-requests.md`.
- **Toggle recording mode.** Press to start, press again to stop, alongside the
  original hold-to-talk. The stored preference is never overwritten by a
  platform that cannot honour it.
- **Record, Stop and Cancel in the window**, on every page, and in the tray.
  They drive the same dictation controller as the shortcut — there is still
  exactly one microphone owner. A recording started from the window is
  delivered to the clipboard, because the window in front is Murmur.
- **Cancellation.** A take can be abandoned before or during transcription: no
  transcript, no history entry, no paste, and the audio buffer zeroed. It is
  reported as an acknowledgement, not an error.
- **Session-only API keys.** Where the operating system has no storage fit to
  hold a credential — a Linux desktop with no unlocked keyring, where Electron
  falls back to a hard-coded key — Murmur refuses to write the key and
  offers to keep it in memory for the session instead. Plaintext is never
  written silently.
- **First-run guidance** that lists only what is genuinely outstanding — API
  key, microphone access, and any platform permission — with a button for each,
  and clears itself as each is satisfied.
- **Platform support and verification matrix** in `docs/platform-support.md`,
  which keeps what a platform *can* do separate from what has actually been
  *run* there.
- **macOS and Linux packaging**: DMG and ZIP for arm64 and x64, AppImage and
  deb for x64, alongside the existing NSIS installer and portable ZIP. Signing
  and notarisation are configured without credentials, and CI never publishes.
- **`scripts/check-native-packaging.mjs`**, which fails the build if koffi or
  uiohook-napi did not survive packaging for the architecture actually built.
  Both failure modes are otherwise silent: the app still starts, and merely
  loses the global shortcut and every paste-target check.
- CI now verifies on Windows, macOS and Linux, and packages on each.

### Changed

- **History opens with the recording control**, not with a log: a large round
  Record button, the phase beneath it, and one line of guidance. The same
  control moves into the top bar on other pages, so there is still exactly one
  of it. Statistics are hairline-separated figures rather than outlined cards,
  and transcripts are rows that light up under the pointer rather than a ruled
  table.
- **A drawn icon set** (`src/renderer/icons.ts`): eleven interface icons on a
  24×24 grid with a 2px stroke, inline and inheriting `currentColor`. No icon
  font, no sprite, no package, no request. They replace text glyphs that were
  rendered by whatever font each operating system resolved.
- **A new visual identity across the whole app and the overlay**, driven by
  centralized CSS tokens: a warm near-black and warm off-white in place of the
  cold editor greys, an indigo accent, larger radii, soft shadows instead of
  drawn grid lines, pill-shaped primary controls, a rounded pill for the active
  navigation item, and more room around cards and transcripts. Requested after
  the milestone was agreed; see `docs/design-requests.md`. Dark remains the
  default. Segoe UI-first system stack with real macOS and
  Linux fallbacks, no remote or bundled fonts, compact spacing, modest radii
  and restrained motion. Reduced-motion preferences are honoured, focus is
  always visible, and the layout was checked at 100% and 150%.
- Settings disables any control the operating system will not honour and shows
  the reason next to it, rather than silently doing nothing when it is used.
- Wording is no longer Windows-only: "Start with Windows" becomes "Open at
  login" or "Start when I sign in", the paste chord follows the platform, and
  the microphone default is "System default microphone".
- Settings file version 5 adds `recordingMode` and `theme`. Older files load
  with the hold-to-talk and Modern Dark defaults, and the saved API key is
  carried across untouched.

### Fixed

- **Toggle recording started but never stopped.** The hold delay that keeps a
  chord from firing when it is the prefix of a longer shortcut was applied to
  the press that stops a dictation too, so a normal tap was discarded and
  recording ran on. A tap now counts in toggle mode; the guard against longer
  shortcuts, and hold-to-talk's indifference to taps, are unchanged.
- **The window shell could grow past the screen.** A long page stretched the
  layout grid, carrying the sidebar's status footer off the bottom of the
  display where it could not be seen at all.
- **The record button kept the idle colour while recording.** The same hazard
  as the overlay badge below: a transition on a value that comes from a custom
  property. Its computed style was correct throughout, which is why nothing but
  a screenshot could have caught it.
- **The window said "Ready" while telling the user no API key was set.**
- **The overlay badge kept the previous phase's colour** — showing the idle
  blue while the microphone was live. It transitioned a colour that comes from
  a custom property, which Chromium does not reliably re-target.
- The transcription payload no longer carries the take's internal delivery
  state to the provider.

### Documentation

- Corrected an unsupported claim in the Windows verification record: 2,000
  successful native calls do not prove the absence of a handle leak. What that
  loop shows is narrower — no fast leak on the success path — and the real
  evidence for cleanup is the `finally`-based closing and the per-path tests
  that assert exactly which handles are closed.

## [0.3.1] — 2026-08-27

### Changed

- Reworked the Windows dictation overlay around a state-driven voice animation:
  an active waveform and microphone while listening, a rotating document while
  transcribing, and a clear check when the transcript is ready. Unlike the
  fixed six-second reference SVG, every scene remains synchronized with the
  real dictation workflow.

## [0.3.0] — 2026-08-14

### Added

- **Model and language selectors.** Settings now has real dropdowns for the
  four transcription models and ~30 languages; the transcription prompt adapts
  to the chosen language. (Previously they were stored but unreachable from
  the UI.)
- **Custom API endpoints.** Any OpenAI-compatible base URL can be configured —
  Groq, Azure OpenAI, or `http://localhost:8080/v1` for a locally hosted
  transcription server. Custom model names are accepted when an endpoint is
  configured. Remote endpoints must be `https`; plain `http` is allowed for
  localhost only.
- **Retry last dictation.** A failed transcription keeps the recording in
  memory; the tray menu can resend the exact same take. The buffer is zeroed
  when a new take starts, when the retry succeeds, and on quit.
- **Silence trimming.** Leading and trailing silence is removed and audio is
  re-encoded to 16 kHz WAV before upload — less money per dictation, better
  recognition. Falls back to the original container if processing fails.
- **Honest auto-paste.** The foreground window is captured at press time and
  checked at paste time (via Win32 through koffi, failing open). If focus
  moved, or the focused app runs elevated — where injected keystrokes cannot
  go — the app copies and says so instead of claiming a paste that never
  happened.
- **Microphone test** with a live level meter in Settings.
- **Optional sound cues**: one beep when recording starts, two when the
  transcript lands.
- **History upgrades**: grouped by day, search highlights matches, entries
  load incrementally instead of all at once, a "last 30 days" metric, and
  export as `.txt` or `.json`.
- **Tray improvements**: the tooltip mirrors the workflow state, and
  **Reset shortcut state** now also cancels a stuck take.
- Dev builds allow the Vite HMR websocket in the CSP, so `npm run dev` hot
  reloads again (production builds keep `connect-src 'none'`).
- Unit tests for the dictation phase machine, the transcription request shape,
  audio prep, and foreground tracking (136 tests).

### Changed

- Settings files move to version 3 (new fields: `playSounds`, `apiEndpoint`).
  Migration keeps existing values and the encrypted API key.
- Numpad keys are now in the keycode table, with labels, and numpad digits
  count as typing keys for chord validation.
- The tray toggle no longer wipes whatever you were typing in Settings — only
  the affected controls update.
- Deleting a single history entry asks for confirmation.
- History writes are flushed (awaited) on quit, so quitting right after a
  dictation cannot lose the newest transcript.
- Writes to the data files retry briefly when Windows transiently locks the
  file (antivirus scans), and surface a friendly error if they still fail.

### Fixed

- **Tray "Reset shortcut state" during a recording permanently wedged the
  microphone.** The main process forgot the take without telling the recorder;
  the mic stayed hot and every later dictation failed with "already recording"
  until restart. Abandoned takes now send an explicit cancel, and the recorder
  aborts late microphone opens.
- **Watchdog failures could strand a recording the same way** — every failure
  path now cancels the recorder for the abandoned request.
- **Shortcut capture leaked key state.** Navigating away from Settings
  mid-capture left the hook hijacked, and keys still held after capture
  committed could auto-repeat their way into starting a dictation. Capture
  now tears down on page leave and re-seeds held keys exactly.
- A tray toggle while Settings was open erased a half-typed API key.
- The dev build had silently dead HMR because the production CSP blocks
  websockets.

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
