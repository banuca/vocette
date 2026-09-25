# Brief 09 — Start listening the moment the shortcut goes down

Queue item 9 of `docs/launch-plan.md`. Free. One commit. Depends on the engine (07) only
for the optional prewarm hook; everything else is independent.

## Why

The clipped first word is the most common complaint in push-to-talk dictation. Today the
microphone is opened only **after** the hold delay (250 ms default) and then takes another
100–700 ms to start (Bluetooth headsets are slower still), so "Send it by Friday" arrives
as "it by Friday". The user has no idea the word went missing.

## What the user sees

Nothing new, except that the first word is no longer lost. Speech from the instant the
chord goes down is in the take. If the chord turns out to be part of another shortcut
(Ctrl + Shift + T) or is released before the hold delay, the audio captured so far is
discarded unheard, nothing is transcribed, nothing is stored, and no overlay appears —
though the operating system's microphone indicator may flash briefly. A Settings toggle
(Recording card) controls it:

**Start listening the moment the shortcut goes down** — "Captures your first word even if
you start speaking straight away. The microphone opens as soon as the keys go down, and
anything captured before recording starts is thrown away unheard if you were pressing a
different shortcut." Default **on**.

## Design

`src/main/platform/types.ts` — `ShortcutBackendOptions` gains optional
`onArm?(): void` and `onDisarm?(): void`.

`src/main/shortcut-controller.ts`:
- Fire `onArm()` when the chord becomes satisfied and the arm timer starts (hold delay
  > 0). With hold delay 0, do not fire `onArm` (activation is immediate).
- Fire `onDisarm()` whenever an armed chord is cancelled without activating: a foreign key,
  the chord no longer satisfied, release before the delay (in hold mode), `reset()`,
  `setEnabled(false)`, `setChord`, `setHoldDelay`, capture begin. In toggle mode a tap that
  fires `onPress()` on release is an activation, not a disarm.
- Never fire `onArm` while `active` (already dictating) — in toggle mode the press that
  stops a take must not start a provisional one.
- Other backends (`accelerator-backend.ts`, the null backend) never arm; leave them.

`src/main/dictation-controller.ts`:
- New `prepareDictation()` (called from `onArm`) and `abandonPreparation()` (from
  `onDisarm`). A new internal flag `provisional` marks a take that has been sent
  `recorder:start` but not yet confirmed by the user holding past the delay.
- `prepareDictation()`: only when idle/lingering (not busy), setting `instantCapture` on,
  transcription ready, and the take would be a shortcut take. It captures the foreground,
  creates the request id, sends `recorder:start`, arms the start watchdog **silently**, and
  broadcasts **nothing** (no overlay, no sound). Sets `provisional = true`.
- `onShortcutPressed()` / `startDictation('shortcut')` while provisional: promote the
  existing take instead of starting a second one — broadcast `starting` (or go straight to
  `recording` if the recorder already reported started), play the start sound, start the
  maximum-duration timer from the recorder's actual start time.
- `onRecorderStarted` while still provisional: remember that the recorder is live, do
  **not** broadcast `recording`, do not beep.
- `abandonPreparation()` while provisional: send `recorder:cancel`, clear the request id
  and timers, zero nothing (there is no audio in main yet), broadcast nothing, return to
  idle silently. If the take was already promoted, `abandonPreparation` is a no-op.
- A provisional take has a hard ceiling (`PROVISIONAL_MAX_MS = 2000`): if it is neither
  promoted nor abandoned by then (a stuck modifier), abandon it — the microphone must never
  stay open behind the user's back.
- `recorder:audio` for a provisional take that was abandoned must be ignored and zeroed
  (the request-id guard already covers this — assert it in a test).
- New dep `prewarm?(): void` on `DictationDeps`, called by `prepareDictation()` and by
  `startDictation()`; `index.ts` wires it to the local engine's prewarm when the engine
  exists (until then, leave it undefined).

`src/renderer/recorder.ts`: no protocol change is needed — `recorder:start` already opens
the device and starts `MediaRecorder` immediately, and `recorder:cancel` discards. Confirm
that a cancel arriving while `getUserMedia` is still pending closes the late stream (the
existing `recorder-race` tests cover this; add one for a cancel ~50 ms after start).

Settings: `instantCapture: boolean` (default true) — five-place recipe, both paths,
`WorkflowSettings.instantCapture`.

`src/main/index.ts`: pass `onArm: () => dictation.prepareDictation()` and
`onDisarm: () => dictation.abandonPreparation()` into `createShortcutBackend`.

## Tests

- `tests/shortcut-controller.test.ts`: onArm on chord satisfied with delay; no onArm with
  delay 0; onDisarm on foreign key, on early release (hold mode), on reset/disable/setChord;
  no onDisarm after activation; no onArm while active; toggle tap = press not disarm.
- `tests/dictation-controller.test.ts`: arm → recorder:start sent, no broadcast, no sound;
  arm → press → recorder started → exactly one `recording` broadcast and one start sound;
  arm → recorder started → press → straight to recording; arm → disarm → recorder:cancel,
  idle, no history, no transcription; arm → 2 s → auto-abandon; arm while busy → ignored;
  arm with `instantCapture: false` → nothing sent; late `recorder:audio` for an abandoned
  provisional take is ignored and its buffer zeroed; arm then press in toggle mode then a
  second press stops.
- `tests/settings-store.test.ts`: `instantCapture` default true when absent, persists.

## Done when

`npm run typecheck && npx vitest run && npm run lint` pass. Do not commit.
