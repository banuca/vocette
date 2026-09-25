import { describe, expect, it } from 'vitest'
import {
  MAX_REPLACEMENTS_CHARS,
  MAX_REPLACEMENT_RULES,
  MAX_SPOKEN_CHARS,
  MAX_WRITTEN_CHARS,
  applyReplacements,
  clampReplacements,
  parseReplacements
} from '../src/shared/replacements'

/** Parses a list and applies it to a transcript, as a dictation does. */
function apply(list: string, text: string, now?: Date): string {
  return applyReplacements(text, parseReplacements(list).rules, now)
}

const DATE_FORMAT = { day: 'numeric', month: 'long', year: 'numeric' } as const
const TIME_FORMAT = { hour: '2-digit', minute: '2-digit' } as const

describe('parseReplacements', () => {
  it('returns nothing for an empty or blank list', () => {
    expect(parseReplacements('')).toEqual({ rules: [], ignored: 0 })
    expect(parseReplacements('   \n\n  \t \n')).toEqual({ rules: [], ignored: 0 })
  })

  it('splits a rule on its first =>, trimming both sides', () => {
    expect(parseReplacements('  itu   =>   ITU  \nshout=>a => b').rules).toEqual([
      { spoken: 'itu', written: 'ITU' },
      // Only the first arrow splits, so a written side may contain one.
      { spoken: 'shout', written: 'a => b' }
    ])
  })

  it('collapses the spacing inside a phrase', () => {
    expect(parseReplacements('my \t  email => name@example.com').rules).toEqual([
      { spoken: 'my email', written: 'name@example.com' }
    ])
  })

  it('skips blank lines and # comments without counting them', () => {
    const parsed = parseReplacements(
      '# House style\n\nitu => ITU\n   # an indented note => still a comment\n'
    )
    expect(parsed.rules).toEqual([{ spoken: 'itu', written: 'ITU' }])
    expect(parsed.ignored).toBe(0)
  })

  it('counts a line with no =>, or with nothing on one side, as ignored', () => {
    const parsed = parseReplacements('itu ITU\n=> ITU\nitu =>\n   =>   \nitu => ITU')
    expect(parsed.rules).toEqual([{ spoken: 'itu', written: 'ITU' }])
    expect(parsed.ignored).toBe(4)
  })

  it('keeps a spoken side of exactly the limit and ignores one past it', () => {
    const atLimit = 'a'.repeat(MAX_SPOKEN_CHARS)
    const tooLong = 'b'.repeat(MAX_SPOKEN_CHARS + 1)
    const parsed = parseReplacements(`${atLimit} => kept\n${tooLong} => dropped`)
    expect(parsed.rules).toEqual([{ spoken: atLimit, written: 'kept' }])
    expect(parsed.ignored).toBe(1)
  })

  it('keeps a written side of exactly the limit and ignores one past it', () => {
    const atLimit = 'a'.repeat(MAX_WRITTEN_CHARS)
    const tooLong = 'b'.repeat(MAX_WRITTEN_CHARS + 1)
    const parsed = parseReplacements(`kept => ${atLimit}\ndropped => ${tooLong}`)
    expect(parsed.rules).toEqual([{ spoken: 'kept', written: atLimit }])
    expect(parsed.ignored).toBe(1)
  })

  it('lets the last definition of a phrase win, ignoring capitals and spacing', () => {
    // So a user can override an earlier line without hunting it down.
    const parsed = parseReplacements(
      'itu => ITU\nmy email => old@example.com\nITU => I.T.U.\nMy  Email => new@example.com'
    )
    expect(parsed.rules).toEqual([
      { spoken: 'ITU', written: 'I.T.U.' },
      { spoken: 'My Email', written: 'new@example.com' }
    ])
    expect(parsed.ignored).toBe(0)
  })

  it('treats the two apostrophes as one phrase', () => {
    // The matcher accepts either, so these are one rule, and the last wins.
    expect(parseReplacements("today's date => A\ntoday’s date => B").rules).toEqual([
      { spoken: 'today’s date', written: 'B' }
    ])
  })

  it('caps the list, and a later line still overrides an early rule', () => {
    const lines = Array.from({ length: MAX_REPLACEMENT_RULES + 50 }, (_, i) => `word${i} => W${i}`)
    lines.push('word0 => overridden')
    const { rules } = parseReplacements(lines.join('\n'))
    expect(rules).toHaveLength(MAX_REPLACEMENT_RULES)
    expect(rules[0]).toEqual({ spoken: 'word0', written: 'overridden' })
    const last = MAX_REPLACEMENT_RULES - 1
    expect(rules.at(-1)).toEqual({ spoken: `word${last}`, written: `W${last}` })
  })

  it('turns \\n into a line break and \\\\n into a literal backslash-n', () => {
    const { rules } = parseReplacements(
      [
        String.raw`sign off => Best regards,\nAlex`,
        String.raw`print line => printf("%d\\n")`,
        String.raw`share => \\server\projects`
      ].join('\n')
    )
    expect(rules).toEqual([
      { spoken: 'sign off', written: 'Best regards,\nAlex' },
      { spoken: 'print line', written: String.raw`printf("%d\n")` },
      // No other backslash sequence is special: a network share is kept as typed.
      { spoken: 'share', written: String.raw`\\server\projects` }
    ])
  })

  it('splits on CRLF as well as LF', () => {
    expect(parseReplacements('itu => ITU\r\nmy email => name@example.com\r\n').rules).toEqual([
      { spoken: 'itu', written: 'ITU' },
      { spoken: 'my email', written: 'name@example.com' }
    ])
  })
})

