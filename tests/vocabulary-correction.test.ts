import { describe, expect, it } from 'vitest'
import { correctVocabulary, phoneticKey } from '../src/shared/vocabulary-correction'

/**
 * A stand-in for the SCOWL list: the ordinary English words these sentences
 * use, so the tests do not depend on the data file. The file itself is
 * checked against the same cases in `common-words.test.ts`.
 */
const COMMON = new Set(
  (
    'please send the draft to before friday open data verse power automate coffee machine ' +
    'is broken ate an apple great copy who coming hearing aids use daily slow said it ' +
    'good in net result love lot split file into blocks'
  ).split(' ')
)
const isCommon = (word: string): boolean => COMMON.has(word)

function fix(text: string, terms: string[], language = 'en'): string {
  return correctVocabulary(text, terms, language, isCommon)
}

describe('what the on-device engine really wrote', () => {
  // The spike's greedy output for "Please send the ITU-T draft to Kirinde
  // before Friday." — at 16 kHz and at 48 kHz.
  it('fixes the acronym and the name in the 16 kHz take', () => {
    expect(fix('Please send the ITUT draft to Kirinda before Friday.', ['ITU-T', 'Kirinde'])).toBe(
      'Please send the ITU-T draft to Kirinde before Friday.'
    )
  })

  it('fixes the acronym and the name in the 48 kHz take', () => {
    expect(fix('Please send the ITUT draft to Kiranda before Friday.', ['ITU-T', 'Kirinde'])).toBe(
      'Please send the ITU-T draft to Kirinde before Friday.'
    )
  })

  it('fixes a vowel-shifted spelling of the name', () => {
    expect(fix('Please send the ITUT draft to Kurindi', ['ITU-T', 'Kirinde'])).toBe(
      'Please send the ITU-T draft to Kirinde'
    )
  })
})

describe('exact matches, ignoring case, spacing and punctuation', () => {
  it('joins a term the recogniser split into two words', () => {
    expect(fix('open data verse', ['Dataverse'])).toBe('open Dataverse')
  })

  it('joins a spelled-out acronym and restores its hyphen', () => {
    expect(fix('I T U T', ['ITU-T'])).toBe('ITU-T')
    expect(fix('the ITU T draft', ['ITU-T'])).toBe('the ITU-T draft')
  })

  it('restores the capitals of a term with a special form', () => {
    expect(fix('github', ['GitHub'])).toBe('GitHub')
  })

  it('capitalises a lower-case word that is not common English', () => {
    expect(fix('kirinde', ['Kirinde'])).toBe('Kirinde')
  })

  it('restores the full stop and capital of a numbered term', () => {
    expect(fix('g 9960', ['G.9960'])).toBe('G.9960')
  })

  it('writes a multi-word term as typed, even when both words are common', () => {
    expect(fix('power automate', ['Power Automate'])).toBe('Power Automate')
  })

  it('applies in every language', () => {
    expect(fix('öffne data verse', ['Dataverse'], 'de')).toBe('öffne Dataverse')
  })
})

