import { englishRulesFor } from './cleanup'

/**
 * Your words, spelled right on every engine.
 *
 * The vocabulary biases a cloud recogniser through its keyword list or its
 * prompt, but the on-device engine takes no prompt at all, and even a biased
 * cloud model still writes "ITUT", "data verse" or "Kurindi". This pass runs
 * after recognition, for every engine, and turns a near-miss of one of the
 * user's own terms into the term — without ever turning a real word into one:
 * "coffee" stays "coffee" even with "koffi" in the list.
 *
 * Deterministic and pure. The common-word list it guards with is passed in,
 * so the main process supplies the real one and tests supply their own.
 */

/** Whether a word — lower-case, letters only — is a common English word. */
export type CommonWordTest = (word: string) => boolean

/**
 * Without a list, every word counts as common: only the corrections that
 * cannot turn a real word into a term still run — a span of several words
 * ("data verse"), or a term with a form no plain word has ("ITUT" → "ITU-T").
 */
const EVERY_WORD_IS_COMMON: CommonWordTest = () => true

/** The longest run of words a span may cover. */
const MAX_SPAN_TOKENS = 4
/** Shorter terms ("IT", "Al") would match far too much, so they are left alone. */
const MIN_TERM_LENGTH = 3
/** Near misses only for terms long enough that a near miss means something. */
const MIN_NEAR_MISS_LENGTH = 5
/** From this length a term may be matched on spelling alone, without the phonetic key. */
const LONG_TERM_LENGTH = 8
const MIN_LENGTH_RATIO = 0.75
const MAX_LENGTH_RATIO = 1.34

/**
 * A word as the recogniser wrote it: letters, digits and combining marks,
 * with an apostrophe, hyphen or full stop allowed only between two of them —
 * "don't", "ITU-T", "G.9960". Marks count as letters here, as they do in
 * cleanup: in Hindi or a decomposed accent the mark is part of its word.
 */
