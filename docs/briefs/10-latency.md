# Brief 10 — How long each dictation took, measured

Queue item 10 of `docs/launch-plan.md`. Free. One commit. Small.

## Why

Speed claims must be measured. Users (and the owner's marketing) should see how long the
wait after letting go actually was, per dictation, on their own machine.

## What the user sees

- Overlay success message gains the wait: "Pasted · 0.6 s" / "Copied to clipboard · 0.6 s"
  — the time from the key release (or Stop) to the text being ready to paste.
- History meta line: "10:42 · 0:04 · 12 words · ready in 0.6 s" (only for entries that have
  the measurement).
- History metrics: replace nothing; add one figure to the metrics row only if it fits the
  layout: "Typical wait" = median of the last 50 measured entries. If it crowds the row,
  skip it.

## Design

- `src/main/dictation-controller.ts`: stamp `releasedAt` when the stop is requested (in
  `requestStop` / `forceStop`, and for window Stop), `textReadyAt` right after the final text
  is computed (after polish/replacements), and compute `waitMs = textReadyAt - releasedAt`
  (for a Retry, from the retry start). Pass it to `recordHistory` and into the success
  broadcast (format with one decimal in seconds, `0.6 s`; ≥ 10 s as whole seconds).
- `HistoryEntry` gains optional `waitMs?: number` — **optional**, with a load test for an
  entry without it. `recordHistory(text, durationMs, model, extras)` takes an extras object
  (also used by 12/13's optional fields if present) rather than more positional params.
- Keep timing out of anything sent to a provider.

## Tests

Controller: `waitMs` measured with fake timers from release to text; success message
contains the formatted wait; retry measures from retry start. History store round-trip of
the optional field.

## Done when

`npm run typecheck && npx vitest run && npm run lint` pass. Do not commit.
