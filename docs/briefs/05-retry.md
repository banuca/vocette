# Brief 05 — Silent retry and a Retry button in the window

Queue item 5 of `docs/launch-plan.md`. Free. One commit.

## Why

Rate limits and transient gateway errors are routine on OpenAI-compatible endpoints; one
costs the user a 4.5 s error and a hunt through the tray for "Retry last dictation". One
bounded, invisible retry makes most of those failures disappear, and the retained take
should be retryable from the window, not only the tray (`retryLastDictation` is already on
the preload bridge and wired in main — nothing in the renderer calls it).

## What the user sees

- A 429, a 5xx or a dropped connection: the overlay briefly says "Transcribing…" with
  detail "The service was busy — trying once more", then the text lands. No error.
- If it still fails, the error shows as today, and the record control (top bar / History
  hero) shows a **Retry** button next to Record for as long as a failed take is retained.
  Pressing it re-sends the same audio (no re-speaking). Starting a new dictation or
  cancelling removes it (existing controller semantics).

## Design

`src/main/transcription-service.ts`:
- Wrap the existing `send` in at most **one** retry for: HTTP 429, HTTP 500–599, and a
  network failure (the "Could not reach the transcription service" path). **Never** for
  400/401/403/404/413, never for a timeout (the 120 s timeout already cost the user long
  enough), never after the caller's `AbortSignal` fired.
- Delay: `Retry-After` header if present (seconds, or an HTTP date), clamped to
  0.25–5 s; otherwise 700 ms. The wait must abort immediately if the caller's signal
  aborts (reject with the abort, and do not send the second request).
- `TranscribeInput` gains `onRetry?: () => void`, called once just before the second
  attempt. The existing keyword → prompt fallback on 400 is unaffected and does not count
  as the transient retry (a 400 is not transient). Keep the zeroing of the audio copy per
  request.
- `humanApiError` unchanged except: after a failed retry of a 429 say "The API rate limit
  or spending limit was reached — the request was retried once." (keep it short).

`src/main/dictation-controller.ts`:
- `TranscriptionPayload` / the `transcribe` dep gains an optional `onRetry` callback that
  the controller supplies: it broadcasts `{ phase: 'processing', message: 'Transcribing…',
  detail: 'The service was busy — trying once more' }` if it still owns the attempt.
- `WorkflowStatus` (shared type) gains optional `canRetry?: boolean`. The controller sets
  it on **every** broadcast from `this.retryTake !== null` (so the window always knows),
  including idle. Do not break existing consumers (it is optional).

`src/main/index.ts`: pass `onRetry` through `transcribe()` into the service.

`src/renderer/recording-control.ts`:
- `recordingControlState` gains `retryVisible: boolean` — true when
  `status.canRetry && !busy`. The view renders a third button `#record-retry`
  ("Retry", title "Send the last recording again") shown only when `retryVisible`, calling
  a new bridge method `retryLastDictation()` (already exists on `window.murmur`; add it to
  `RecordingControlBridge`). Failures go through the existing `run()` so they are shown.
- Keep the pure function pure and add cases to `tests/recording-control.test.ts`.

## Tests

- `tests/transcription-service.test.ts` (mock `fetch`): 503 then 200 → one retry, text
  returned, `onRetry` called once; 429 with `Retry-After: 2` waits ~2 s (fake timers);
  `Retry-After` above 5 s clamps to 5 s; 401 → no retry; 413 → no retry; network error
  then 200 → retried; timeout → no retry; abort during the backoff → rejects, second fetch
  never made; two failures → error thrown after exactly two fetches; the 400 keyword
  fallback still behaves as before and a 503 on the fallback request is not retried twice
  (total fetches bounded — assert the count).
- `tests/dictation-controller.test.ts`: `canRetry` true on the error broadcast after a
  failed take, false after a successful retry and after a new take starts; the onRetry
  status broadcast.
- `tests/recording-control.test.ts`: `retryVisible` combinations (error + canRetry → true;
  recording → false; processing → false; idle + canRetry → true; no canRetry → false).

## Done when

`npm run typecheck && npx vitest run && npm run lint` pass. Do not commit.
