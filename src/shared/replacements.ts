/**
 * Replacements and snippets: the user's own rules for turning what they said
 * into what they meant — house style ("itu" → "ITU"), expansions ("my email"
 * → an address), code ("console log" → `console.log()`), and snippets that
 * expand a spoken trigger into a whole block of text.
 *
 * A vocabulary entry tells the recogniser a word exists; a replacement acts
 * on the text that came back. Rules run in the main process, after cleanup,
 * on this computer: unlike the vocabulary, none of this is sent anywhere.
 *
 * Stored as one newline-delimited string, exactly as the user typed it, so
 * the text area round-trips without surprises. Parsing is pure, so the
 * Settings note can count exactly the rules a dictation will apply.
 */

export interface ReplacementRule {
  /** What the user says, trimmed, with runs of whitespace collapsed to one space. */
  spoken: string
  /** What goes in its place, with `\n` already turned into a line break. */
  written: string
}

export interface ParsedReplacements {
  rules: ReplacementRule[]
  /** Lines that could not be a rule. Blank lines and comments are not counted. */
  ignored: number
}

/** Ceiling on the stored string, applied on both the load and save paths. */
export const MAX_REPLACEMENTS_CHARS = 20_000
/** Ceiling on rules applied, which also bounds the one pattern built from them. */
export const MAX_REPLACEMENT_RULES = 200
/** A trigger is a phrase, not a sentence. */
export const MAX_SPOKEN_CHARS = 60
/** Room for a signature or an address block. */
export const MAX_WRITTEN_CHARS = 1_000

/**
 * A letter, digit or combining mark: what a whole-word match may not touch.
 * Marks count because in Hindi or Thai, and in a decomposed accent, the vowel
 * sign or accent is a code point of its own, and a rule must not fire on the
 * letters in front of it.
 */
const WORD_CHAR = String.raw`[\p{L}\p{N}\p{M}]`

/**
 * Between two words of a phrase: a run of spaces or tabs, or a comma the
 * recogniser put there — "my, email" is still "my email". Never a line
 * break: that was asked for out loud ("new line"), and a rule must not
 * swallow it.
 */
const WORD_GAP = String.raw`(?:[ \t]*,[ \t]*|[ \t]+)`

/**
 * After a snippet that spans lines, the one full stop or comma the recogniser
 * put after its trigger: "Thanks. Sign off." must not end a signature on a
 * stray full stop. Taken only where the dictation ends or a new line starts:
 * mid-sentence the stop keeps what follows readable ("…Alex, see you soon"),
 * and an ellipsis is never split.
 */
const TRAILING_STOP = String.raw`(?:[.,](?=[ \t]*(?:\n|$)))?`

/**
 * Trims the stored string to the ceiling **on a line boundary**.
 *
 * A plain `slice` would cut the last rule in half, and the half would still
 * parse: a truncated address or signature, pasted as if it were whole.
 * Dropping the partial line is the only truthful way to lose characters here.
 */
export function clampReplacements(raw: string): string {
  if (raw.length <= MAX_REPLACEMENTS_CHARS) return raw
  const cut = raw.slice(0, MAX_REPLACEMENTS_CHARS)
  const lastBreak = cut.lastIndexOf('\n')
  // No newline inside the budget means the first line alone overruns it; keep
  // nothing rather than half a rule.
  return lastBreak === -1 ? '' : cut.slice(0, lastBreak)
}

/**
 * The identity of a phrase for de-duplication: what it matches, not how it
 * was typed. `toLowerCase`, not `toLocaleLowerCase` — a Turkish machine must
 * parse the same list the same way a Swiss one does — and either apostrophe,
 * because the matcher accepts either.
 */
function phraseKey(phrase: string): string {
  return phrase.toLowerCase().replace(/’/gu, "'")
}

/**
 * `\n` in a written side is a line break, so a snippet can span lines in a
 * box that holds one rule per line; `\\n` is the two characters `\n`, for
 * code that needs them. No other backslash sequence is special.
 */
function decodeLineBreaks(written: string): string {
  return written.replace(/\\\\n|\\n/gu, (escape) => (escape.length === 3 ? '\\n' : '\n'))
}