const WORD = /[\p{L}\p{N}\p{M}]+(?:['’.-][\p{L}\p{N}\p{M}]+)*/gu

/** What `norm` keeps. */
const NOT_ALPHANUMERIC = /[^\p{L}\p{N}\p{M}]/gu

/**
 * Between two words of one span: spaces, or a single hyphen ("ITU - T").
 * Sentence punctuation — `.`, `!`, `?`, `…`, a line break, `,`, `;`, `:` —
 * ends a span, and so does anything else: a quote or a bracket between two
 * words would be swallowed by the replacement.
 */
const SPAN_GAP = /^[^\S\r\n\p{Zl}\p{Zp}]*(?:[-\u2010\u2011][^\S\r\n\p{Zl}\p{Zp}]*)?$/u

/** What makes the word after it the first of a sentence. */
const SENTENCE_END = /[.!?…\r\n\p{Zl}\p{Zp}]/u

/**
 * A word touching one of these is part of an address, a path or code: a
 * slash or backslash, `@`, a query string's `=` and `&`, an anchor's `#`, or
 * an identifier's `_`.
 */
const ADDRESS_MARK = /[/\\@#=&_]/u

interface Token {
  start: number
  end: number
  /** Lower-case letters, digits and marks only. */
  norm: string
  common: boolean
  /** The first word of the text or of a sentence. */
  sentenceStart: boolean
  /**
   * Part of a web address, an email address, a file path or code — "banuca"
   * in `github.com/banuca`, "KIRINDE" in `C:\Users\KIRINDE`, "github" in
   * `utm_source=github` — which must be left exactly as written.
   */
  address: boolean
}

interface Term {
  /** Exactly as the user typed it; this is what goes into the text. */
  text: string
  norm: string
  /** Letter and digit runs: "ITU-T" is two, which is what lets "I T U T" reach it. */
  maxTokens: number
  special: boolean
  /**
   * Special only for its capitals — "WHO", "NASA", ".NET" — so a plain word
   * can share its letters. "ITU-T" and "G.9960" are not: no word has a hyphen
   * or a digit in the middle.
   */
  acronym: boolean
  startsLowerCase: boolean
  key: string
}

interface Candidate {
  start: number
  /** In tokens. */
  length: number
  term: Term
  exact: boolean
  distance: number
  /** Position in the user's list, the last tie-breaker. */
  order: number
}

/** Lower-case, letters and digits only: `ITU-T` → `itut`, `G.9960` → `g9960`. */
function norm(text: string): string {
  // NFC first, so a decomposed accent matches the composed one the list uses.
  return text.normalize('NFC').toLowerCase().replace(NOT_ALPHANUMERIC, '')
}

/**
 * A special form is one no plain word has: a capital after the first letter
 * of a word ("GitHub", "iPhone", "ITU"), a digit ("G.9960"), or punctuation
 * inside the term ("ITU-T"). "Power Automate" is not one: each word starts
 * with its only capital.
 */
function termForm(term: string): { special: boolean; acronym: boolean } {
  const digit = /\p{N}/u.test(term)
  // By character, not code unit, so a letter outside the BMP is not split.
  const punctuation = /[^\p{L}\p{M}\p{N}\s]/u.test([...term].slice(1, -1).join(''))
  const innerCapital = term
    .split(/\s+/u)
    .some((word) => /\p{Lu}/u.test([...word].slice(1).join('')))
  const capitalsOnly = /\p{Lu}/u.test(term) && !/\p{Ll}/u.test(term)
  return {
    special: digit || punctuation || innerCapital,
    acronym: capitalsOnly && !digit && !punctuation
  }
}

const PHONETIC_MAP: Readonly<Record<string, string>> = {
  c: 'k',
  q: 'k',
  g: 'k',
  v: 'f',
  z: 's',
  x: 'ks',
  d: 't',
  b: 'p'
}

/**
 * A consonant skeleton, so "Kirinda", "Kiranda" and "Kurindi" all read as
 * "Kirinde": keep the first letter, map c/k/q→k, ck→k, ph→f, v→f, z→s,
 * x→ks, d→t, b→p, g→k, drop vowels and h/w/y after the first letter, and
 * collapse repeated letters.
 *
 * Deliberately crude — "coffee" and "koffi" share a key — which is why a near
 * miss also needs a small edit distance, and why a common English word is
 * never treated as one.
 */
export function phoneticKey(word: string): string {
  const letters = word.replace(/ck/gu, 'k').replace(/ph/gu, 'f')
  let key = ''
  let index = 0
  for (const letter of letters) {
    const first = index === 0
    index += 1
    if (!first && /[aeiouhwy]/u.test(letter)) continue
    for (const sound of PHONETIC_MAP[letter] ?? letter) {
      if (!key.endsWith(sound)) key += sound
    }
  }
  return key
}

/**
 * Levenshtein distance, giving up as soon as it must exceed `limit` — the
 * answer is then `limit + 1`, which is all a caller needs to know.
 */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    let best = i
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
      const value = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution)
      current.push(value)
      if (value < best) best = value
    }
    if (best > limit) return limit + 1
    previous = current
  }
  return previous[b.length] ?? limit + 1
}

/** The terms worth matching, first spelling of each wins, in the user's order. */
function prepareTerms(terms: readonly string[]): Term[] {
  const prepared: Term[] = []
  const seen = new Set<string>()
  for (const raw of terms) {
    if (typeof raw !== 'string') continue
    const text = raw.trim()
    const termNorm = norm(text)
    if (termNorm.length < MIN_TERM_LENGTH || seen.has(termNorm)) continue
    seen.add(termNorm)
    const runs = text.match(/[\p{L}\p{N}\p{M}]+/gu)?.length ?? 1
    prepared.push({
      text,
      norm: termNorm,
      maxTokens: Math.min(MAX_SPAN_TOKENS, runs + 2),
      ...termForm(text),
      startsLowerCase: /^\p{Ll}/u.test(text),
      key: phoneticKey(termNorm)
    })
  }
  return prepared
}

