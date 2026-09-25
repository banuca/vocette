/**
 * Spoken corrections: the edits a speaker makes out loud.
 *
 * "Send the report today. Scratch that. Send it tomorrow." and "move it to
 * Tuesday, no sorry, Wednesday" are instructions, not words to keep. Only the
 * common, high-confidence shapes are acted on; anything ambiguous is left
 * exactly as it was said. A wrong guess here deletes the user's own words,
 * which is far worse than leaving a correction for them to tidy by hand.
 *
 * Pure: no Electron, no I/O, and every pattern below is a constant.
 */

/** One whitespace-separated word, located in the text it came from. */
interface Token {
  /** Offset in the full text, after any opening quote or bracket. */
  start: number
  /** The word without its surrounding punctuation: `Tuesday,` → `Tuesday`. */
  core: string
}

type Kind = 'number' | 'weekday' | 'month' | 'determiner' | 'pronoun' | 'proper'

const NUMBER_WORDS = new Set([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
  'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred',
  'thousand'
])
const WEEKDAYS = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
])
const MONTHS = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december'
])
const DETERMINERS = new Set([
  'the', 'a', 'an', 'my', 'your', 'our', 'their', 'his', 'her', 'this', 'that', 'these', 'those'
])
const PRONOUNS = new Set(['i', 'we', 'you', 'he', 'she', 'they', 'it'])

/** How far back a repair may reach for the word it replaces. */
const LOOK_BACK = 4

/**
 * Words that add emphasis rather than replace: "It was good, actually,
 * really good" strengthens "good", it does not correct "was".
 */
const INTENSIFIERS = new Set([
  'really', 'very', 'so', 'quite', 'pretty', 'right', 'just', 'much', 'even', 'too', 'totally',
  'absolutely', 'extremely', 'super'
])

/**
 * A sentence ends at `.`, `!` or `?` followed by whitespace — so never inside
 * `3.5` or `example.com` — or at a line break.
 */
