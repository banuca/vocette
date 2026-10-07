import { describe, expect, it } from 'vitest'
import {
  applySpokenFormatting,
  cleanupTranscript,
  englishRulesFor,
  looksEnglish,
  normaliseWhitespace,
  removeFillerWords,
  repairPunctuation,
  type CleanupOptions
} from '../src/shared/cleanup'

const ALL_ON: CleanupOptions = {
  language: 'en',
  removeFillers: true,
  spokenCorrections: true,
  spokenFormatting: true
}

const ALL_OFF: CleanupOptions = {
  language: 'en',
  removeFillers: false,
  spokenCorrections: false,
  spokenFormatting: false
}

function clean(input: string, options: Partial<CleanupOptions> = {}): string {
  return cleanupTranscript(input, { ...ALL_ON, ...options })
}

/** A pass may leave doubled spaces for the repairs to tidy; this reads past them. */
function squash(text: string): string {
  return text.replace(/[ \t]+/gu, ' ').trim()
}

describe('cleanupTranscript', () => {
  it('removes filler words', () => {
    expect(clean('um so I think uh we should ship it')).toBe('So I think we should ship it')
  })

  it('handles stretched fillers', () => {
    expect(clean('ummm hmmm this is fine')).toBe('This is fine')
  })

  it('does not eat real words that start with a filler', () => {
    expect(clean('The umbrella is uh blue')).toBe('The umbrella is blue')
    expect(clean('Humming along')).toBe('Humming along')
  })

  it('repairs spacing before punctuation without inserting any after it', () => {
    // Changed by design: no space is inserted after the full stop any more.
    // Recognisers space their own output, and inserting one is what turned
    // "example.com" into "example. com".
    expect(clean('Hello , world .Next sentence')).toBe('Hello, world.Next sentence')
  })

  it('collapses repeated punctuation', () => {
    // The collapsed full stop then counts as a sentence end, so "what" is
    // capitalised — the same rule the next test covers.
    expect(clean('Wait.. what,, really')).toBe('Wait. What, really')
  })

  it('capitalises the first letter and after sentence ends', () => {
    expect(clean('hello there. how are you? fine')).toBe('Hello there. How are you? Fine')
  })

  it('leaves leading punctuation in place while still capitalising', () => {
    expect(clean('"hello there"')).toBe('"Hello there"')
  })

  it('returns an empty string for filler-only input', () => {
    expect(clean('um uh erm')).toBe('')
    expect(clean('   ')).toBe('')
  })

  it('returns an empty string when only fillers and a discard were said', () => {
    // The controller turns this into "Only filler words or silence were detected."
    expect(clean('Um, uh... hmm.')).toBe('')
    expect(clean('Scratch that.')).toBe('')
  })

  it('keeps a line break the speaker asked for at the very start or end', () => {
    expect(clean('Hello team. New line.')).toBe('Hello team.\n')
    expect(clean('New paragraph. Hello.')).toBe('\n\nHello.')
    // A take that was nothing but the command is still something to paste.
    expect(clean('New line.')).toBe('\n')
    expect(clean('Um. New paragraph.')).toBe('\n\n')
    // Spaces and tabs at the ends still go.
    expect(clean('  Hello team.  ')).toBe('Hello team.')
  })

  it('preserves non-Latin scripts', () => {
    expect(clean('  こんにちは  ')).toBe('こんにちは')
  })

  it('collapses runs of whitespace', () => {
    expect(clean('too     many     spaces')).toBe('Too many spaces')
  })

  it('cleans the sentence the on-device recogniser actually produced', () => {
    // Spoken: "…to Tuesday, no sorry, Wednesday." The recogniser put a full
    // stop before the correction, and Automatic was the language in use.
    expect(
      clean('Um, so I think we should uh move the meeting to Tuesday. No sorry, Wednesday.', {
        language: 'auto'
      })
    ).toBe('So I think we should move the meeting to Wednesday.')
  })

  it('follows a correction with a hesitation beside its marker', () => {
    // Hand test 0.5.0, step 8: each of these was pasted as "Move to Tuesday.
    // No sorry, Wednesday." because the hesitation hid the marker.
    for (const spoken of [
      'Um, move to Tuesday. Uh, no sorry, Wednesday.',
      'Um, move to Tuesday. Uh no sorry, Wednesday.',
      'Um, move to Tuesday. Um. No sorry, Wednesday.',
      'Um, move to Tuesday. No sorry, um Wednesday.',
      'Um, move to Tuesday. No sorry, uh, Wednesday.'
    ]) {
      expect(clean(spoken), spoken).toBe('Move to Wednesday.')
    }
    expect(clean('Send it to John, uh, I mean Sarah.')).toBe('Send it to Sarah.')
  })

  it('leaves hesitations to the corrections when fillers are switched off', () => {
    expect(clean('Move to Tuesday. Uh, no sorry, Wednesday.', { removeFillers: false })).toBe(
      'Move to Tuesday. Uh, no sorry, Wednesday.'
    )
  })
})

