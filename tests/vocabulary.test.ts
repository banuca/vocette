import { describe, expect, it } from 'vitest'
import { PRO_VOCABULARY_TERMS } from '../src/shared/product'
import {
  MAX_KEYWORD_TERMS,
  MAX_PROMPT_TERM_CHARS,
  MAX_VOCABULARY_CHARS,
  MAX_VOCABULARY_TERMS,
  MAX_VOCABULARY_TERM_CHARS,
  budgetPromptTerms,
  clampVocabulary,
  parseVocabulary,
  supportsKeywordList
} from '../src/shared/vocabulary'

describe('parseVocabulary', () => {
  it('returns nothing for an empty or blank list', () => {
    expect(parseVocabulary('')).toEqual([])
    expect(parseVocabulary('   \n\n  \t \n')).toEqual([])
  })

  it('trims each line and drops the blank ones', () => {
    expect(parseVocabulary('  Kirinde \n\n\tITU-T\n   \nDataverse  ')).toEqual([
      'Kirinde',
      'ITU-T',
      'Dataverse'
    ])
  })

  it('splits on CRLF as well as LF', () => {
    expect(parseVocabulary('Kirinde\r\nITU-T\r\nDataverse')).toEqual([
      'Kirinde',
      'ITU-T',
      'Dataverse'
    ])
  })

  it('preserves the order the user typed', () => {
    expect(parseVocabulary('zeta\nalpha\nmiddle')).toEqual(['zeta', 'alpha', 'middle'])
  })

  it('keeps a term of exactly the maximum length', () => {
    const term = 'a'.repeat(MAX_VOCABULARY_TERM_CHARS)
    expect(parseVocabulary(term)).toEqual([term])
  })

  it('drops an over-long term rather than truncating it', () => {
    // Half a term would bias the recogniser towards something the user never
    // asked for, so it is omitted entirely.
    const tooLong = 'a'.repeat(MAX_VOCABULARY_TERM_CHARS + 1)
    expect(parseVocabulary(`Kirinde\n${tooLong}\nITU-T`)).toEqual(['Kirinde', 'ITU-T'])
  })

  it("has room for Pro's list, which Free uses the first part of", () => {
    // The parser's cap is Pro's; Free's lower cap is applied where a
    // dictation reads its settings, so a stored list is never cut short.
    expect(MAX_VOCABULARY_TERMS).toBe(PRO_VOCABULARY_TERMS)
    expect(MAX_VOCABULARY_TERMS).toBe(500)
    expect(MAX_VOCABULARY_CHARS).toBe(20_000)
    expect(MAX_KEYWORD_TERMS).toBe(100)
  })

  it('caps the list at the maximum number of terms', () => {
    const raw = Array.from({ length: MAX_VOCABULARY_TERMS + 25 }, (_, index) => `term${index}`)
    const terms = parseVocabulary(raw.join('\n'))
    expect(terms).toHaveLength(MAX_VOCABULARY_TERMS)
    expect(terms[0]).toBe('term0')
    expect(terms.at(-1)).toBe(`term${MAX_VOCABULARY_TERMS - 1}`)
  })

  it('drops a repeated term, ignoring case', () => {
    // The same term twice buys no accuracy and spends part of whisper-1's
    // 224-token prompt window.
    expect(parseVocabulary('Kirinde\nITU-T\nkirinde\nKIRINDE')).toEqual(['Kirinde', 'ITU-T'])
  })

  it('de-duplicates the same way regardless of host locale', () => {
    // toLowerCase, not toLocaleLowerCase: a Turkish machine maps 'I' to a
    // dotless i and would otherwise parse this list differently from a Swiss
    // one, so the same settings file would produce two different requests.
    expect(parseVocabulary('ITU\nitu')).toEqual(['ITU'])
    expect(parseVocabulary('Istanbul\nISTANBUL')).toEqual(['Istanbul'])
  })

  it('counts only kept terms towards the cap', () => {
    const raw = ['dup', 'dup', 'a'.repeat(MAX_VOCABULARY_TERM_CHARS + 1), '', 'second']
    expect(parseVocabulary(raw.join('\n'))).toEqual(['dup', 'second'])
  })
})

