import type { CommonWordTest } from '../shared/vocabulary-correction'

/**
 * The common English words the vocabulary correction must never turn into
 * one of the user's terms: about 73,000 word forms from SCOWL, lower-case,
 * letters only. See `data/README.md` for where the list comes from, how it
 * was made, and its copyright notice.
 *
 * Main process only, and loaded on first use: the build gives the list a
 * chunk of its own, so nothing reads it until the first dictation with a
 * vocabulary, and the renderer never carries it.
 */

/** Without the list, every word counts as common — the cautious way to be wrong. */
const EVERY_WORD_IS_COMMON: CommonWordTest = () => true

let loading: Promise<CommonWordTest> | null = null

/** One word per line; anything else — a blank line, a stray `\r` — is not a word. */
export function parseWordList(text: string): Set<string> {
  const words = new Set<string>()
  for (const line of text.split(/\r?\n/u)) {
    const word = line.trim()
    if (word) words.add(word)
  }
  return words
}

/**
 * The test for a common word, read once into a `Set`. Never rejects: if the
 * list cannot be read, every word counts as common, which leaves only the
 * corrections that cannot change a real word.
 */
export function loadCommonWords(): Promise<CommonWordTest> {
  loading ??= import('./data/common-words.txt?raw')
    .then(({ default: text }) => {
      const words = parseWordList(text)
      if (words.size === 0) throw new Error('The common-word list is empty.')
      return (word: string): boolean => words.has(word)
    })
    .catch((error: unknown) => {
      console.error('Vocette could not read its common-word list:', error)
      return EVERY_WORD_IS_COMMON
    })
  return loading
}