describe('technical text', () => {
  it('keeps web addresses, decimals, times and abbreviations intact', () => {
    expect(clean('Visit example.com today.')).toBe('Visit example.com today.')
    expect(clean('Version 3.5 is out.')).toBe('Version 3.5 is out.')
    expect(clean('Meet at 10:30 tomorrow.')).toBe('Meet at 10:30 tomorrow.')
    // Nor is the word after an abbreviation given a capital it never had.
    expect(clean('Bring a snack, e.g. fruit.')).toBe('Bring a snack, e.g. fruit.')
  })

  it('keeps an ellipsis', () => {
    expect(clean('Wait...')).toBe('Wait...')
    expect(clean('I was thinking...')).toBe('I was thinking...')
  })

  it('keeps a measurement in millimetres', () => {
    expect(clean('The screw is 5 mm long.')).toBe('The screw is 5 mm long.')
  })
})

describe('languages', () => {
  it('removes a German hesitation but keeps "er", which is German for "he"', () => {
    expect(clean('Er hat, äh, recht.', { language: 'de' })).toBe('Er hat recht.')
  })

  it('keeps "um" in German and Portuguese, where it is a word', () => {
    expect(clean('Wir treffen uns um 10 Uhr.', { language: 'de' })).toBe(
      'Wir treffen uns um 10 Uhr.'
    )
    expect(clean('Eu tenho um carro.', { language: 'pt' })).toBe('Eu tenho um carro.')
  })

  it('still removes a stretched hesitation in any language', () => {
    expect(clean('Ummm, wir gehen jetzt.', { language: 'de' })).toBe('Wir gehen jetzt.')
  })

  it('gives Automatic the English rules when the text reads as English', () => {
    expect(clean('So er I I think, like, it works.', { language: 'auto' })).toBe(
      'So I think it works.'
    )
    expect(
      clean('Send it to John, I mean Sarah. New line. Thanks.', { language: 'auto' })
    ).toBe('Send it to Sarah.\nThanks.')
  })

  it('keeps a German "um" under Automatic when the text does not read as English', () => {
    expect(clean('Das Treffen ist um 10 Uhr.', { language: 'auto' })).toBe(
      'Das Treffen ist um 10 Uhr.'
    )
  })

  it('keeps a German "um" under Automatic when there is no English evidence', () => {
    const auto = { language: 'auto' }
    // "die" is German evidence as well as half an English word, so it cancels.
    expect(clean('Die Sitzung beginnt um 10 Uhr.', auto)).toBe('Die Sitzung beginnt um 10 Uhr.')
    // No evidence either way: a plain "um" stays unless a comma marks it as a pause.
    expect(clean('Treffen um 10 Uhr.', auto)).toBe('Treffen um 10 Uhr.')
    expect(clean('Um zehn.', auto)).toBe('Um zehn.')
    expect(clean('Um, okay.', auto)).toBe('Okay.')
  })

  it('does not give short German or Portuguese the English rules under Automatic', () => {
    // "will", "so" and "a" are only half-evidence, and "er", "sein" and
    // "mais" outweigh them.
    expect(clean('Er will so sein.', { language: 'auto' })).toBe('Er will so sein.')
    expect(clean('Um carro a mais.', { language: 'auto' })).toBe('Um carro a mais.')
  })

  it('gives realistic English under Automatic the English rules', () => {
    const auto = { language: 'auto' }
    expect(clean('The price is 100, no, 200 dollars per month.', auto)).toBe(
      'The price is 200 dollars per month.'
    )
    expect(clean('The results were, um, pretty good actually.', auto)).toBe(
      'The results were pretty good actually.'
    )
    expect(clean('It is five past ten, no, ten past ten.', auto)).toBe('It is ten past ten.')
    expect(clean('We need to hire, uh, two, no, three engineers.', auto)).toBe(
      'We need to hire three engineers.'
    )
  })

  it('always gives explicit English the English rules', () => {
    expect(clean('Er, ja.', { language: 'en' })).toBe('Ja.')
  })

  it('gives French only the universal hesitations and the repairs', () => {
    expect(
      clean("euh je pense, like, que c'est bien. Scratch that. New line ok", { language: 'fr' })
    ).toBe("Je pense, like, que c'est bien. Scratch that. New line ok")
  })
})

