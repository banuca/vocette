# Brief 13 — History you can correct: edit, undo delete

Queue item 13 of `docs/launch-plan.md`. Free. One commit.

## Why

A mis-clicked Delete on a long dictation is unrecoverable behind a `window.confirm`, and a
transcript with one wrong word can only be copied and fixed elsewhere. Editing in place is
also where corrections will later be learned from (stretch S1).

## What the user sees

Each History row's actions become: **Edit**, **Copy**, (for polished entries, from 12:
**Show original**, **Copy original**), **Delete**.

- **Edit** swaps the text for a textarea with the same size and font, focused, with **Save**
  and **Cancel** (Esc cancels, Ctrl+Enter saves). Saved text replaces the entry's text; the
  row shows "Edited" in its meta line. An edit never changes the date, duration or model.
  Saving an empty text is refused ("A dictation cannot be empty — delete it instead").
- **Delete** no longer asks for confirmation. The row disappears and a toast-like bar at the
  bottom of the History page says "Dictation deleted" with **Undo** for 8 seconds (or until
  another delete, which replaces it). Undo puts the entry back exactly where it was.
- "Delete all transcript history" in Settings keeps its confirmation (it is not undoable).
- **Show original** appears on any entry whose delivered text differs from what the
  recogniser actually heard (cleanup, a spoken correction, a replacement, polish or an
  edit changed it): it toggles the row between the delivered text and the recogniser's
  raw text, with **Copy original**. Users asked for the raw text to be always recoverable —
  a cleanup rule that misfires must never cost them their words.

The recogniser's raw text is recorded as `heardText?: string` (optional; stored only when
it differs from `text`) by the controller at `recordHistory`. If brief 12 already added
`originalText` (pre-polish), keep that field for polish and use `heardText` for the raw
recogniser output; "Show original" prefers `heardText` when present.

## Design

- `src/shared/types.ts`: `HistoryEntry` gains `editedAt?: string` and
  `originalText?: string` (if 12 already added `originalText` as the pre-polish text, keep
  that meaning and add `uneditedText?: string` for the pre-edit text instead — do not
  overload one field with two meanings). **Optional**, with a test that an entry without
  them loads (the `isHistoryEntry` filter hazard, roadmap §1).
- `src/main/history-store.ts`: `update(id, text)` — replaces text, sets `editedAt`, keeps
  the first pre-edit text in `uneditedText`, persists through the existing serialised
  `persist(true)` path (an edit is destructive to the old text, so recovery copies are
  refreshed like a delete). `restore(entry)` — re-inserts a previously deleted entry at its
  original chronological position (sorted by `createdAt`, newest first), refusing a
  duplicate id; persists with `persist(false)`. Both clamp text to 250,000 chars like the
  clipboard handler.
- Deletion stays immediate on disk (privacy: the delete means delete). Undo is a
  re-insert from the renderer's copy of the entry it just removed — the renderer passes the
  entry back; main validates it with `isHistoryEntry` plus the optional fields' types.
- IPC (fromMain-guarded, with the argument validation style of `history:delete`):
  `history:update(id, text)` → list; `history:restore(entry)` → list. Preload wrappers
  (channel strings are retyped in preload — double-check them).
- `src/renderer/pages/history.ts`: the per-entry actions are built imperatively; add the
  buttons without touching grouping/virtualisation. Only one row edits at a time; a
  `history:changed` refresh while editing must not destroy the textarea (skip the list
  re-render while an edit is open, re-render after Save/Cancel).

## Tests

`tests/history-store.test.ts`: update persists, sets `editedAt`, keeps the first
`uneditedText` across two edits, refuses unknown id; restore puts the entry back in date
order, refuses duplicates; entries without optional fields load; update/restore go
through the serialised write tail (no lost write when interleaved with `add`).

## Done when

`npm run typecheck && npx vitest run && npm run lint` pass. Do not commit.

## Notes added before the build (28 Sep 2026)

- `recordHistory(text, durationMs, model)` is the current dep signature; change it to take
  an extras object (`{ heardText?, … }`) so brief 10's `waitMs` can join it later.
- The pipeline in `processTake` is: vocabulary correction → cleanup → replacements. The
  recogniser's raw text (before correction) is what `heardText` stores, only when it
  differs from the delivered text.
- Polish (brief 12) has not been built yet: implement `heardText` only; leave a comment
  that 12 adds `originalText`.
