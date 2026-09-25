# Brief 07b — On-device engine: the interface

Queue item 7b of `docs/launch-plan.md`. Free. One commit, after 07a is committed.

## What the user sees

### First run (fresh profile, engine `local`, model missing)

The window opens on **History**. The setup card is headed "Get started" and its first,
blocking step is:

**Download the speech model** — "Murmur transcribes on this PC, so your voice never leaves
it. The model is 670 MB and downloads once." Button **Download** (primary). While
downloading: a progress bar, "412 of 670 MB", a **Cancel** link. While verifying: "Checking
the download…". Failed: the error sentence and **Try again**. A secondary line under the
step: "Prefer a cloud provider? Use your own API key instead" → navigates to Settings with
the cloud option selected.

When the model is installed the step disappears (existing setup-guide behaviour) and the
hero hint reads as today.

### Settings → first card, now "Transcription"

A two-option choice styled like the existing recording-mode radio cards:

- **On this PC** — "Private and offline. Nothing is sent anywhere. Uses about 1 GB of
  memory while dictating, released after 5 minutes of rest."
- **Cloud, with your API key** — "OpenAI, Groq, Azure or any OpenAI-compatible server.
  Audio is sent to that provider."

Under the choice, only the relevant section is shown:

- *On this PC*: a model row — name "Parakeet v3 · 25 European languages", size, state
  badge ("Ready" / "Not downloaded" / progress / "Download failed"), actions (Download,
  Cancel, Remove model — Remove asks for confirmation and is disabled while dictating).
  The language select stays; under it a note: "The on-device model recognises its 25
  languages by itself; this setting only tunes cleanup." When the selected language is not
  one of the 25, the note warns: "Parakeet does not support Japanese. Choose Cloud for
  Japanese." (use the language label).
- *Cloud*: the existing API key, session-only, endpoint, model and language fields,
  unchanged.

The engine choice is saved with **Save settings** like everything else. Switching to "On
this PC" while the model is missing is allowed; the record control then says
"Download the speech model first" (from `notReadyReason`).

### Record control, tray, overlay

Not ready → the existing disabled Record button with the `notReadyReason` hint. Tray
"Start recording" disabled with the same reason in the hint label if practical.

### About page

Replace the "Your API key" card with "Private by default" ("Transcription runs on this PC.
A cloud provider is optional and uses your own key.") and add an **Attributions** section:
the Parakeet attribution line from the manifest, "sherpa-onnx — Apache-2.0",
"ONNX Runtime — MIT". Update the notice card text so it no longer says audio is only sent
to "the transcription provider you configure" when the engine is local — make it
conditional on the engine.

## Design notes

- A small renderer module `src/renderer/model-download.ts` that renders the model row
  (state → markup) from an `EngineStatus` and exposes `apply(status)`; used by both the
  setup card and Settings so they cannot disagree. Pure state→view function
  `modelRowState(status)` unit-tested in `tests/model-download.test.ts`.
- `AppContext` gains `engine: EngineStatus` and `applyEngine(next)`; `main.ts` subscribes
  to `onEngineStatus` and refreshes History's setup card and Settings' model row.
- `setup-guide.ts`: new step id `'model'` (blocking) when engine is local and the model is
  not installed; the existing `'api-key'` step only when engine is cloud and there is no
  key. Update tests.
- Keep every existing Settings behaviour (dirty flags, capability notes, save bar).

## Verification Claude will run

Fresh isolated profile with `MURMUR_MODELS_DIR` pointing at an **empty** folder: History
shows the Download step; click Download; progress advances; after completion the step
disappears; Settings shows Ready; a fake-microphone dictation from the Record button lands
in History. Then with `MURMUR_MODELS_DIR` pointing at the spike's already-downloaded model
folder (copied with a `verified.json`) the step never appears.

## Done when

`npm run typecheck && npx vitest run && npm run lint && npx electron-vite build` pass.
Screenshots are Claude's job. Do not commit.
