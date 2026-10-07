import { describe, expect, it } from 'vitest'
import { cleanupTranscript, type CleanupOptions } from '../src/shared/cleanup'
import {
  applyDiscardMarkers,
  applyInlineCorrections,
  applySentenceStartCorrections,
  applySpokenCorrections
} from '../src/shared/spoken-corrections'

const ALL_ON: CleanupOptions = {
  language: 'en',
  removeFillers: true,
  spokenCorrections: true,
  spokenFormatting: true
}

const clean = (input: string): string => cleanupTranscript(input, ALL_ON)

describe('corrections inside a sentence', () => {
  it.each([
    [
      "Let's move the meeting to Tuesday, no sorry, Wednesday.",
      "Let's move the meeting to Wednesday."
    ],
    ['Send it to John, I mean Sarah.', 'Send it to Sarah.'],
    ["Let's meet at 3 PM, no, 4 PM.", "Let's meet at 4 PM."],
    ['We need five, no, six chairs.', 'We need six chairs.'],
    ["I'll bring the red one, sorry, the blue one.", "I'll bring the blue one."],
    // The restart on the same word ("I … I") wins over the nearer "it".
    ['I like it, no, I love it.', 'I love it.'],
    ['It costs 10 dollars, actually, 20 dollars.', 'It costs 20 dollars.']
  ])('%s', (input, expected) => {
    expect(applyInlineCorrections(input)).toBe(expected)
    expect(applySpokenCorrections(input)).toBe(expected)
    // And nothing later in the cleanup undoes it.
    expect(clean(input)).toBe(expected)
  })

  it('takes the multi-word markers without commas', () => {
    expect(applyInlineCorrections('Put it on Monday no wait Tuesday.')).toBe('Put it on Tuesday.')
    expect(applyInlineCorrections('Send five, or rather six.')).toBe('Send six.')
  })

  it('resolves a run of markers to the last one', () => {
    expect(applyInlineCorrections('We meet Tuesday, sorry, I mean Wednesday.')).toBe(
      'We meet Wednesday.'
    )
    expect(applyInlineCorrections("Let's move it to Tuesday, no, sorry, Wednesday.")).toBe(
      "Let's move it to Wednesday."
    )
    expect(applyInlineCorrections("Let's meet Tuesday, no, Wednesday, no, Thursday.")).toBe(
      "Let's meet Thursday."
    )
  })

  it('recognises months', () => {
    expect(applyInlineCorrections("I'll see you in May, no, June.")).toBe(
      "I'll see you in June."
    )
  })

  it('keeps an opening quote outside the repair and a currency sign inside it', () => {
    expect(applyInlineCorrections('He said "John, I mean Sarah."')).toBe('He said "Sarah."')
    expect(applyInlineCorrections('It costs $10, actually, $20.')).toBe('It costs $20.')
  })

  it('never lets a lone pronoun or determiner replace anything', () => {
    // "I mean it" is emphasis: "it" cannot stand in for "you so much".
    expect(applyInlineCorrections('Thank you so much, I mean it.')).toBe(
      'Thank you so much, I mean it.'
    )
    expect(applyInlineCorrections("I'll take this, no, that.")).toBe("I'll take this, no, that.")
  })

  it('anchors a pronoun only on the same pronoun', () => {
    // No "it" was said before, so there is nothing to repair.
    expect(applyInlineCorrections('Thank you, I mean it sincerely.')).toBe(
      'Thank you, I mean it sincerely.'
    )
    // The cost of the rule: a pronoun switch that does not line up is left as said.
    expect(applyInlineCorrections('He said so, sorry, she did.')).toBe(
      'He said so, sorry, she did.'
    )
  })

  it('still lets a determiner stand in for a different one', () => {
    expect(applyInlineCorrections('Take my car, no, your car.')).toBe('Take your car.')
  })

  it('looks back no further than four words', () => {
    expect(applyInlineCorrections('Tuesday is the day we meet, no, Wednesday.')).toBe(
      'Tuesday is the day we meet, no, Wednesday.'
    )
  })

  it('leaves a replacement longer than four words alone', () => {
    expect(applyInlineCorrections('Send it to John, I mean Sarah and the whole team.')).toBe(
      'Send it to John, I mean Sarah and the whole team.'
    )
  })
})

