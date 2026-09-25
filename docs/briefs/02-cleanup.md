# Brief 02 — Cleanup that actually runs, and a smarter free cleanup

Queue item 2 of `docs/launch-plan.md`. Free tier. One commit.

## Problem

- `src/main/dictation-controller.ts:444-447` applies `lightCleanup` only when
  `settings.language === 'en'`. Automatic (a common choice) gets **no cleanup at all**
  while the "Light cleanup" switch shows as on — a silent trust bug.
- `src/shared/cleanup.ts` damages technical text: the "add a space after punctuation"
  rule turns `example.com` into `example. com`, `3.5` into `3. 5`, `10:30` into `10: 30`,
  `e.g.` into `e. g.`; the repeated-punctuation rule turns an ellipsis `...` into `.`.
- It only removes um/uh/erm/hmm. People also stutter ("I I think"), use comma-delimited
  fillers ("it was, like, fine"), and correct themselves out loud ("Tuesday, no sorry,
  Wednesday") — the thing Wispr Flow users call magic. Deterministic rules can handle the
  common, high-confidence cases for free and instantly.

## What the user sees

Settings → Recording card: the single "Light cleanup" row becomes three rows:

1. **Remove filler words** (existing `removeFillers`, default on) — "Drops “um”, “uh”,
   stutters like “I I”, and a filler “like” or “you know” set off by commas. Your own
   words are never rewritten."
2. **Follow spoken corrections** (new `spokenCorrections`, default on) — "Say “scratch
   that” to drop the last sentence, or fix a word as you go: “Tuesday, no sorry,
   Wednesday” becomes “Wednesday”. English."
3. **Spoken line breaks** (new `spokenFormatting`, default on) — "Say “new line” or “new
   paragraph”. English."

The rows apply to every language where the rule is safe (below), not only explicit `en`.

## Design

Replace `lightCleanup(input)` with a pure, exported

```ts
export interface CleanupOptions {
  language: string            // 'auto' | ISO-639-1
  removeFillers: boolean
  spokenCorrections: boolean
  spokenFormatting: boolean
}
export function cleanupTranscript(input: string, options: CleanupOptions): string
```

Keep a `lightCleanup(input)` wrapper only if something still needs it; otherwise delete
it and update imports. Put the spoken-correction logic in a new pure module
`src/shared/spoken-corrections.ts` (not `corrections.ts` — that name is reserved for the
later "learn from corrections" feature). No Electron, no I/O, no regex built from user
input without escaping.

"English rules" below apply when `language` is `'en'` or `'auto'`. For any other explicit
language only the language-neutral repairs and the universal hesitation sounds apply.

Order of passes (each a small named function, individually tested):

1. **Normalise**: trim; collapse runs of spaces/tabs to one space (do not collapse `\n`,
   which spoken formatting may produce later — run formatting after this pass or protect
   newlines).
2. **Spoken formatting** (if `spokenFormatting`, English rules): whole-phrase,
   case-insensitive `new line` → `\n`, `new paragraph` → `\n\n`. Swallow the punctuation
   and spaces the recogniser put around the phrase ("Hello team. New paragraph. The plan"
   → "Hello team.\n\nThe plan"). Capitalise the first letter after an inserted break. Never
   leave a line starting or ending with a space.
3. **Spoken corrections** (if `spokenCorrections`, English rules):
   a. *Discard markers* — `scratch that`, `delete that`, `strike that` (case-insensitive,
      whole phrase, with any adjacent punctuation): remove the marker and everything back
      to the previous sentence boundary (`.`, `!`, `?`, newline, or start of text). If
      nothing precedes it, just remove the marker. "Send the report today. Scratch that.
      Send it tomorrow." → "Send it tomorrow." — the preceding sentence goes, earlier
      sentences stay.
   b. *In-sentence replacement* — marker set: `no`, `no wait`, `no sorry`, `sorry`,
      `I mean`, `or rather`, `actually`, `wait`. The single-word markers (`no`, `sorry`,
      `actually`, `wait`) count **only** when set off by commas on both sides; the
      multi-word ones (`no wait`, `no sorry`, `I mean`, `or rather`) may appear without
      commas. Let *before* be the tokens of the same sentence preceding the marker and *Y*
      the tokens after it up to the sentence end. Apply only when **all** hold:
      - *before* has at least one token and *Y* has 1–4 tokens;
      - *Y* runs to the end of its sentence (followed by `.`, `!`, `?`, newline or end);
      - the first token of *Y* has a "kind" and a token of the same kind exists among the
        last 4 tokens of *before*. Kinds: `number` (digits, optionally with `,`/`.`
        inside, or English number words one…twenty, thirty…ninety, hundred, thousand);
        `weekday`; `month`; `determiner` (the, a, an, my, your, our, their, his, her,
        this, that, these, those); `pronoun` (I, we, you, he, she, they, it);
        `proper` (a capitalised token that is not the first token of its sentence and is
        not a weekday/month/pronoun). Nothing else has a kind.
      Then replace from the **last** same-kind token in *before* through the marker with
      *Y*, keeping the sentence's terminal punctuation. Otherwise leave the text as it is
      (the filler pass may still remove a comma-delimited `I mean`).
      Required examples (all must be tests):
      - "Let's move the meeting to Tuesday, no sorry, Wednesday." → "Let's move the meeting to Wednesday."
      - "Send it to John, I mean Sarah." → "Send it to Sarah."
      - "Let's meet at 3 PM, no, 4 PM." → "Let's meet at 4 PM."
      - "We need five, no, six chairs." → "We need six chairs."
      - "I'll bring the red one, sorry, the blue one." → "I'll bring the blue one."
      - "I like it, no, I love it." → "I love it."
      - "It costs 10 dollars, actually, 20 dollars." → "It costs 20 dollars."
      **Across a full stop.** The on-device recogniser often ends the sentence before the
      correction: it wrote "…move the meeting to Tuesday. No sorry, Wednesday." for the
      spoken "…to Tuesday, no sorry, Wednesday." So when a sentence *starts* with one of
      `No`, `No sorry`, `No wait`, `Sorry, I mean`, `I mean`, `Or rather` (followed by a
      comma or, for the multi-word ones, by a space), the previous sentence ends with a
      full stop (**not** `?` or `!` — "Is it ready? No, not yet." is an answer), and *Y*
      has 1–3 tokens and ends its sentence, then *before* is the previous sentence and the
      same kind rule applies; on success the two sentences merge ("…to Wednesday.").
      Single-word `Sorry,` / `Actually,` / `Wait,` at a sentence start never reach back.
      Extra required examples: "We should move the meeting to Tuesday. No sorry,
      Wednesday." → "We should move the meeting to Wednesday."; "I think it's Tuesday. No,
      Wednesday." → "I think it's Wednesday."; negatives: "We shipped the build on Monday.
      Actually, the team was happy." unchanged; "Is it ready? No, not yet." unchanged.
      Required negatives (unchanged by this pass):
      - "No, I mean it." · "Sorry, I'm late." · "I actually like it." ·
        "It was, actually, quite good." · "Is it ready? No, not yet." ·
        "Call me tomorrow, no, the day after." (no determiner before — leave it) ·
        "There is no way." · "I mean well."
4. **Fillers** (if `removeFillers`):
   - Universal hesitation sounds, every language: `um+`, `uh+`, `erm+`, `hmm+`, `mm+`,
     `ah+` when followed by a comma or standing alone between commas/spaces, `äh+m?`,
     `ähm`, `öhm`, `euh`, `ehm` — whole words only (the existing "umbrella"/"Humming" tests
     stay green), with a trailing comma swallowed.
   - English rules only: `er+` (not in German — "er" means "he"); comma-delimited
     `like`, `you know`, `I mean`, `you see` (", like," → ","-collapse; sentence-initial
     "Like, " / "You know, " / "I mean, " removed); repeated function words — an immediate
     repeat (optionally comma-separated) of one of: i, a, an, the, to, and, we, you, he,
     she, it, they, is, in, of, on, for, my, our, but, so, if, this — collapses to one ("I
     I think" → "I think", "the the" → "the", "I, I think" → "I think"). Never collapse
     `that that`, `had had`, `very very`, `no no`, `bye bye`.
5. **Repairs** (always, whenever any of the three options is on; if all three are off,
   return `input.trim()` untouched):
   - remove spaces before `,` `.` `;` `:` `!` `?`;
   - collapse `,,` and doubled `!!`/`??` to one, **but keep `...`**;
   - tidy doubled commas or a comma directly before terminal punctuation left behind by
     earlier passes (", ." → ".", ",," → ",");
   - **do not** insert spaces after punctuation — recognisers already space correctly, and
     inserting them breaks `example.com`, `3.5`, `10:30`, `e.g.`;
   - capitalise the first letter of the text and of each sentence (after `.`, `!`, `?` +
     whitespace, and after a newline) using plain `toUpperCase()` on scripts that have case;
     leave caseless scripts alone.
6. Return `''` for input that is only fillers/markers (the controller already turns empty
   into "Only filler words or silence were detected.").

## Settings wiring (the five-place recipe, twice)

- `src/shared/types.ts`: `PublicSettings` and `SettingsUpdate` gain `spokenCorrections`
  and `spokenFormatting` (booleans).
- `src/main/settings-store.ts`: `StoredSettings`, `DEFAULT_SETTINGS` (both `true`),
  `normaliseSettings` (load path, booleans default `true` when absent), `update()` (save
  path). Leave `SETTINGS_VERSION` at 5 (absent fields default correctly).
- `src/main/dictation-controller.ts`: `WorkflowSettings` gains both; replace the
  `language === 'en'` gate at `:444-447` with `cleanupTranscript(rawText, {...})`.
- `src/main/index.ts` `workflowSettings()`: pass both through.
- `src/renderer/pages/settings.ts`: the three toggle rows (markup text above), query
  handles, `syncControlValues`, save object.
- Update every test fixture that builds a `WorkflowSettings` / `PublicSettings` object.

## Tests

- `tests/cleanup.test.ts`: rewrite around `cleanupTranscript`. Keep the intent of every
  existing case; change the expectation only where this brief changes behaviour (e.g.
  "Hello , world .Next sentence" → no space is inserted after the full stop, so assert the
  new output and add a comment). Add: `example.com`, `3.5`, `10:30`, `e.g.` survive;
  `Wait...` keeps its ellipsis; German "Er hat, äh, recht." → "Er hat recht." (the "er"
  word survives, the "äh" goes); Automatic language gets English rules; `fr` gets only
  universal + repairs; all options off returns the trimmed input.
- `tests/spoken-corrections.test.ts`: every required example and negative above, plus
  discard-marker cases (first sentence, middle sentence, marker alone).
- `tests/settings-store.test.ts`: both new booleans default `true` when absent from an
  existing file, persist `false`, and survive a reload.
- `tests/dictation-controller.test.ts`: with `language: 'auto'` and `removeFillers: true`
  the pasted/history text has fillers removed (the old gate would have left them).

## Done when

`npm run typecheck && npm test && npm run lint` all pass. Report the files changed, the
test counts before/after, and any rule you could not implement exactly as written and why.
Do not commit; Claude reviews and commits.

## Amendments agreed during the build (25 Sep 2026)

1. Same-kind look-back prefers the latest token equal to Y's first token (case-insensitive),
   else the latest same-kind token — "I like it, no, I love it." → "I love it."
2. A comma-enclosed filler goes with both commas: "Er hat, äh, recht." → "Er hat recht."
3. Plain `um` and `er` are English rules only ("um 10 Uhr", "um carro"). Universal set:
   `umm+`, `uh+`, `erm+`, `hmm+`, `mmm+` (plain `mm` dropped — "5 mm"), `ah+` (comma-delimited
   or alone), `äh+m?`, `ähm`, `öhm`, `euh`, `ehm`. ALL-CAPS tokens are never fillers ("ER").
   Under `auto`, English rules apply only when `looksEnglish(text)` (≥ 2 English function
   words, or ≥ 1 in a text of ≤ 5 tokens).
4. "delete that" is not a discard marker. "scratch that" / "strike that" count only when
   followed by punctuation, newline or end. "new line" / "new paragraph" convert only when
   bounded by punctuation or text start/end on both sides.