describe('supportsKeywordList', () => {
  it('is true for gpt-transcribe against OpenAI', () => {
    expect(supportsKeywordList('gpt-transcribe', '')).toBe(true)
  })

  it('is false for every other curated and custom model', () => {
    // gpt-4o-transcribe is deliberately excluded: OpenAI documents the keyword
    // field for gpt-transcribe, and an unknown multipart field is a 400 on a
    // strict server.
    expect(supportsKeywordList('gpt-4o-transcribe', '')).toBe(false)
    expect(supportsKeywordList('gpt-4o-mini-transcribe', '')).toBe(false)
    expect(supportsKeywordList('whisper-1', '')).toBe(false)
    expect(supportsKeywordList('whisper-large-v3', '')).toBe(false)
    expect(supportsKeywordList('', '')).toBe(false)
  })

  it('is false against a custom endpoint even for the right model name', () => {
    // A Groq or local server is free to reject an unknown field. The prompt
    // path works everywhere, so it is the safe default away from OpenAI.
    expect(supportsKeywordList('gpt-transcribe', 'https://api.groq.com/openai/v1')).toBe(false)
    expect(supportsKeywordList('gpt-transcribe', 'http://localhost:8080/v1')).toBe(false)
  })

  it('ignores surrounding whitespace in the endpoint', () => {
    expect(supportsKeywordList('gpt-transcribe', '   ')).toBe(true)
  })
})

describe('clampVocabulary', () => {
  it('leaves a list inside the ceiling untouched', () => {
    const list = 'Kirinde\nITU-T'
    expect(clampVocabulary(list)).toBe(list)
  })

  it('cuts on a line boundary, never mid-term', () => {
    // A plain slice would leave half a word behind, which parseVocabulary
    // would then bias the recogniser towards.
    const raw = `${'a'.repeat(39)}\n`.repeat(Math.ceil(MAX_VOCABULARY_CHARS / 40) + 60)
    const clamped = clampVocabulary(raw)
    expect(clamped.length).toBeGreaterThan(0)
    expect(clamped.length).toBeLessThanOrEqual(MAX_VOCABULARY_CHARS)
    for (const term of clamped.split('\n')) expect(term).toBe('a'.repeat(39))
  })

  it('never splits a surrogate pair', () => {
    // No newline inside the budget, so nothing is kept rather than half a
    // character.
    expect(clampVocabulary('\u{1F600}'.repeat(MAX_VOCABULARY_CHARS))).toBe('')
  })

  it('keeps the whole lines that precede an enormous one', () => {
    const raw = `Kirinde\nITU-T\n${'z'.repeat(MAX_VOCABULARY_CHARS)}`
    expect(clampVocabulary(raw)).toBe('Kirinde\nITU-T')
  })

  it('leaves a clamped list parseable', () => {
    const raw = `${'term-value-here'}\n`.repeat(400)
    const terms = parseVocabulary(clampVocabulary(raw))
    // De-duplication collapses the repeats; the point is that nothing is a
    // fragment.
    for (const term of terms) expect(term).toBe('term-value-here')
  })
})

describe('budgetPromptTerms', () => {
  it('returns everything when the list is small', () => {
    const terms = ['Kirinde', 'ITU-T', 'Dataverse']
    expect(budgetPromptTerms(terms)).toEqual(terms)
  })

  it('stops before the prompt budget is exceeded', () => {
    // Pro's 500 terms would be several thousand characters — far past
    // whisper-1's 224-token window, which would evict the language hint the
    // prompt was built for.
    const terms = Array.from({ length: MAX_VOCABULARY_TERMS }, (_, i) => `term-number-${i}`)
    const kept = budgetPromptTerms(terms)
    expect(kept.length).toBeLessThan(terms.length)
    expect(kept.join(', ').length).toBeLessThanOrEqual(MAX_PROMPT_TERM_CHARS)
    expect(kept).toEqual(terms.slice(0, kept.length))
  })

  it('keeps nothing rather than a fragment when the first term alone overruns', () => {
    expect(budgetPromptTerms(['x'.repeat(MAX_PROMPT_TERM_CHARS + 1)])).toEqual([])
  })

  it('handles an empty list', () => {
    expect(budgetPromptTerms([])).toEqual([])
  })
})