describe('replacements that end on the same word', () => {
  it.each([
    // The kind rule alone would anchor on the nearer "ten" and keep "five past".
    ['It is five past ten, no, ten past ten.', 'It is ten past ten.'],
    ['We need two engineers, no, three engineers.', 'We need three engineers.'],
    ['Send it to the marketing team, sorry, the sales team.', 'Send it to the sales team.'],
    // Two words with no kind line up too.
    ['The meeting is at half past two, no, quarter past two.', 'The meeting is at quarter past two.'],
    // A pronoun switch that lines up word for word is a repair.
    ['He called, sorry, she called.', 'she called.']
  ])('%s', (input, expected) => {
    expect(applyInlineCorrections(input)).toBe(expected)
  })

  it('gives the same results as the kind rule where both apply', () => {
    expect(applyInlineCorrections("I'll bring the red one, sorry, the blue one.")).toBe(
      "I'll bring the blue one."
    )
    expect(applyInlineCorrections("Let's meet at 3 PM, no, 4 PM.")).toBe("Let's meet at 4 PM.")
    expect(applyInlineCorrections('It costs 10 dollars, actually, 20 dollars.')).toBe(
      'It costs 20 dollars.'
    )
    expect(applyInlineCorrections('I like it, no, I love it.')).toBe('I love it.')
  })

  it('works across a full stop too', () => {
    expect(applySentenceStartCorrections('It is five past ten. No, ten past ten.')).toBe(
      'It is ten past ten.'
    )
  })

  it('never lets emphasis replace a different word', () => {
    // Each would lose a word if the replacement were lined up from the end.
    expect(applyInlineCorrections('It was good, actually, really good.')).toBe(
      'It was good, actually, really good.'
    )
    expect(applyInlineCorrections('We need it now, no, right now.')).toBe(
      'We need it now, no, right now.'
    )
    // The kind rule still repairs this one from the repeated "a".
    expect(applyInlineCorrections("That's a big problem, I mean a really big problem.")).toBe(
      "That's a really big problem."
    )
  })

  it('may replace the whole sentence so far, but no more', () => {
    expect(applyInlineCorrections('Book it, no, book it.')).toBe('book it.')
    // Two words cannot line up against one.
    expect(applyInlineCorrections('Soon, I mean later soon.')).toBe('Soon, I mean later soon.')
  })
})

describe('corrections across a full stop', () => {
  it.each([
    [
      'We should move the meeting to Tuesday. No sorry, Wednesday.',
      'We should move the meeting to Wednesday.'
    ],
    ["I think it's Tuesday. No, Wednesday.", "I think it's Wednesday."],
    ['We meet Tuesday. I mean Wednesday.', 'We meet Wednesday.'],
    ['We meet Tuesday. Sorry, I mean Wednesday.', 'We meet Wednesday.'],
    ['Invite John. Or rather, Sarah.', 'Invite Sarah.'],
    ['We meet at 3 PM. No wait 4 PM.', 'We meet at 4 PM.'],
    // The same words with the recogniser's comma after "No".
    ["Let's meet on Tuesday. No, sorry, Wednesday.", "Let's meet on Wednesday."],
    ["Let's meet on Tuesday. No, wait, Wednesday.", "Let's meet on Wednesday."]
  ])('%s', (input, expected) => {
    expect(applySentenceStartCorrections(input)).toBe(expected)
    expect(clean(input)).toBe(expected)
  })

  it.each([
    // An answer to a question, not a correction.
    'Is it ready? No, not yet.',
    // A bare "Actually," / "Sorry," / "Wait," starts a new thought.
    'We shipped the build on Monday. Actually, the team was happy.',
    'We met on Monday. Sorry, Tuesday.',
    'It was Monday. Wait, Tuesday.',
    // Only a full stop reaches back: never "!" and never an ellipsis.
    'Great, Tuesday! No, Wednesday.',
    'Tuesday... No, Wednesday.',
    // At most three words of replacement.
    'We meet Tuesday. No, we meet on Wednesday instead.',
    // Emphasis, not a repair.
    'Great work. I mean it.'
  ])('leaves "%s" unchanged', (input) => {
    expect(applySpokenCorrections(input)).toBe(input)
  })
})