describe('the three switches', () => {
  it('returns the trimmed input untouched when every switch is off', () => {
    expect(cleanupTranscript('  um hello , world .  ', ALL_OFF)).toBe('um hello , world .')
  })

  it('still repairs punctuation when only one switch is on', () => {
    expect(cleanupTranscript('um hello , world', { ...ALL_OFF, spokenFormatting: true })).toBe(
      'Um hello, world'
    )
  })

  it('leaves spoken corrections in place when that switch is off', () => {
    expect(clean('Send it to John, I mean Sarah.', { spokenCorrections: false })).toBe(
      'Send it to John, I mean Sarah.'
    )
    expect(clean('Send it today. Scratch that. Send it tomorrow.', { spokenCorrections: false }))
      .toBe('Send it today. Scratch that. Send it tomorrow.')
  })

  it('leaves spoken line breaks in place when that switch is off', () => {
    expect(clean('Hello team. New paragraph. The plan', { spokenFormatting: false })).toBe(
      'Hello team. New paragraph. The plan'
    )
  })
})

describe('normaliseWhitespace', () => {
  it('trims and collapses spaces and tabs, but keeps line breaks', () => {
    expect(normaliseWhitespace('  a \t b  \n  c ')).toBe('a b\nc')
  })

  it('turns Windows line endings into plain ones', () => {
    expect(normaliseWhitespace('one\r\ntwo')).toBe('one\ntwo')
  })
})

describe('applySpokenFormatting', () => {
  it('turns "new paragraph" into a blank line and swallows its punctuation', () => {
    expect(applySpokenFormatting('Hello team. New paragraph. The plan')).toBe(
      'Hello team.\n\nThe plan'
    )
  })

  it('turns "new line" into a line break and capitalises what follows', () => {
    expect(applySpokenFormatting('Dear John, new line, thanks for the update.')).toBe(
      'Dear John,\nThanks for the update.'
    )
  })

  it('matches the phrase in any case', () => {
    expect(applySpokenFormatting('Hello. NEW LINE. Bye')).toBe('Hello.\nBye')
  })

  it('handles one command straight after another', () => {
    expect(applySpokenFormatting('Hello. New line. New line. More')).toBe('Hello.\n\nMore')
  })

  it('never leaves a line starting or ending with a space', () => {
    const lines = applySpokenFormatting('One , new line , two. New paragraph. Three').split('\n')
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(line).toBe(line.trim())
  })

  it('leaves the words alone when they are not a phrase of their own', () => {
    expect(applySpokenFormatting('We need a new line of products.')).toBe(
      'We need a new line of products.'
    )
    expect(applySpokenFormatting('Start a new paragraph here.')).toBe(
      'Start a new paragraph here.'
    )
    expect(applySpokenFormatting('first point new line second point')).toBe(
      'first point new line second point'
    )
  })

  it('matches whole words only', () => {
    expect(applySpokenFormatting('Hello. Newline. Bye')).toBe('Hello. Newline. Bye')
    expect(applySpokenFormatting('New lines. Old lines.')).toBe('New lines. Old lines.')
  })
})