function tokenise(text: string, isCommonWord: CommonWordTest): Token[] {
  const tokens: Token[] = []
  let previousEnd = 0
  for (const match of text.matchAll(WORD)) {
    const start = match.index
    const tokenNorm = norm(match[0])
    // The list leaves out single letters, because SCOWL counts every letter
    // as a word. One letter or digit is never a sign of a name, so it counts
    // as common: "into N" is no near miss of "Intune".
    const common = tokenNorm.length <= 1 || isCommonWord(tokenNorm)
    const end = start + match[0].length
    tokens.push({
      start,
      end,
      norm: tokenNorm,
      common,
      sentenceStart: tokens.length === 0 || SENTENCE_END.test(text.slice(previousEnd, start)),
      address: ADDRESS_MARK.test(text.charAt(start - 1)) || ADDRESS_MARK.test(text.charAt(end))
    })
    previousEnd = end
  }
  return tokens
}

function lengthRatioFits(span: string, term: string): boolean {
  const ratio = span.length / term.length
  return ratio >= MIN_LENGTH_RATIO && ratio <= MAX_LENGTH_RATIO
}

/**
 * How far a span is from a term it nearly matches, or null when it does not.
 * The caller has already ruled out an exact match and a span of common words.
 */
function nearMissDistance(span: string, term: Term, spanKey: () => string): number | null {
  if (term.norm.length < MIN_NEAR_MISS_LENGTH || !lengthRatioFits(span, term.norm)) return null
  // A word that holds the whole term is another word built on it — "MurmurAI",
  // French "Murmure" — not a mishearing of it.
  if (span.includes(term.norm)) return null
  const key = spanKey()
  if (span[0] !== term.norm[0] && key[0] !== term.key[0]) return null
  const soundLimit = Math.max(1, Math.floor(term.norm.length / 3))
  const spellingLimit =
    term.norm.length >= LONG_TERM_LENGTH ? Math.floor(term.norm.length / 5) : -1
  const limit = key === term.key ? Math.max(soundLimit, spellingLimit) : spellingLimit
  if (limit < 0) return null
  const distance = editDistance(span, term.norm, limit)
  return distance <= limit ? distance : null
}

/** Better first: an exact match, then the closer near miss, then the user's order. */
function betterCandidate(a: Candidate, b: Candidate | undefined): boolean {
  if (!b) return true
  if (a.exact !== b.exact) return a.exact
  if (a.distance !== b.distance) return a.distance < b.distance
  return a.order < b.order
}

/** The term as it goes into the text, with a sentence's opening capital kept. */
function replacementText(text: string, candidate: Candidate, tokens: readonly Token[]): string {
  const { term } = candidate
  const first = tokens[candidate.start]
  if (!first || !first.sentenceStart || !term.startsLowerCase || term.special) return term.text
  // Kept, not added: only a span that opened its sentence with a capital.
  if (!/^\p{Lu}/u.test(text.slice(first.start, first.end))) return term.text
  const initial = term.text.codePointAt(0) ?? 0
  const width = initial > 0xffff ? 2 : 1
  return `${term.text.slice(0, width).toUpperCase()}${term.text.slice(width)}`
}