describe('required negatives', () => {
  it.each([
    'No, I mean it.',
    "Sorry, I'm late.",
    'I actually like it.',
    'It was, actually, quite good.',
    'Is it ready? No, not yet.',
    'Call me tomorrow, no, the day after.',
    'There is no way.',
    'I mean well.'
  ])('leaves "%s" unchanged', (input) => {
    expect(applySpokenCorrections(input)).toBe(input)
    // The whole cleanup leaves them alone too.
    expect(clean(input)).toBe(input)
  })
})

describe('discard markers', () => {
  it('drops the sentence before the marker when it is the first sentence', () => {
    expect(applyDiscardMarkers('Send the report today. Scratch that. Send it tomorrow.')).toBe(
      'Send it tomorrow.'
    )
  })

  it('drops only the sentence before the marker when it is a middle sentence', () => {
    expect(
      applyDiscardMarkers("I'm back. Send the report today. Scratch that. Send it tomorrow.")
    ).toBe("I'm back. Send it tomorrow.")
  })

  it('removes a marker that nothing precedes', () => {
    expect(applyDiscardMarkers('Scratch that.')).toBe('')
    expect(applyDiscardMarkers('Scratch that. Hello.')).toBe('Hello.')
  })

  it('drops the sentence so far when the marker is spoken mid-sentence', () => {
    expect(applyDiscardMarkers('Send the report today, scratch that, send it tomorrow.')).toBe(
      'send it tomorrow.'
    )
    expect(clean('Send the report today, scratch that, send it tomorrow.')).toBe(
      'Send it tomorrow.'
    )
  })

  it('accepts "strike that" in any case', () => {
    expect(applyDiscardMarkers('The total is 40. STRIKE THAT! The total is 45.')).toBe(
      'The total is 45.'
    )
  })

  it('treats a line break as a sentence boundary and keeps the lines around it', () => {
    expect(applyDiscardMarkers('Line one.\nHello. Scratch that.\nBye.')).toBe('Line one.\nBye.')
  })

  it('handles one marker after another', () => {
    expect(applyDiscardMarkers('One. Two. Scratch that. Scratch that. Three.')).toBe('Three.')
  })

  it('leaves the phrase alone when it does not end a clause', () => {
    expect(applyDiscardMarkers('Strike that match.')).toBe('Strike that match.')
    expect(applyDiscardMarkers('Scratch that itch.')).toBe('Scratch that itch.')
  })

  it('leaves the phrase alone in a question', () => {
    expect(applyDiscardMarkers('Can you strike that?')).toBe('Can you strike that?')
    expect(clean('Can you strike that?')).toBe('Can you strike that?')
  })

  it('keeps a line break the speaker asked for after the marker', () => {
    // Spoken: "Hello. Scratch that. New line. Bye." — formatting runs first.
    expect(clean('Hello. Scratch that. New line. Bye.')).toBe('\nBye.')
  })

  it('never treats "delete that" as a marker, because it is a real instruction', () => {
    expect(applyDiscardMarkers('Please delete that file.')).toBe('Please delete that file.')
    expect(applyDiscardMarkers('The draft is wrong. Delete that.')).toBe(
      'The draft is wrong. Delete that.'
    )
  })
})