describe('never turning a real word into a term', () => {
  it('keeps "coffee" with "koffi" in the list', () => {
    expect(fix('The coffee machine is broken', ['koffi'])).toBe('The coffee machine is broken')
  })

  it('never capitalises "an apple" for a term "Apple"', () => {
    expect(fix('I ate an apple', ['Apple'])).toBe('I ate an apple')
  })

  it('keeps a common word that only starts like the term', () => {
    expect(fix('data is great', ['Dataverse'])).toBe('data is great')
  })

  it('never writes an acronym over a common word', () => {
    expect(fix('who is coming', ['WHO'])).toBe('who is coming')
    expect(fix('Who is coming?', ['WHO'])).toBe('Who is coming?')
    expect(fix('the net result', ['.NET'])).toBe('the net result')
    expect(fix('hearing aids', ['AIDS'])).toBe('hearing aids')
    // Spelled out, it is the acronym.
    expect(fix('the W H O said', ['WHO'])).toBe('the WHO said')
  })

  it('never lets a stray letter make a span of common words look like a name', () => {
    expect(fix('split the file into N blocks', ['Intune'])).toBe('split the file into N blocks')
  })

  it('never reads a longer word that holds the whole term as a near miss', () => {
    expect(fix('MurmurAI is live', ['Murmur'])).toBe('MurmurAI is live')
    expect(fix('the Murmure app', ['Murmur'])).toBe('the Murmure app')
  })

  it('leaves web addresses, email addresses and paths exactly as written', () => {
    expect(fix('see github.com/banuca/murmur', ['Bhanuka'])).toBe('see github.com/banuca/murmur')
    expect(fix('open C:\\Users\\KIRINDE\\Desktop', ['Kirinde'])).toBe(
      'open C:\\Users\\KIRINDE\\Desktop'
    )
    expect(fix('write to kirinde@example.com', ['Kirinde'])).toBe('write to kirinde@example.com')
    expect(fix('the .github/workflows folder', ['GitHub'])).toBe('the .github/workflows folder')
    expect(fix('?utm_source=github&utm_medium=repo', ['GitHub'])).toBe(
      '?utm_source=github&utm_medium=repo'
    )
    expect(fix('see #github or kirinde_bot', ['GitHub', 'Kirinde'])).toBe(
      'see #github or kirinde_bot'
    )
    // Outside an address the same words are corrected.
    expect(fix('ask banuca and kirinde', ['Bhanuka', 'Kirinde'])).toBe('ask Bhanuka and Kirinde')
  })

  it('leaves terms shorter than three letters alone', () => {
    expect(fix('it is good', ['IT'])).toBe('it is good')
  })

  it('changes nothing without terms', () => {
    expect(fix('Please send the ITUT draft to Kirinda.', [])).toBe(
      'Please send the ITUT draft to Kirinda.'
    )
  })

  it('without a word list, runs only the corrections that cannot change a real word', () => {
    // No list: every word counts as common, so the near miss and the lone
    // lower-case word wait for one; the split and the special form do not.
    const text = 'send the ITUT draft to Kirinda and kirinde, open data verse'
    expect(correctVocabulary(text, ['ITU-T', 'Kirinde', 'Dataverse'], 'en')).toBe(
      'send the ITU-T draft to Kirinda and kirinde, open Dataverse'
    )
  })
})

describe('near misses are English only', () => {
  const german = 'Bitte schick den Entwurf an Kirinda und öffne data verse.'

  it('leaves an English-looking near miss in German, but still applies an exact split', () => {
    expect(fix(german, ['Kirinde', 'Dataverse'], 'de')).toBe(
      'Bitte schick den Entwurf an Kirinda und öffne Dataverse.'
    )
  })

  it('would have corrected the same near miss under English', () => {
    expect(fix(german, ['Kirinde', 'Dataverse'], 'en')).toBe(
      'Bitte schick den Entwurf an Kirinde und öffne Dataverse.'
    )
  })

  it('under Automatic, follows whether the text reads as English', () => {
    expect(fix(german, ['Kirinde', 'Dataverse'], 'auto')).toBe(
      'Bitte schick den Entwurf an Kirinda und öffne Dataverse.'
    )
    expect(fix('Please send the draft to Kirinda.', ['Kirinde'], 'auto')).toBe(
      'Please send the draft to Kirinde.'
    )
  })
})

describe('spans', () => {
  it('never cross a full stop or a comma', () => {
    expect(fix('data. Verse', ['Dataverse'])).toBe('data. Verse')
    expect(fix('data, verse', ['Dataverse'])).toBe('data, verse')
    expect(fix('data\nverse', ['Dataverse'])).toBe('data\nverse')
  })

  it('never swallow a quote or a bracket', () => {
    expect(fix('the "data" verse', ['Dataverse'])).toBe('the "data" verse')
    expect(fix('data (verse)', ['Dataverse'])).toBe('data (verse)')
  })

  it('resolve overlapping candidates to the longest', () => {
    // "I T U" is ITU and "I T U T" is ITU-T: the longer one wins.
    expect(fix('the I T U T draft', ['ITU', 'ITU-T'])).toBe('the ITU-T draft')
  })

  it('join a name the recogniser split into pieces', () => {
    expect(fix('send it to Kiran da please', ['Kirinde'])).toBe('send it to Kirinde please')
  })

  it('never take a neighbouring word into a near miss', () => {
    // "Kirinda a" is as near to "Kirinde" as "Kirinda" is, but the "a" is a word.
    expect(fix('send Kirinda a copy', ['Kirinde'])).toBe('send Kirinde a copy')
  })

  it('keep the separators and every other word exactly as they were', () => {
    expect(fix('  Hello,   send the ITUT  draft!\n\nThanks  ', ['ITU-T'])).toBe(
      '  Hello,   send the ITU-T  draft!\n\nThanks  '
    )
  })
})

