import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCommonWords, parseWordList } from '../src/main/common-words'
import { correctVocabulary } from '../src/shared/vocabulary-correction'

/**
 * The real SCOWL list, as the main process loads it. The correction's own
 * tests use a small stand-in; these prove the shipped list protects the
 * words it has to and leaves the user's names free to be corrected.
 */

const FILE = join(__dirname, '../src/main/data/common-words.txt')

describe('the shipped word list', () => {
  it('is lower-case letters, two or more to a word, one per line, sorted and unique', () => {
    const text = readFileSync(FILE, 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text).not.toContain('\r')
    const lines = text.slice(0, -1).split('\n')
    expect(lines.length).toBeGreaterThan(50_000)
    expect(lines.every((line) => /^\p{Ll}{2,}$/u.test(line))).toBe(true)
    expect(new Set(lines).size).toBe(lines.length)
    expect([...lines].sort()).toEqual(lines)
  })

  it('knows the ordinary words the correction must leave alone', async () => {
    const isCommon = await loadCommonWords()
    for (const word of ['coffee', 'apple', 'data', 'verse', 'power', 'automate', 'who', 'monday']) {
      expect(isCommon(word), word).toBe(true)
    }
  })

  it('does not know the names and misspellings it must be free to correct', async () => {
    const isCommon = await loadCommonWords()
    for (const word of ['kirinde', 'kirinda', 'kiranda', 'kurindi', 'koffi', 'dataverse', 'itut']) {
      expect(isCommon(word), word).toBe(false)
    }
  })

  it('is read once, however many dictations ask for it', () => {
    expect(loadCommonWords()).toBe(loadCommonWords())
  })

  it('reads a list saved with Windows line endings or blank lines the same way', () => {
    expect([...parseWordList('coffee\r\napple\r\n\r\ndata\n')]).toEqual(['coffee', 'apple', 'data'])
  })
})

describe('the correction, with the shipped list', () => {
  const terms = ['ITU-T', 'Kirinde', 'Dataverse', 'GitHub', 'G.9960', 'Power Automate', 'koffi']

  it('corrects the cases it is meant to', async () => {
    const isCommon = await loadCommonWords()
    const fix = (text: string): string => correctVocabulary(text, terms, 'en', isCommon)
    expect(fix('Please send the ITUT draft to Kirinda before Friday.')).toBe(
      'Please send the ITU-T draft to Kirinde before Friday.'
    )
    expect(fix('Please send the ITUT draft to Kiranda before Friday.')).toBe(
      'Please send the ITU-T draft to Kirinde before Friday.'
    )
    expect(fix('Please send the ITUT draft to Kurindi')).toBe(
      'Please send the ITU-T draft to Kirinde'
    )
    expect(fix('open data verse')).toBe('open Dataverse')
    expect(fix('I T U T')).toBe('ITU-T')
    expect(fix('github')).toBe('GitHub')
    expect(fix('kirinde')).toBe('Kirinde')
    expect(fix('g 9960')).toBe('G.9960')
    expect(fix('power automate')).toBe('Power Automate')
  })

  it('leaves real words alone', async () => {
    const isCommon = await loadCommonWords()
    expect(correctVocabulary('The coffee machine is broken', ['koffi'], 'en', isCommon)).toBe(
      'The coffee machine is broken'
    )
    expect(correctVocabulary('I ate an apple', ['Apple'], 'en', isCommon)).toBe('I ate an apple')
    expect(correctVocabulary('data is great', ['Dataverse'], 'en', isCommon)).toBe('data is great')
    expect(correctVocabulary('Who is coming?', ['WHO'], 'en', isCommon)).toBe('Who is coming?')
  })
})
