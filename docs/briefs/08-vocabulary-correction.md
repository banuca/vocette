# Brief 08 — Your words, spelled right on every engine

Queue item 8 of `docs/launch-plan.md`. Free. One commit. Runs after the on-device
engine (07) exists, because that engine has no prompt to bias.

## Why

The vocabulary (feature 1) biases the **cloud** recogniser through `keywords[]` or the
prompt. The on-device engine takes no prompt, and even cloud models still write
"ITUT", "data verse" or "Kurindi". A deterministic correction pass after recognition, run
for every engine, turns a near-miss of one of the user's own terms into the term — without
ever turning a real word into a term ("coffee" must stay "coffee" even if "koffi" is in the
list).

## What the user sees

The same "Your words" box. The note under it changes to say, for the on-device engine:
"Murmur corrects near-misses of these words after it hears you — “data verse” becomes
“Dataverse”." For cloud engines keep today's biasing note and add that sentence.

## Design

New pure module `src/shared/vocabulary-correction.ts`:

```ts
export function correctVocabulary(text: string, terms: readonly string[], language: string): string
```

1. Tokenise `text` into word tokens (Unicode letters/digits, with internal `'`, `-`, `.`
   allowed only between alphanumerics) keeping the separators, so the text can be rebuilt
   exactly. Sentence punctuation (`.`, `!`, `?`, newline, `,`, `;`, `:`) ends a candidate
   span — a span never crosses it.
2. For each term precompute `norm(term)`: lower-case, only letters and digits kept
   (`ITU-T` → `itut`, `G.9960` → `g9960`, `Dataverse` → `dataverse`), and its word count.
   Skip terms whose norm is shorter than 3 characters.
3. Candidate spans: every run of 1 to `min(4, termWords + 2)` consecutive tokens.
4. **Exact match (all languages)**: `norm(span) === norm(term)`. Replace the span with the
   term exactly as the user typed it, when **any** of these hold:
   - the span is more than one token ("data verse", "I T U T", "ITU T");
   - the term has a "special form": an uppercase letter after its first character, a digit,
     or internal punctuation (`ITU-T`, `GitHub`, `iPhone`, `G.9960`);
   - the span token is **not** a common English word (see 6) — so "kirinde" → "Kirinde",
     but a user term "Apple" never capitalises "an apple".
5. **Near miss (English rules only: language `en` or `auto`)**: single- or multi-token span,
   not a common English word (for a single token) and not made only of common words (for a
   multi-token span), where all hold:
   - same first letter after `norm`, or same first character of the phonetic key;
   - length ratio of the two norms between 0.75 and 1.34;
   - `phoneticKey(norm(span)) === phoneticKey(norm(term))` **and**
     `editDistance(norm(span), norm(term)) <= max(1, floor(len(term)/3))`, **or**
     `editDistance <= floor(len(term)/5)` with the term at least 8 characters;
   - the term's norm is at least 5 characters.
   `phoneticKey`: a small consonant-skeleton key written here, not a dependency — keep the
   first letter, map c/k/q→k, ck→k, ph→f, v→f, z→s, x→ks, d→t, b→p, g→k, drop vowels
   and h/w/y after the first letter, collapse repeated letters. Document that it is
   deliberately crude and guarded by the common-word check.
6. **Common English words**: a list of the ~50,000 most common English word forms,
   generated from SCOWL (size 50, en_US + en_GB) — download it from the official SCOWL
   release (http://wordlist.aspell.net/ or github.com/en-wl/wordlist), lower-case, letters
   only, length ≥ 2, one per line, as `src/main/data/common-words.txt`, with a
   `src/main/data/README.md` giving the source, version, generation command and the SCOWL
   copyright/permission notice (it requires the notice to be reproduced). Load it once,
   lazily, into a `Set` — the module takes the set as an injectable parameter so tests do
   not need the file (`correctVocabulary(text, terms, language, isCommonWord?)`), and
   `src/main` supplies the real one. Also add the notice to the About page's attributions
   (a short "Word list: SCOWL, © Kevin Atkinson" line is enough).
7. Choose non-overlapping replacements greedily: longest span first, then earliest; a
   token takes part in at most one replacement. Rebuild the text with the original
   separators; keep sentence-initial capitalisation only if the term itself starts with a
   lower-case letter and the span was at sentence start (then capitalise the term's first
   letter — "iPhone" is the exception to leave alone: do not capitalise a special-form term).
8. Never throw; on any internal error return the input unchanged.

Pipeline: `src/main/dictation-controller.ts` `processTake` — apply `correctVocabulary`
**first**, on the raw recogniser text, before cleanup and replacements (cleanup then sees
the right words). Pass `settings.vocabulary` (already parsed terms) and `settings.language`.

## Tests (`tests/vocabulary-correction.test.ts`)

Positive — the first two are the on-device engine's real output for the spoken sentence
"Please send the ITU-T draft to Kirinde before Friday.": "Please send the ITUT draft to
Kirinda before Friday." and "Please send the ITUT draft to Kiranda before Friday.", both
with terms [ITU-T, Kirinde] → "Please send the ITU-T draft to Kirinde before Friday.";
"Please send the ITUT draft to Kurindi" → "Please send the ITU-T draft to Kirinde"; "open data verse" → "open Dataverse"; "I T U T" →
"ITU-T"; "github" → "GitHub"; "kirinde" (lower-case) → "Kirinde"; "g 9960" → "G.9960";
multi-word term "Power Automate" from "power automate" (special form? no — both tokens are
common words → exact multi-token match still applies because the span is more than one
token: assert it becomes "Power Automate").
Negative: "The coffee machine is broken" with [koffi] unchanged; "I ate an apple" with
[Apple] unchanged; "data is great" with [Dataverse] unchanged; a German sentence with an
English-looking near miss unchanged when language is `de` (near-miss rules off) but an
exact multi-token match still applies; empty terms → unchanged; spans never cross a comma
or full stop ("data. Verse" unchanged); overlapping candidates resolve to the longest.
Performance: 100 terms × a 300-word transcript runs under 50 ms (assert loosely, e.g.
< 250 ms, to avoid flakiness).

Controller test: correction is applied before cleanup (e.g. "um the ITUT draft" → "The
ITU-T draft").

## Done when

`npm run typecheck && npx vitest run && npm run lint` pass. Do not commit.