describe('clampReplacements', () => {
  it('leaves a list within the ceiling alone', () => {
    const list = 'itu => ITU\nmy email => name@example.com'
    expect(clampReplacements(list)).toBe(list)
    const exact = 'x'.repeat(MAX_REPLACEMENTS_CHARS)
    expect(clampReplacements(exact)).toBe(exact)
  })

  it('cuts an over-long list on a line boundary, losing no more than one line', () => {
    const line = 'my email => name@example.com'
    const raw = `${line}\n`.repeat(Math.ceil(MAX_REPLACEMENTS_CHARS / line.length) + 10)
    const clamped = clampReplacements(raw)
    expect(clamped.length).toBeLessThanOrEqual(MAX_REPLACEMENTS_CHARS)
    expect(clamped.length).toBeGreaterThanOrEqual(MAX_REPLACEMENTS_CHARS - line.length - 1)
    // Half a rule would still parse, and paste half an address.
    for (const kept of clamped.split('\n')) expect(kept).toBe(line)
  })

  it('keeps nothing rather than half a rule when one line overruns the ceiling', () => {
    expect(clampReplacements(`long => ${'x'.repeat(MAX_REPLACEMENTS_CHARS)}`)).toBe('')
  })
})

describe('applyReplacements', () => {
  it('returns the input unchanged for an empty rule list', () => {
    expect(applyReplacements('itu rocks', [])).toBe('itu rocks')
    expect(apply('', 'itu rocks')).toBe('itu rocks')
    expect(apply('itu => ITU', '')).toBe('')
  })

  it('ignores a rule with an empty phrase rather than matching everywhere', () => {
    expect(applyReplacements('itu rocks', [{ spoken: '  ', written: 'X' }])).toBe('itu rocks')
  })

  it('ignores capitals when matching', () => {
    expect(apply('itu => ITU', 'Itu, ITU and itu')).toBe('ITU, ITU and ITU')
  })

  it('matches whole words only', () => {
    // "itu" must not fire inside "situation", nor against a digit.
    expect(apply('itu => ITU', 'The situation at itu is itu2, not intuitive.')).toBe(
      'The situation at ITU is itu2, not intuitive.'
    )
    // Nor at the end of a longer word.
    expect(apply('itu => ITU', 'Measured in situ.')).toBe('Measured in situ.')
    // An apostrophe is not a letter, so the word before it still stands alone.
    expect(apply('itu => ITU', "itu's standards")).toBe("ITU's standards")
  })

  it('prefers the longest phrase at any position', () => {
    // Listed shortest first, to prove the order comes from length.
    const list = 'new york => NY\nnew york city => NYC'
    expect(apply(list, 'From new york city to new york state.')).toBe('From NYC to NY state.')
  })

  it('falls back to a shorter phrase when the longer one is not a whole word', () => {
    const list = 'new york => NY\nnew york city => NYC'
    expect(apply(list, 'a new york cityscape')).toBe('a NY cityscape')
  })

  it('reads the spoken side as literal text, never as a pattern', () => {
    expect(apply('c++ => C++', 'I write c++ daily.')).toBe('I write C++ daily.')
    const log = 'console.log() => print()'
    expect(apply(log, 'Call console.log() here.')).toBe('Call print() here.')
    // A dot is a dot: it does not stand for any character.
    expect(apply(log, 'consoleXlog() stays')).toBe('consoleXlog() stays')
  })

  it('survives a spoken side made of every pattern character', () => {
    const symbols = '.*+?^$' + '{}()|[]\\'
    expect(apply(`${symbols} => SYMBOLS`, `before ${symbols} after`)).toBe('before SYMBOLS after')
  })

  it('tolerates a run of spaces or tabs, and a comma the recogniser put between words', () => {
    const list = 'my email => name@example.com'
    expect(apply(list, 'Send it to my, email please.')).toBe('Send it to name@example.com please.')
    expect(apply(list, 'my   email')).toBe('name@example.com')
    expect(apply(list, 'my\temail')).toBe('name@example.com')
  })

  it('never matches across a line break', () => {
    // The break was asked for out loud ("my, new line, email"), so a rule
    // must not swallow it.
    const list = 'my email => name@example.com'
    expect(apply(list, 'my\nemail')).toBe('my\nemail')
    expect(apply(list, 'my,\nEmail')).toBe('my,\nEmail')
    expect(apply(list, 'my\n\nemail')).toBe('my\n\nemail')
  })

  it('never scans replaced text again', () => {
    // No chains and no loops: "a => b" and "b => c" turn "a" into "b", not "c".
    const list = 'a => b\nb => c'
    expect(apply(list, 'a')).toBe('b')
    expect(apply(list, 'a b')).toBe('b c')
    // A rule whose output contains its own trigger does not run away.
    expect(apply('go => go go', 'go')).toBe('go go')
  })

  it('uses Unicode word boundaries', () => {
    const list = 'café => Café Nero\ncaf => CAF'
    expect(apply(list, 'Meet me at the café.')).toBe('Meet me at the Café Nero.')
    // "é" is a letter, so neither rule fires inside a longer word.
    expect(apply(list, 'Two cafés.')).toBe('Two cafés.')
    expect(apply('lan => LAN', 'With élan.')).toBe('With élan.')
    // A decomposed accent is a mark of its own, and still part of the word.
    expect(apply('cafe => CAFE', 'cafe\u0301')).toBe('cafe\u0301')
  })

  it('expands {date} and {time} when the text is inserted', () => {
    const now = new Date(2026, 8, 25, 14, 5)
    const date = now.toLocaleDateString(undefined, DATE_FORMAT)
    const time = now.toLocaleTimeString(undefined, TIME_FORMAT)
    const list = "today's date => {date}\nthe time => {time}\nstamp => {date} at {time}"
    expect(apply(list, "Today's date", now)).toBe(date)
    expect(apply(list, 'the time', now)).toBe(time)
    expect(apply(list, 'stamp', now)).toBe(`${date} at ${time}`)
    // Read when applied, not when the rule was saved.
    const later = new Date(2027, 0, 2, 9, 30)
    expect(apply(list, "today's date", later)).toBe(later.toLocaleDateString(undefined, DATE_FORMAT))
    expect(apply(list, "today's date", later)).not.toBe(date)
  })

  it('leaves an unknown variable exactly as typed', () => {
    expect(apply('weather => {weather}, {DATE} and {date', 'weather')).toBe(
      '{weather}, {DATE} and {date'
    )
  })

  it('inserts the written side exactly as typed, even at the start of a sentence', () => {
    // Code must keep its case, so no capital is added.
    expect(apply('console log => console.log()', 'Console log the value.')).toBe(
      'console.log() the value.'
    )
  })

  it('inserts a snippet across lines', () => {
    expect(apply(String.raw`sign off => Best regards,\nAlex`, 'Thanks. Sign off')).toBe(
      'Thanks. Best regards,\nAlex'
    )
  })

  it('lets a snippet across lines take one full stop or comma after it', () => {
    // A signature must not end on the full stop the recogniser put after
    // its trigger — but mid-sentence the stop stays, so what follows reads.
    const list = String.raw`sign off => Best regards,\nAlex`
    expect(apply(list, 'Thanks. Sign off.')).toBe('Thanks. Best regards,\nAlex')
    expect(apply(list, 'Sign off, see you soon.')).toBe('Best regards,\nAlex, see you soon.')
    expect(apply(list, 'Sign off.\nP.S. Call me.')).toBe('Best regards,\nAlex\nP.S. Call me.')
  })

  it('leaves an ellipsis after a snippet whole', () => {
    // Only a stop that ends the clause is taken; three dots are not one.
    const list = String.raw`sign off => Best regards,\nAlex`
    expect(apply(list, 'Sign off...')).toBe('Best regards,\nAlex...')
  })

  it('keeps what follows a single-line replacement', () => {
    expect(apply('my email => name@example.com', 'Send it to my email.')).toBe(
      'Send it to name@example.com.'
    )
    expect(apply('itu => ITU', 'Itu, again.')).toBe('ITU, again.')
    // An escaped \\n is two characters, not a line break, so it keeps its stop too.
    expect(apply(String.raw`print line => printf("%d\\n")`, 'print line.')).toBe(
      String.raw`printf("%d\n").`
    )
  })

  it('keeps a $ in the written side literal', () => {
    expect(apply('price => $& costs $1', 'the price')).toBe('the $& costs $1')
  })

  it('accepts either apostrophe, whichever way round', () => {
    const now = new Date(2026, 8, 25)
    const date = now.toLocaleDateString(undefined, DATE_FORMAT)
    expect(apply("today's date => {date}", 'today’s date', now)).toBe(date)
    expect(apply('today’s date => {date}', "today's date", now)).toBe(date)
  })

  it('does not reorder the list it was given', () => {
    const { rules } = parseReplacements('a => b\nlonger phrase => c')
    const before = [...rules]
    applyReplacements('a longer phrase', rules)
    expect(rules).toEqual(before)
  })
})