describe('capitals at the start of a sentence', () => {
  it('keeps the capital that opened a sentence for a lower-case term', () => {
    expect(fix('Matplotlip is slow. I use matplotlip daily.', ['matplotlib'])).toBe(
      'Matplotlib is slow. I use matplotlib daily.'
    )
  })

  it('never capitalises a term with a special form', () => {
    expect(fix('Iphone is slow.', ['iPhone'])).toBe('iPhone is slow.')
  })

  it('writes a term that starts with a capital as typed, wherever it is', () => {
    expect(fix('said kirinde. kirinde said', ['Kirinde'])).toBe('said Kirinde. Kirinde said')
  })
})

describe('the phonetic key', () => {
  it('reads the three spellings of the name alike', () => {
    expect(phoneticKey('kirinde')).toBe('krnt')
    expect(phoneticKey('kirinda')).toBe('krnt')
    expect(phoneticKey('kiranda')).toBe('krnt')
    expect(phoneticKey('kurindi')).toBe('krnt')
  })

  it('is crude on purpose: "coffee" and "koffi" share a key', () => {
    // Which is why a common word is never a near miss.
    expect(phoneticKey('coffee')).toBe(phoneticKey('koffi'))
  })

  it('maps the digraphs and letters it names', () => {
    expect(phoneticKey('phone')).toBe('fn')
    expect(phoneticKey('back')).toBe('pk')
    expect(phoneticKey('xavier')).toBe('ksfr')
    expect(phoneticKey('azure')).toBe('asr')
  })
})

describe('robustness', () => {
  it('returns the text unchanged when the word test throws', () => {
    const broken = (): boolean => {
      throw new Error('broken list')
    }
    const text = 'Please send the ITUT draft to Kirinda.'
    expect(correctVocabulary(text, ['ITU-T', 'Kirinde'], 'en', broken)).toBe(text)
  })

  it('returns anything that is not text unchanged, and skips a term that is not text', () => {
    const noText = undefined as unknown as string
    const noTerms = null as unknown as string[]
    const notATerm = 42 as unknown as string
    expect(correctVocabulary('', ['Kirinde'], 'en', isCommon)).toBe('')
    expect(correctVocabulary(noText, ['Kirinde'], 'en')).toBeUndefined()
    expect(correctVocabulary('kirinde', noTerms, 'en', isCommon)).toBe('kirinde')
    expect(correctVocabulary('kirinde', [notATerm, 'Kirinde'], 'en', isCommon)).toBe('Kirinde')
  })

  it('handles 100 terms against a 300-word transcript quickly', () => {
    const names = ['Kirinde', 'Dataverse', 'Parakeet', 'Murmur', 'Sherpa']
    const terms = Array.from({ length: 100 }, (_, index) => `${names[index % 5]}${index}`)
    const sentence =
      'please send the draft to Kirinda before friday and open data verse for the ' +
      'coffee machine is broken again so the ITUT group can'
    const words = sentence.split(' ')
    const transcript = Array.from({ length: 300 }, (_, index) => words[index % words.length]).join(
      ' '
    )
    expect(transcript.split(' ')).toHaveLength(300)

    const started = performance.now()
    const corrected = correctVocabulary(transcript, terms, 'en', isCommon)
    const elapsed = performance.now() - started

    expect(typeof corrected).toBe('string')
    // The target is 50 ms; the bound is loose so a busy machine does not fail it.
    expect(elapsed).toBeLessThan(250)
  })
})
