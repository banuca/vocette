# Briefs R1–R5 — small fixes the user research exposed

Each is its own commit. Evidence: `docs/research/frustrations.md` (#4 silence, #13/#6
feedback, #8, #18 Bluetooth, Windows §5 sleep/resume).

## R1 — Silence stays silent

**User sees:** press and release without speaking → the overlay shows a neutral "No speech
heard — nothing was sent." (phase `cancelled`, ~1.6 s), no error sound, no history entry,
no retry offer, nothing pasted. Cloud users are never billed for silence and Whisper can no
longer paste "Thank you." into their document.

**Design:** `src/renderer/audio-prep.ts` `prepareForTranscription` returns
`speechDetected: boolean` (`findSpeechBounds(...) !== null`; `true` on the fallback path
where decoding failed, so an unreadable take is still sent as today).
`RecorderAudioPayload` gains optional `speechDetected?: boolean`; the recorder forwards it.
`DictationController.onRecorderAudio`: when `speechDetected === false`, zero the audio, clear
timers, broadcast the neutral status with `CANCELLED_RESET_MS`-style reset, return without
transcribing. Comment the threshold reasoning (`findSpeechBounds` returns null only when
every 30 ms window is below max(4 % of peak, 0.0015 RMS ≈ −56 dBFS), so a whisper passes).
**Tests:** audio-prep pure test for the flag (silent buffer → false, quiet sine at 0.01 → true);
controller: silent payload → no transcribe call, no history, no clipboard, status text.

## R2 — "Is it hearing me?": a live level in the overlay

**User sees:** while recording, a small five-bar level meter beside the timer in the overlay
moves with their voice. Nothing else changes.

**Design:** `src/renderer/recorder.ts`: once the take's stream is open, create an
`AudioContext` + `AnalyserNode` on it (the Settings mic test shows the pattern), sample the
time-domain peak every ~70 ms while recording, and send `recorder:level { requestId, level }`
(0–1, rounded to 2 decimals) through a new preload method; stop and close the context in
`cleanupTake`. Main (`index.ts`): forward only for the current request id, only while
recording, to the **overlay window only** on `workflow:level`. `src/preload/index.ts`:
`onLevel`. `src/renderer/overlay.ts` + `overlay.css`: five bars whose heights follow a
smoothed level (attack fast, release slow); hidden when not recording; respect
`prefers-reduced-motion` (show a single static dot that brightens instead). The level is
never stored or sent anywhere else. **Tests:** a pure `levelToBars(level, previous)` helper
in a shared renderer module with unit tests; recorder-race test that cleanup closes the
context.

## R3 — Esc cancels a hands-free recording

**User sees:** in "Press to start and stop" mode (and for recordings started from the
window), pressing Esc while recording cancels it like the Cancel button. The overlay hint
reads "Press <chord> again to finish · Esc to cancel". Hold-to-talk is unchanged (Ctrl +
Shift + Esc is Task Manager). Note: the hook only observes keys, so Esc also reaches the
focused app — say so in the Settings text for the recording mode: "Esc cancels (the app
you are in also sees the Esc)."

**Design:** `ShortcutBackendOptions` gains optional `onEscape?()`; `ShortcutController`
fires it on an Escape keydown (the uiohook keycode from `src/shared/keycodes.ts`) when
enabled and not capturing, regardless of the chord. `index.ts`: `onEscape` → if
`dictation.isBusy()` and (effective mode is toggle **or** the take is window-started) →
`dictation.cancelDictation()`. The controller exposes whether the current take is
clipboard-only (window-started) if needed. **Tests:** shortcut-controller fires onEscape,
not while capturing; controller-level wiring test via a small pure `escapeCancels(mode,
source, busy)` function.

## R4 — A plain note about Bluetooth headsets

**User sees:** in Settings → Microphone, when the selected microphone (or, for "System
default", the default device's label) looks like a Bluetooth headset, a note under the
picker: "This looks like a Bluetooth headset. While its microphone is open, Windows switches
your headphones to call quality. Choose your computer's built-in microphone to keep full
sound." Hidden otherwise.

**Design:** pure `looksLikeBluetoothHeadset(label)` in `src/renderer/` (matches, case
-insensitively: "hands-free", "handsfree", "headset", "airpods", "buds", "bluetooth", "bt ",
"wh-", "wf-"); the default device's label comes from the `enumerateDevices` entry with
`deviceId === 'default'` (currently skipped when listing — keep skipping it in the list, but
read its label). Update on picker change and after refresh. **Tests:** the matcher.

## R5 — The shortcut survives sleep and lock

**User sees:** nothing — the shortcut keeps working after the laptop sleeps or the screen is
locked (users of other tools report "stuck after sleep").

**Design:** `index.ts`: on `powerMonitor` `resume` and `unlock-screen`, if no dictation is
busy: `shortcutController.stop()`, `shortcutController.start()`, `refreshCapabilities()`;
if a dictation *is* busy, cancel it first (a take spanning a sleep is not trustworthy) and
then re-arm. Debounce (both events can fire together): at most once per 3 s. Also call
`dictation.resetKeyState()`-equivalent key clearing so no key is left "held". Log nothing
sensitive. **Tests:** extract the decision into a small pure function
`rearmPlan({ busy, lastRearmAt, now })` → `'skip' | 'rearm' | 'cancel-then-rearm'` with tests;
the Electron wiring is verified by Claude.

Each: `npm run typecheck && npx vitest run && npm run lint` pass; do not commit.