describe('removeFillerWords', () => {
  it('removes the universal hesitation sounds in any language', () => {
    expect(squash(removeFillerWords('umm uhh erm hmm mmm äh ähm öhm euh ehm ok', 'none'))).toBe(
      'ok'
    )
  })

  it('leaves plain "um" and "er" to the English rules', () => {
    expect(removeFillerWords('Er kommt um 10 Uhr', 'none')).toBe('Er kommt um 10 Uhr')
    expect(squash(removeFillerWords('um so er yes', 'full'))).toBe('so yes')
  })

  it('under a tentative reading, removes a plain "um" only before a comma', () => {
    expect(removeFillerWords('Um zehn.', 'tentative')).toBe('Um zehn.')
    expect(removeFillerWords('Um, okay.', 'tentative')).toBe('okay.')
    // The other English rules still run.
    expect(squash(removeFillerWords('I I, like, err, agree', 'tentative'))).toBe('I agree')
  })

  it('never treats a word written in capitals as a filler', () => {
    expect(clean('She went to the ER.')).toBe('She went to the ER.')
    expect(clean('UM, I think so.')).toBe('UM, I think so.')
  })

  it('removes "ah" only before a comma or between words', () => {
    expect(clean('Ah, I see.')).toBe('I see.')
    expect(clean('I was ah going.')).toBe('I was going.')
    expect(clean('I was, ah, going.')).toBe('I was going.')
    expect(clean('Ah! That is it.')).toBe('Ah! That is it.')
  })

  it('takes both commas with a comma-enclosed hesitation', () => {
    expect(clean('I think, um, we should.')).toBe('I think we should.')
  })

  it('takes both commas with a comma-enclosed "like"', () => {
    expect(clean('It was, like, really good.')).toBe('It was really good.')
  })

  it('takes both commas with a comma-enclosed "you know", "I mean" or "you see"', () => {
    expect(clean('I went to the store, you know, the one on Main Street.')).toBe(
      'I went to the store the one on Main Street.'
    )
    expect(clean('It was, I mean, fine.')).toBe('It was fine.')
    expect(clean('It works, you see, mostly.')).toBe('It works mostly.')
    expect(clean('So, like, I was thinking we could, you know, try it.')).toBe(
      'So I was thinking we could try it.'
    )
  })

  it('removes "Like, ", "You know, " and "I mean, " opening a sentence', () => {
    expect(clean('Like, it was fine.')).toBe('It was fine.')
    expect(clean('Hello. You know, it works.')).toBe('Hello. It works.')
    expect(clean('I mean, sure.')).toBe('Sure.')
    expect(clean('Like, you know, it was fine.')).toBe('It was fine.')
    // Only those three open a sentence as filler; the words themselves stay.
    expect(clean('You see, it works.')).toBe('You see, it works.')
    expect(clean('I like it, you know.')).toBe('I like it, you know.')
  })

  it('collapses a stutter on a function word', () => {
    expect(clean('I I think')).toBe('I think')
    expect(clean('the the plan')).toBe('The plan')
    expect(clean('I, I think so.')).toBe('I think so.')
    expect(clean('I um I think so.')).toBe('I think so.')
  })

  it('never collapses repeats that are usually meant', () => {
    expect(clean('that that had had very very no no bye bye')).toBe(
      'That that had had very very no no bye bye'
    )
  })

  it('keeps "uh-huh" and "mm-hmm", which are words', () => {
    expect(clean('Uh-huh, that works. Mm-hmm.')).toBe('Uh-huh, that works. Mm-hmm.')
  })

  it('does not strand the punctuation a removed hesitation leaves behind', () => {
    expect(clean('Um. Hello.')).toBe('Hello.')
    expect(clean('Hmm... okay.')).toBe('Okay.')
    expect(clean('Let me think, hmm.')).toBe('Let me think.')
  })

  it('leaves the English-only fillers alone in another language', () => {
    expect(removeFillerWords('Er, like, I I think', 'none')).toBe('Er, like, I I think')
  })
})