const SENTENCE_END = /[.!?]+["'”’)\]]*(?=\s|$)|\n/gu

/**
 * "scratch that" / "strike that", and only where the phrase ends a clause
 * with a comma, a full stop or an exclamation mark, a line break or the end
 * of the text: "strike that match" and "scratch that itch" are ordinary
 * words, and "Can you strike that?" is a question. "delete that" is
 * deliberately absent — "Please delete that file." is an instruction the
 * user wants typed, not an edit.
 */
const DISCARD_MARKER =
  /(?<![\p{L}\p{N}\p{M}'’-])(?:scratch|strike)[ \t]+that(?=[ \t]*(?:[,.!]|\n|$))/iu

/**
 * A correction inside one sentence. The multi-word markers may stand without
 * commas ("to John I mean Sarah"); the single words count only between
 * commas, so "There is no way" and "I actually like it" are never read as
 * corrections. The single-word form stops before its closing comma, so that
 * comma can open the next marker in a run: ", no, sorry, Wednesday".
 */
const INLINE_MARKER =
  /(?<![\p{L}\p{N}\p{M}'’-])(?:no[ \t]+wait|no[ \t]+sorry|i[ \t]+mean|or[ \t]+rather)(?![\p{L}\p{N}\p{M}'’-])|,[ \t]*(?:no|sorry|actually|wait)(?=[ \t]*,)/giu

/**
 * A sentence that opens by correcting the one before it. Recognisers often
 * put a full stop where the speaker only paused: "…to Tuesday. No sorry,
 * Wednesday." "No sorry" and "No, sorry" are the same words — the comma is
 * the recogniser's choice — so both are tried before a bare "No,". A bare
 * "Sorry," / "Actually," / "Wait," is not here: at the start of a sentence
 * those are an apology, a new thought or a pause.
 */
const SENTENCE_START_MARKER =
  /(?:no(?:[ \t]*,[ \t]*|[ \t]+)(?:wait|sorry)|sorry,[ \t]*i[ \t]+mean|i[ \t]+mean|or[ \t]+rather)(?=[ \t]*,|[ \t])|no(?=[ \t]*,)/iuy

/**
 * Text that opens with another marker. In "Tuesday, sorry, I mean Wednesday"
 * the replacement belongs to "I mean"; letting "sorry" take "I mean
 * Wednesday" as its replacement would leave the marker in the output.
 */
const LEADING_MARKER =
  /^(?:(?:no[ \t]+wait|no[ \t]+sorry|i[ \t]+mean|or[ \t]+rather)(?![\p{L}\p{N}\p{M}'’-])|(?:no|sorry|actually|wait)[ \t]*,)/iu

/**
 * The gap after a sentence that ends in exactly one full stop. Never `?` or
 * `!` — "Is it ready? No, not yet." is an answer, not a correction — and
 * never an ellipsis.
 */
const FULL_STOP_GAP = /(?<![.!?])\.[ \t]+/gu

function kindOf(core: string, firstInSentence: boolean): Kind | null {
  const word = core.toLowerCase()
  if (/^\d+(?:[.,]\d+)*$/u.test(core) || NUMBER_WORDS.has(word)) return 'number'
  if (WEEKDAYS.has(word)) return 'weekday'
  if (MONTHS.has(word)) return 'month'
  if (DETERMINERS.has(word)) return 'determiner'
  if (PRONOUNS.has(word)) return 'pronoun'
  // A capital at the start of a sentence says nothing about the word.
  if (!firstInSentence && /^\p{Lu}/u.test(core)) return 'proper'
  return null
}

function tokenise(text: string, offset: number): Token[] {
  const found: Token[] = []
  for (const match of text.matchAll(/\S+/gu)) {
    const raw = match[0]
    const core = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    if (!core) continue
    // An opening quote or bracket stays outside the repair; a currency sign
    // does not, because "$10" is one word and "$20" replaces all of it.
    const opening = /^[\p{Ps}\p{Pi}"']*/u.exec(raw)?.[0].length ?? 0
    found.push({ start: offset + match.index + opening, core })
  }
  return found
}

/** Where the sentence holding `index` begins. */
function sentenceStartBefore(text: string, index: number): number {
  let start = 0
  for (const match of text.slice(0, index).matchAll(SENTENCE_END)) {
    start = match.index + match[0].length
  }
  return start
}

/** Where the sentence running through `index` ends: its terminal punctuation, or the end. */
function sentenceEndAfter(text: string, index: number): number {
  const end = new RegExp(SENTENCE_END)
  end.lastIndex = index
  return end.exec(text)?.index ?? text.length
}

/** Past the comma and spaces that follow a marker. */
function afterSeparator(text: string, index: number): number {
  return index + (/^[ \t]*,?[ \t]*/u.exec(text.slice(index))?.[0].length ?? 0)
}

function sameWord(a: Token, b: Token): boolean {
  return a.core.toLowerCase() === b.core.toLowerCase()
}

/**
 * Whether a replacement may start on the word it lines up with: the same
 * word, or two words of the same kind — two words with no kind count, so
 * "half past two" can become "quarter past two" — but never an intensifier
 * standing in for a different word.
 */
function linesUp(first: Token, replaced: Token, replacedStartsSentence: boolean): boolean {
  if (sameWord(first, replaced)) return true
  if (INTENSIFIERS.has(first.core.toLowerCase())) return false
  return kindOf(first.core, false) === kindOf(replaced.core, replacedStartsSentence)
}

/**
 * Where a spoken repair begins, or `null` when the repair is not clear-cut.
 *
 * A replacement that ends on the same word as the text before the marker
 * replaces that many words: "five past ten, no, ten past ten". Otherwise the
 * replacement's first word must have a kind, and a word of the same kind
 * must sit among the last few words before the marker: "Tuesday …
 * Wednesday", "John … Sarah", "five … six". Nothing else is ever rewritten.
 */
function repairStart(before: Token[], replacement: Token[], maxWords: number): number | null {
  const first = replacement[0]
  const last = replacement.at(-1)
  const end = before.at(-1)
  if (!first || !last || !end || replacement.length > maxWords) return null

  // Checked before the kind rule, which in "five past ten, no, ten past ten"
  // would anchor on the nearer "ten" and keep "five past".
  const alignedIndex = before.length - replacement.length
  const aligned = before[alignedIndex]
  if (
    replacement.length >= 2 &&
    aligned &&
    sameWord(last, end) &&
    linesUp(first, aligned, alignedIndex === 0)
  ) {
    return aligned.start
  }

  const kind = kindOf(first.core, false)
  if (!kind) return null
  // A lone pronoun or determiner is not a repair: "Thank you so much, I mean
  // it." is emphasis, and "it" cannot stand in for "you so much".
  if (replacement.length === 1 && (kind === 'pronoun' || kind === 'determiner')) return null

  const recent = before.slice(-LOOK_BACK)
  const skipped = before.length - recent.length
  // A speaker who restarts on the same word marks exactly where the repair
  // begins: "I like it, no, I love it" restarts at "I", not at the nearer "it".
  const restart = recent.findLast((token) => sameWord(token, first))
  // A pronoun anchors only on itself. Any other pronoun nearby is usually
  // part of the sentence being kept: in "Thank you, I mean it sincerely"
  // there is no earlier "it", so nothing is being repaired.
  if (kind === 'pronoun') return restart ? restart.start : null
  const anchor =
    restart ??
    recent.findLast((token, index) => kindOf(token.core, skipped + index === 0) === kind)
  return anchor ? anchor.start : null
}

/** Rejoins what was kept with what followed a discarded sentence. */
function joinAfterDiscard(kept: string, rest: string): string {
  // A line break the speaker asked for after the marker is theirs to keep,
  // unless what was kept already ends on one.
  if (!kept) return rest.replace(/^[ \t]+/u, '')
  if (kept.endsWith('\n')) return kept + rest.replace(/^\s+/u, '')
  if (!rest || rest.startsWith('\n')) return kept + rest
  return `${kept} ${rest}`
}

/**
 * "Scratch that" removes itself and the sentence it refers to: everything
 * back to the previous sentence boundary. Spoken as a sentence of its own it
 * takes the one before; spoken mid-sentence it takes that sentence so far.
 * Earlier sentences always stay.
 */
export function applyDiscardMarkers(input: string): string {
  let text = input
  for (let match = DISCARD_MARKER.exec(text); match; match = DISCARD_MARKER.exec(text)) {
    // Drop the marker's own leading comma and the full stop of the sentence
    // being discarded, so the search finds the boundary before that sentence.
    const head = text.slice(0, match.index).replace(/[\s,.;:!?"'”’)\]]+$/u, '')
    const kept = head.slice(0, sentenceStartBefore(head, head.length))
    const rest = text.slice(match.index + match[0].length).replace(/^[ \t]*[,.;:!?]*[ \t]*/u, '')
    text = joinAfterDiscard(kept, rest)
  }
  return text
}

/**
 * "Tuesday, no sorry, Wednesday" → "Wednesday", within one sentence, when
 * the replacement runs to the end of the sentence in at most four words.
 */
export function applyInlineCorrections(input: string): string {
  let text = input
  const marker = new RegExp(INLINE_MARKER)
  for (let match = marker.exec(text); match; match = marker.exec(text)) {
    const replacementStart = afterSeparator(text, match.index + match[0].length)
    if (LEADING_MARKER.test(text.slice(replacementStart))) continue
    const sentenceStart = sentenceStartBefore(text, match.index)
    const start = repairStart(
      tokenise(text.slice(sentenceStart, match.index), sentenceStart),
      tokenise(text.slice(replacementStart, sentenceEndAfter(text, replacementStart)), replacementStart),
      LOOK_BACK
    )
    if (start === null) continue
    text = text.slice(0, start) + text.slice(replacementStart)
    // The replacement may hold the next marker of a run; look again from it.
    marker.lastIndex = start
  }
  return text
}

/**
 * "…to Tuesday. No sorry, Wednesday." → "…to Wednesday." The same kind rule
 * as inside a sentence, reaching back over one full stop, with a replacement
 * of at most three words. On success the two sentences become one.
 */
export function applySentenceStartCorrections(input: string): string {
  let text = input
  const gap = new RegExp(FULL_STOP_GAP)
  for (let match = gap.exec(text); match; match = gap.exec(text)) {
    const marker = new RegExp(SENTENCE_START_MARKER)
    marker.lastIndex = match.index + match[0].length
    const opening = marker.exec(text)
    if (!opening) continue
    const replacementStart = afterSeparator(text, opening.index + opening[0].length)
    if (LEADING_MARKER.test(text.slice(replacementStart))) continue
    const previousStart = sentenceStartBefore(text, match.index)
    const start = repairStart(
      tokenise(text.slice(previousStart, match.index), previousStart),
      tokenise(text.slice(replacementStart, sentenceEndAfter(text, replacementStart)), replacementStart),
      3
    )
    if (start === null) continue
    text = text.slice(0, start) + text.slice(replacementStart)
    gap.lastIndex = start
  }
  return text
}

/** The spoken-corrections pass: discards first, then repairs. */
export function applySpokenCorrections(text: string): string {
  return applySentenceStartCorrections(applyInlineCorrections(applyDiscardMarkers(text)))
}