function correct(
  text: string,
  terms: readonly string[],
  language: string,
  isCommonWord: CommonWordTest
): string {
  const prepared = prepareTerms(terms)
  if (prepared.length === 0) return text
  const tokens = tokenise(text, isCommonWord)
  if (tokens.length === 0) return text

  const exactTerms = new Map<string, Term>()
  prepared.forEach((term) => exactTerms.set(term.norm, term))
  const order = new Map<Term, number>()
  prepared.forEach((term, index) => order.set(term, index))
  const longestTerm = prepared.reduce((longest, term) => Math.max(longest, term.maxTokens), 1)
  const english = englishRulesFor(language, text) !== 'none'

  // Whether the gap after each token can sit inside a span.
  const joins = tokens.map((token, index) => {
    const next = tokens[index + 1]
    return next !== undefined && SPAN_GAP.test(text.slice(token.end, next.start))
  })

  /** Every term that matched each span, so a longer near miss can be checked for minimality. */
  const matched = new Map<string, Set<Term>>()
  const candidates: Candidate[] = []

  for (let length = 1; length <= longestTerm; length += 1) {
    for (let start = 0; start + length <= tokens.length; start += 1) {
      let crosses = false
      for (let index = start; index < start + length - 1; index += 1) {
        if (!joins[index]) crosses = true
      }
      if (crosses) continue

      const span = tokens.slice(start, start + length)
      if (span.some((token) => token.address)) continue
      const spanNorm = span.map((token) => token.norm).join('')
      const allCommon = span.every((token) => token.common)
      let best: Candidate | undefined
      const spanTerms = new Set<Term>()

      const exact = exactTerms.get(spanNorm)
      if (
        exact &&
        length <= exact.maxTokens &&
        // One word needs a reason to change: a form no plain word has, or a
        // word that is not common English — so "kirinde" becomes "Kirinde"
        // but "an apple" is never "an Apple". Capitals alone are no such
        // form when a common word has the same letters: "who" stays "who"
        // with WHO in the list.
        (length > 1 || (exact.special && !(exact.acronym && allCommon)) || !allCommon)
      ) {
        const position = order.get(exact) ?? 0
        best = { start, length, term: exact, exact: true, distance: 0, order: position }
        spanTerms.add(exact)
      }

      if (english && !allCommon) {
        let key: string | undefined
        const spanKey = (): string => (key ??= phoneticKey(spanNorm))
        for (const term of prepared) {
          if (term === exact || length > term.maxTokens) continue
          const distance = nearMissDistance(spanNorm, term, spanKey)
          if (distance === null) continue
          spanTerms.add(term)
          // A longer span is only a near miss when no part of it already
          // matches the same term: "Kirinda a copy" corrects "Kirinda" and
          // keeps the "a".
          if (length > 1 && withinShorterSpan(matched, start, length, term)) continue
          const candidate: Candidate = {
            start,
            length,
            term,
            exact: false,
            distance,
            order: order.get(term) ?? 0
          }
          if (betterCandidate(candidate, best)) best = candidate
        }
      }

      if (spanTerms.size > 0) matched.set(`${start}:${length}`, spanTerms)
      if (best) candidates.push(best)
    }
  }
  if (candidates.length === 0) return text

  // Longest span first, then earliest; a token takes part in one replacement.
  candidates.sort((a, b) => b.length - a.length || a.start - b.start)
  const used = new Array<boolean>(tokens.length).fill(false)
  const chosen: Candidate[] = []
  for (const candidate of candidates) {
    const end = candidate.start + candidate.length
    if (used.slice(candidate.start, end).some(Boolean)) continue
    for (let index = candidate.start; index < end; index += 1) used[index] = true
    chosen.push(candidate)
  }
  chosen.sort((a, b) => a.start - b.start)

  let output = ''
  let cursor = 0
  for (const candidate of chosen) {
    const first = tokens[candidate.start]
    const last = tokens[candidate.start + candidate.length - 1]
    if (!first || !last) continue
    output += text.slice(cursor, first.start) + replacementText(text, candidate, tokens)
    cursor = last.end
  }
  return output + text.slice(cursor)
}

/** Whether a shorter span inside this one already matched the same term. */
function withinShorterSpan(
  matched: ReadonlyMap<string, ReadonlySet<Term>>,
  start: number,
  length: number,
  term: Term
): boolean {
  for (let size = 1; size < length; size += 1) {
    for (let offset = 0; offset + size <= length; offset += 1) {
      if (matched.get(`${start + offset}:${size}`)?.has(term)) return true
    }
  }
  return false
}

/**
 * Turns near-misses of the user's own terms into the terms, as the user
 * typed them.
 *
 * An exact match ignores case and punctuation ("I T U T", "ITUT" → "ITU-T";
 * "data verse" → "Dataverse") and applies in every language. A near miss —
 * the same consonant skeleton and a small edit distance ("Kirinda" →
 * "Kirinde") — is English only, and never changes a common English word.
 * A span never crosses sentence punctuation, overlapping candidates go to
 * the longest, and addresses, paths and code are left as written.
 *
 * `language` is `'auto'` or an ISO-639-1 code; under Automatic the near-miss
 * rules follow cleanup's reading of whether the text is English. Never
 * throws: on any internal error the text comes back unchanged.
 */
export function correctVocabulary(
  text: string,
  terms: readonly string[],
  language: string,
  isCommonWord: CommonWordTest = EVERY_WORD_IS_COMMON
): string {
  try {
    if (typeof text !== 'string' || !text || !Array.isArray(terms) || terms.length === 0) {
      return text
    }
    return correct(text, terms, language, isCommonWord)
  } catch {
    return text
  }
}