/**
 * Splits the stored string into the rules a dictation will apply.
 *
 * A line that cannot be a rule — no `=>`, nothing on one side of it, or a
 * side over its limit — is counted, so the Settings note can say a line is
 * not working instead of letting it fail in silence. Blank lines and `#`
 * comments are not counted: they were never meant to be rules.
 */
export function parseReplacements(raw: string): ParsedReplacements {
  // Keyed by phrase, so a later line redefines an earlier one where it
  // stands: the user's override holds even in a list that runs past the cap.
  const byPhrase = new Map<string, ReplacementRule>()
  let ignored = 0
  for (const line of raw ? raw.split(/\r?\n/u) : []) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    // The first arrow splits the line, so a written side may contain one.
    const arrow = trimmed.indexOf('=>')
    const spoken = arrow === -1 ? '' : trimmed.slice(0, arrow).trim()
    const written = arrow === -1 ? '' : trimmed.slice(arrow + 2).trim()
    // Measured as typed, which is what the user can see and count.
    if (
      !spoken ||
      !written ||
      spoken.length > MAX_SPOKEN_CHARS ||
      written.length > MAX_WRITTEN_CHARS
    ) {
      ignored += 1
      continue
    }
    const phrase = spoken.split(/\s+/u).join(' ')
    byPhrase.set(phraseKey(phrase), { spoken: phrase, written: decodeLineBreaks(written) })
  }
  return { rules: [...byPhrase.values()].slice(0, MAX_REPLACEMENT_RULES), ignored }
}

/**
 * One word of a phrase as a pattern that matches only itself: `c++` and
 * `console.log()` are text the user expects to hear, not syntax.
 */
function literal(word: string): string {
  return (
    word
      .replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')
      // Recognisers write either apostrophe, and a keyboard types the plain one.
      .replace(/['’]/gu, "['’]")
  )
}

function phrasePattern(spoken: string): string {
  return spoken.trim().split(/\s+/u).map(literal).join(WORD_GAP)
}

/**
 * `{date}` and `{time}`, read when the text is inserted rather than when the
 * rule was saved, and formatted for the default locale. Anything else in
 * braces is kept as typed: it may well be code.
 */
function expandVariables(written: string, now: Date): string {
  return written.replace(/\{(date|time)\}/gu, (_token: string, name: string) =>
    name === 'date'
      ? now.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
      : now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  )
}

/**
 * Applies the rules to a finished transcript, in one pass from left to right.
 *
 * Every phrase goes into one pattern, longest first, so where "new york" and
 * "new york city" could both match, the longer one does. A phrase matches
 * only as whole words and ignores capitals. What a rule inserts is never
 * scanned again, so rules cannot chain ("a => b" and "b => c" turn "a" into
 * "b") or loop.
 *
 * The written side goes in exactly as typed, with no capital added even at
 * the start of a sentence: a code snippet must keep its case, and the user
 * has already written the capitals they want. What follows the phrase stays
 * ("my email." keeps its full stop), except that a snippet spanning lines
 * takes one full stop or comma after it with it.
 *
 * `now` is the moment `{date}` and `{time}` describe; injectable for tests.
 */
export function applyReplacements(
  text: string,
  rules: readonly ReplacementRule[],
  now: Date = new Date()
): string {
  // An empty phrase would match everywhere, so it never joins the pattern.
  // `filter` copies, so the sort leaves the caller's list alone.
  const ordered = rules
    .filter((rule) => rule.spoken.trim() !== '')
    .sort((a, b) => b.spoken.length - a.spoken.length)
  if (!text || ordered.length === 0) return text

  // One capture per rule, in `ordered` order, so a match says which rule it
  // was. The whole-word check sits right after the phrase, before any stop a
  // multi-line snippet takes, so it is always the phrase that must end a word.
  const alternatives = ordered
    .map((rule) => {
      const stop = rule.written.includes('\n') ? TRAILING_STOP : ''
      return `(${phrasePattern(rule.spoken)})(?!${WORD_CHAR})${stop}`
    })
    .join('|')
  const pattern = new RegExp(`(?<!${WORD_CHAR})(?:${alternatives})`, 'giu')

  // A function, not a replacement string: a `$` in what the user wrote is
  // theirs, never a reference to part of the match.
  return text.replace(pattern, (match: string, ...captures: unknown[]) => {
    const rule = ordered.find((_rule, index) => captures[index] !== undefined)
    return rule ? expandVariables(rule.written, now) : match
  })
}