describe('repairPunctuation', () => {
  it('removes spaces before punctuation', () => {
    expect(repairPunctuation('Hello , world ! Is it ? Yes ; no : maybe .')).toBe(
      'Hello, world! Is it? Yes; no: maybe.'
    )
  })

  it('collapses doubled marks but keeps an ellipsis', () => {
    expect(repairPunctuation('what?? no!! ok,, fine')).toBe('What? No! Ok, fine')
    expect(repairPunctuation('Well...')).toBe('Well...')
  })

  it('tidies a comma stranded before the end of a sentence', () => {
    expect(repairPunctuation('Let me think , .')).toBe('Let me think.')
  })

  it('never inserts a space after punctuation', () => {
    expect(repairPunctuation('see example.com, 3.5 and 10:30')).toBe(
      'See example.com, 3.5 and 10:30'
    )
  })

  it('capitalises after a line break', () => {
    expect(repairPunctuation('one.\ntwo\nthree')).toBe('One.\nTwo\nThree')
  })

  it('does not capitalise after an abbreviation that ends in a full stop', () => {
    expect(repairPunctuation('bring fruit, e.g. apples')).toBe('Bring fruit, e.g. apples')
    expect(repairPunctuation('we start at 9 a.m. tomorrow')).toBe('We start at 9 a.m. tomorrow')
  })

  it('leaves a leading number alone', () => {
    expect(repairPunctuation('3 apples were left')).toBe('3 apples were left')
  })

  it('leaves caseless scripts alone', () => {
    expect(repairPunctuation('مرحبا. نعم')).toBe('مرحبا. نعم')
    expect(repairPunctuation('こんにちは。 はい')).toBe('こんにちは。 はい')
  })

  it('returns an empty string when only punctuation is left', () => {
    expect(repairPunctuation(' , . ')).toBe('')
  })
})

describe('looksEnglish', () => {
  it('reads English from its common function words', () => {
    expect(looksEnglish('So I think we should ship it')).toBe(true)
    expect(looksEnglish('Hello there')).toBe(true)
    expect(looksEnglish('I agree')).toBe(true)
    expect(looksEnglish("It’s fine, don’t worry")).toBe(true)
  })

  it('reads realistic English as English, shared words and all', () => {
    expect(looksEnglish('The price is 100, no, 200 dollars per month.')).toBe(true)
    expect(looksEnglish('The results were, um, pretty good actually.')).toBe(true)
    expect(looksEnglish('It is five past ten, no, ten past ten.')).toBe(true)
    expect(looksEnglish('We need to hire, uh, two, no, three engineers.')).toBe(true)
  })

  it('treats a text with no evidence either way as English', () => {
    expect(looksEnglish('Hello.')).toBe(true)
  })

  it('does not read German, French, Dutch or Portuguese as English', () => {
    expect(looksEnglish('Das Treffen ist um 10 Uhr.')).toBe(false)
    expect(looksEnglish("Bonjour à tous, merci beaucoup pour votre aide aujourd'hui")).toBe(false)
    expect(looksEnglish('Er will so sein.')).toBe(false)
    expect(looksEnglish('Um carro a mais.')).toBe(false)
    expect(looksEnglish("Je pense que c'est bon.")).toBe(false)
    expect(looksEnglish('Ik denk dat het goed is.')).toBe(false)
  })

  it('counts the German article "die" as German', () => {
    expect(looksEnglish('Die Sitzung beginnt um 10 Uhr.')).toBe(false)
  })

  it('needs more English than foreign evidence', () => {
    // One English word against as much German is not enough.
    expect(looksEnglish('Ich glaube, the Beatles sind gut')).toBe(false)
    // A lower-case "i" is Italian ("the"), not the English pronoun: counted
    // as English, the two here would outweigh "di".
    expect(looksEnglish('i ragazzi e i bambini di Roma')).toBe(false)
  })
})

describe('englishRulesFor', () => {
  it('gives explicit English the full rules whatever the text', () => {
    expect(englishRulesFor('en', 'Das Treffen ist um 10 Uhr.')).toBe('full')
  })

  it('never gives another explicit language the English rules', () => {
    expect(englishRulesFor('de', 'So I think we should ship it')).toBe('none')
  })

  it('grades Automatic by its evidence', () => {
    expect(englishRulesFor('auto', 'So I think we should ship it')).toBe('full')
    expect(englishRulesFor('auto', 'Um zehn.')).toBe('tentative')
    expect(englishRulesFor('auto', 'Das Treffen ist um 10 Uhr.')).toBe('none')
  })
})
