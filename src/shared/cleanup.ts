const FILLER_PATTERN = /\b(?:um+|uh+|erm+|hmm+)\b(?:\s*,\s*)?/giu

/**
 * Removes filler words and repairs spacing/capitalisation without rewriting
 * what the speaker actually said.
 */
export function lightCleanup(input: string): string {
  let text = input
    .trim()
    .replace(FILLER_PATTERN, '')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .replace(/([,.;:!?])(?=[\p{L}\p{N}])/gu, '$1 ')
    .replace(/([!?.,])\1+/gu, '$1')
    .replace(/\s{2,}/gu, ' ')
    .trim()

  if (!text) return ''

  const firstLetterIndex = text.search(/\p{L}/u)
  if (firstLetterIndex >= 0) {
    const letter = text[firstLetterIndex]
    if (letter) {
      text = `${text.slice(0, firstLetterIndex)}${letter.toLocaleUpperCase()}${text.slice(firstLetterIndex + 1)}`
    }
  }

  return text.replace(
    /([.!?]\s+)(\p{Ll})/gu,
    (_match, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase()}`
  )
}
