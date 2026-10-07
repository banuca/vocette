# Brief 03 — Replacements and snippets

Queue item 3 of `docs/launch-plan.md`. Free (a Pro cap is added later by the licence
feature; build it uncapped now). One commit.

## Why

A vocabulary entry tells the recogniser a word *exists*; a replacement rewrites what you
said into what you meant. Users need both: homophones and house style ("itu" → "ITU"),
expansions ("my email" → an address), code ("console log" → `console.log()`), and
snippets — a spoken trigger that expands into a block of text (an address, a signature).
Every paid competitor charges for snippets; Wispr has no dynamic variables.

## What the user sees

In Settings → "Your words" card, below the vocabulary box, a second labelled text area:

**Replacements and snippets** — one rule per line, `spoken => written`:

```
itu => ITU
console log => console.log()
my email => name@example.com
sign off => Best regards,\nAlex
today's date => {date}
```

Note under it (live, like the vocabulary note): "One rule per line: what you say => what
you want. Use \n for a line break, {date} or {time} for today's date or the time.
Rules apply after cleanup, match whole words, and ignore capitals." plus a count
("3 rules", and "— 1 line ignored: no =>" when some lines are malformed). The card's badge
area may stay as is (vocabulary badge); add a second small badge or put the count in the
note — your choice, keep it tidy.

## Design

New pure module `src/shared/replacements.ts`:

```ts
export interface ReplacementRule { spoken: string; written: string }
export interface ParsedReplacements { rules: ReplacementRule[]; ignored: number }
export const MAX_REPLACEMENTS_CHARS = 20_000   // stored string, clamped on a line boundary
export const MAX_REPLACEMENT_RULES = 200
export const MAX_SPOKEN_CHARS = 60
export const MAX_WRITTEN_CHARS = 1_000
export function clampReplacements(raw: string): string          // like clampVocabulary
export function parseReplacements(raw: string): ParsedReplacements
export function applyReplacements(text: string, rules: readonly ReplacementRule[], now?: Date): string
```

Parsing: split on `\r?\n`; a rule is a line containing `=>` (first occurrence splits it);
trim both sides; skip blank lines and lines starting with `#` (comments, not counted as
ignored); a line with no `=>`, an empty side, or a side over its limit is ignored (counted).
De-duplicate by spoken side, case-insensitively — **the last** definition wins (so a user
can override an earlier line). Cap at `MAX_REPLACEMENT_RULES`.
In the written side, the two-character sequence `\n` becomes a newline; `\\n` stays a
literal backslash-n.

Applying:
- Build one combined regex from all spoken phrases, **escaped as literals** (a user typing
  `console.log()` as a spoken side must not break the pass), sorted longest first so the
  longest match wins at any position; flags `giu`.
- Whole-word: a match must not be preceded or followed by a letter or digit
  (`(?<![\p{L}\p{N}])` … `(?![\p{L}\p{N}])`) — "itu" must not fire inside "situation".
- Whitespace inside a spoken phrase matches any run of whitespace in the transcript, and
  tolerates a comma the recogniser inserted between words ("my, email" matches "my email").
- One pass, left to right: replaced text is never scanned again (no re-entry, no chains).
- Variables in the written side, expanded at apply time: `{date}` →
  `now.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })`,
  `{time}` → `now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })`.
  Unknown `{…}` stays literal. `now` defaults to `new Date()` and is injectable for tests.
- The written side is inserted exactly as typed, with no capitalisation fix-up, even at
  the start of a sentence. Say why in a comment: code snippets must keep their case.

Pipeline: in `src/main/dictation-controller.ts` `processTake`, apply after
`cleanupTranscript` and before the empty check / history / clipboard. The controller only
forwards parsed rules (like `vocabulary`): `WorkflowSettings` gains
`replacements: ReplacementRule[]`, parsed once in `src/main/index.ts` `workflowSettings()`.

Settings (five-place recipe, both load and save paths): `replacements: string` in
`PublicSettings`, `SettingsUpdate`, `StoredSettings`, `DEFAULT_SETTINGS` (`''`),
`normaliseSettings` (clamp), `update()` (clamp). Renderer: textarea `#replacements`
(`spellcheck="false"`), query handle, `syncControlValues` (with a dirty flag exactly like
`vocabularyDirty`, so an out-of-band repaint does not wipe unsaved typing), save object.

## Tests

- `tests/replacements.test.ts`: parsing (blank, comment, malformed counted, both limits,
  duplicate spoken → last wins, `\n` and `\\n`, CRLF); applying (case-insensitive,
  whole-word — "itu" inside "situation" untouched, longest-first — rules "new york" and
  "new york city", literal escaping — spoken `c++` and `console.log()`, whitespace/comma
  tolerance, no re-entry — rules `a => b` and `b => c` turn "a" into "b" not "c", Unicode
  word boundaries — "café" rule, `{date}`/`{time}` with an injected date, unknown
  variable literal, empty rule list returns input unchanged).
- `tests/settings-store.test.ts`: `replacements` defaults `''`, persists, clamps on a line
  boundary, survives reload.
- `tests/dictation-controller.test.ts`: a rule is applied to the delivered and recorded
  text, after cleanup (e.g. input "um itu rocks" with rule `itu => ITU` → "ITU rocks").
- Update fixtures that build `WorkflowSettings` / `PublicSettings`.

## Done when

`npm run typecheck && npx vitest run && npm run lint` pass. Do not commit.
