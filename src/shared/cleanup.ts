import { applySpokenCorrections } from './spoken-corrections'

/** What the three cleanup switches ask for, and the dictation language they apply to. */
export interface CleanupOptions {
  /** `'auto'` or an ISO-639-1 code. */
  language: string
  removeFillers: boolean
  spokenCorrections: boolean
  spokenFormatting: boolean
}

/**
 * Word characters for whole-word matching. Apostrophes and hyphens count, so
 * a filler inside "I'm", "uh-huh" or "mm-hmm" is never cut out of it.
 */
const WORD_CHAR = String.raw`[\p{L}\p{N}\p{M}'’-]`

/**
 * Hesitation sounds that are not words in any supported language. Plain "um"
 * and "er" are left to the English rules: "um" is a word in German ("um 10
 * Uhr") and Portuguese ("um carro"), and "er" is German for "he". Plain "mm"
 * is not here at all, because "5 mm" is a measurement.
 */
const UNIVERSAL_HESITATIONS = 'umm+|uh+|erm+|hmm+|mmm+|äh+m?|ähm|öhm|euh|ehm'
const ENGLISH_HESITATIONS = `${UNIVERSAL_HESITATIONS}|um|er+`
/** Without "um" standing alone: under a tentative reading it goes only before a comma. */
const TENTATIVE_HESITATIONS = `${UNIVERSAL_HESITATIONS}|er+`

/**
 * How much of the English rulebook a dictation gets.
 *
 * `full` is explicit English, or Automatic with English evidence. `tentative`
 * is Automatic with no evidence either way: the English rules run, except
 * that a plain "um" goes only where a comma marks it as a pause ("Um, so…"),
 * because "Um zehn." is German for "at ten". `none` is every other language.
 */
export type EnglishRules = 'full' | 'tentative' | 'none'

/**
 * The evidence that decides whether an Automatic dictation gets the English
 * rules. These English-only function words score a point each; "I" scores
 * only as a capital, because a lower-case "i" is Italian.
 */
const ENGLISH_FUNCTION_WORDS = new Set([
  'the', 'and', 'it', 'you', 'that', 'this', 'with', 'be', 'have', 'not', 'but', 'what', 'can',
  'your', 'our', 'they', 'she', 'if', 'or', 'just', 'then', 'there', 'about', 'from', 'by',
  'all', 'would', 'should', 'could', 'think', 'get', 'like', 'know', 'want', 'going', 'now',
  'how', 'when', 'why', 'who', 'were', 'has', 'had', 'been', 'does', 'did', "they're", "it's",
  "i'm", "don't", "can't", "won't", 'need'
])

/**
 * English function words that are also everyday words elsewhere — "so",
 * "will", "was" and "die" are German, "a", "me" and "do" Romance, "of" and
 * "we" Dutch — so they score only half a point.
 */
const SHARED_FUNCTION_WORDS = new Set([
  'so', 'will', 'was', 'in', 'a', 'an', 'do', 'me', 'is', 'we', 'as', 'of', 'on', 'he', 'to',
  'my', 'are', 'for', 'at', 'die'
])

/**
 * Frequent function words of the other Latin-script languages people
 * dictate in most, a point each. "Das Treffen ist um 10 Uhr." is German
 * however little English it shares, so it keeps its "um". "um" itself is not
 * here: it is also the English hesitation this evidence is deciding about.
 * "die" is here as well as among the shared words, so the German article
 * cancels its own half point of English.
 */
const FOREIGN_FUNCTION_WORDS = new Set([
  // German
  'der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'sie', 'es', 'er', 'wir', 'ein', 'eine',
  'zu', 'mit', 'auf', 'für', 'von', 'sein', 'dass', 'wie', 'auch', 'aber', 'oder', 'wenn', 'ja',
  'nein',
  // French
  'le', 'la', 'les', 'est', 'et', 'je', 'tu', 'il', 'nous', 'vous', 'une', 'des', 'du', 'pas',
  'que', 'qui', 'pour', 'dans', 'avec', 'sur', 'oui', 'mais',
  // Spanish
  'el', 'los', 'las', 'y', 'un', 'una', 'del', 'al', 'por', 'con', 'para', 'su', 'lo', 'como',
  'sí', 'pero', 'muy',
  // Italian
  'di', 'che', 'è', 'non', 'sono', 'della',
  // Dutch
  'het', 'een', 'van', 'niet', 'dat', 'ik', 'zijn', 'op', 'voor', 'met',
  // Portuguese
  'uma', 'não', 'os', 'em', 'com', 'é'
])

/**
 * "new line" / "new paragraph", only as a phrase of its own: bounded by
 * punctuation, a line break or the ends of the text on both sides. "We need a
 * new line of products" is not a command. The punctuation the recogniser put
 * after the phrase goes with it; the punctuation before it ends the previous
 * sentence and stays.
 */
const SPOKEN_BREAK =
  /(?<=^|[,.;:!?…\n])[ \t]*new[ \t]+(line|paragraph)[ \t]*(?=[,.;:!?…\n]|$)[,.;:!?…]*/giu

interface FillerRule {
  pattern: RegExp
  /** What a match becomes. A `lead` group, when the pattern has one, is kept in front. */
  replacement: string
}

/** Every filler pattern names the filler itself `filler`, so capitals can be checked. */
type FillerGroups = Partial<Record<'lead' | 'filler', string>>

/**
 * The hesitation rules for one reading. `commaWords` go wherever a comma
 * follows them; `aloneWords` go anywhere.
 */
function hesitationRules(aloneWords: string, commaWords = aloneWords): FillerRule[] {
  const word = String.raw`(?<!${WORD_CHAR})(?<filler>${commaWords}|ah+)(?!${WORD_CHAR})`
  return [
    // Between commas, both commas go with it: "Er hat, äh, recht." → "Er hat recht."
    { pattern: new RegExp(String.raw`[ \t]*,[ \t]*${word}[ \t]*,`, 'giu'), replacement: ' ' },
    // The comma after an opening hesitation was only there for the pause.
    { pattern: new RegExp(String.raw`${word}[ \t]*,[ \t]*`, 'giu'), replacement: '' },
    {
      pattern: new RegExp(
        String.raw`(?<!${WORD_CHAR})(?<filler>${aloneWords})(?!${WORD_CHAR})`,
        'giu'
      ),
      replacement: ''
    },
    // "ah" is also an exclamation ("Ah!"), so on its own it goes only between words.
    {
      pattern: new RegExp(String.raw`(?<!${WORD_CHAR})(?<filler>ah+)(?=[ \t])`, 'giu'),
      replacement: ''
    }
  ]
}

const ENGLISH_FILLERS: FillerRule[] = [
  // "Like, " / "You know, " / "I mean, " opening a sentence.
  {
    pattern:
      /(?<lead>^|[.!?]["'”’)\]]*[ \t]+|\n[ \t]*)(?<filler>like|you[ \t]+know|i[ \t]+mean)[ \t]*,[ \t]*/giu,
    replacement: ''
  },
  // A comma-enclosed filler goes with both commas, as a hesitation does:
  // leaving one behind gave "we could, try it" far more often than it
  // kept a genuine aside.
  {
    pattern: /[ \t]*,[ \t]*(?<filler>like|you[ \t]+know|i[ \t]+mean|you[ \t]+see)[ \t]*,/giu,
    replacement: ' '
  }
]

const HESITATION_RULES: Record<EnglishRules, FillerRule[]> = {
  full: hesitationRules(ENGLISH_HESITATIONS),
  tentative: hesitationRules(TENTATIVE_HESITATIONS, ENGLISH_HESITATIONS),
  none: hesitationRules(UNIVERSAL_HESITATIONS)
}

const FILLER_RULES: Record<EnglishRules, FillerRule[]> = {
  full: [...ENGLISH_FILLERS, ...HESITATION_RULES.full],
  tentative: [...ENGLISH_FILLERS, ...HESITATION_RULES.tentative],
  none: HESITATION_RULES.none
}

/**
 * A stutter on a function word: "I I think", "the the", "I, I think". The
 * list is closed on purpose — "that that", "had had", "very very", "no no"
 * and "bye bye" are usually meant, and are never touched.
 */
const REPEATED_WORD = new RegExp(
  String.raw`(?<!${WORD_CHAR})(i|a|an|the|to|and|we|you|he|she|it|they|is|in|of|on|for|my|our|but|so|if|this)(?:[ \t]*,?[ \t]+\1(?!${WORD_CHAR}))+`,
  'giu'
)

/** "e.g.", "i.e." and "a.m." end in a full stop without ending the sentence. */
const DOTTED_ABBREVIATION = /(?:^|[^\p{L}\p{N}.])(?:\p{L}\.){2,}$/u

/** The word inside a token's punctuation: `Tuesday,` → `Tuesday`. */
function wordOf(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

/** "ER" is an emergency room and "UM" a university, never a hesitation. */
function writtenInCapitals(word: string): boolean {
  return word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase()
}

function upperFirstLetterAt(text: string, index: number): string {
  const letter = text[index]
  if (!letter || !/\p{Ll}/u.test(letter)) return text
  return `${text.slice(0, index)}${letter.toUpperCase()}${text.slice(index + 1)}`
}

/** The English and the foreign evidence in a text, as scores. */
function languageEvidence(text: string): { english: number; foreign: number } {
  let english = 0
  let foreign = 0
  for (const word of text.split(/\s+/u).map(wordOf)) {
    if (!word) continue
    // Recognisers write either apostrophe; the lists use the plain one.
    const lower = word.toLowerCase().replace(/’/gu, "'")
    if (word === 'I' || ENGLISH_FUNCTION_WORDS.has(lower)) english += 1
    else if (SHARED_FUNCTION_WORDS.has(lower)) english += 0.5
    if (FOREIGN_FUNCTION_WORDS.has(lower)) foreign += 1
  }
  return { english, foreign }
}

/**
 * The English wording rules — "er", "like", "scratch that", "new line" —
 * apply to explicit English, and to Automatic when the text reads as English.
 * Every other language gets only what cannot change a word: the universal
 * hesitation sounds and the punctuation repairs.
 */
export function englishRulesFor(language: string, text: string): EnglishRules {
  if (language === 'en') return 'full'
  if (language !== 'auto') return 'none'
  const { english, foreign } = languageEvidence(text)
  if (english > foreign) return 'full'
  return english === 0 && foreign === 0 ? 'tentative' : 'none'
}

/**
 * Whether an Automatic dictation reads as English: the English evidence
 * outweighs the foreign, or there is no evidence either way ("Hello.").
 */
export function looksEnglish(text: string): boolean {
  return englishRulesFor('auto', text) !== 'none'
}

/** Trims, and collapses runs of spaces and tabs. Line breaks are kept. */
export function normaliseWhitespace(input: string): string {
  return input
    .replace(/\r\n?/gu, '\n')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ ?\n ?/gu, '\n')
    .trim()
}

/** "Hello team. New paragraph. The plan" → "Hello team.\n\nThe plan". */
export function applySpokenFormatting(text: string): string {
  let output = ''
  let cursor = 0
  let afterBreak = false
  const append = (segment: string): void => {
    // A line never starts with a space, and starts with a capital.
    const piece = afterBreak ? upperFirstLetterAt(segment.replace(/^[ \t]+/u, ''), 0) : segment
    output += piece
    if (piece) afterBreak = false
  }
  for (const match of text.matchAll(SPOKEN_BREAK)) {
    append(text.slice(cursor, match.index))
    output += match[1]?.toLowerCase() === 'paragraph' ? '\n\n' : '\n'
    afterBreak = true
    cursor = match.index + match[0].length
  }
  append(text.slice(cursor))
  return output
}

function applyFillerRule(text: string, rule: FillerRule): string {
  return text.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
    const groups = rest.at(-1) as FillerGroups
    if (writtenInCapitals(groups.filler ?? '')) return match
    return `${groups.lead ?? ''}${rule.replacement}`
  })
}

function removeFillersOnce(text: string, rules: EnglishRules): string {
  // Stutters first: in "is, I, I mean, fine" the repeated "I" has to collapse
  // before "I mean" is lifted out, or the first "I" is left stranded.
  let result = rules === 'none' ? text : text.replace(REPEATED_WORD, '$1')
  for (const rule of FILLER_RULES[rules]) {
    result = applyFillerRule(result, rule)
  }
  return result
}

/**
 * Drops hesitation sounds everywhere and, under the English rules, the
 * comma-delimited "like" / "you know" and stutters on function words. The
 * speaker's own words are never rewritten, only removed where they were
 * filler.
 */
export function removeFillerWords(text: string, rules: EnglishRules): string {
  let result = text
  // Every rule only removes text, so this settles within a few rounds. The
  // second round catches a filler the first one exposed: "Like, you know, it".
  for (let round = 0; round < 4; round += 1) {
    const next = removeFillersOnce(result, rules)
    if (next === result) break
    result = next
  }
  return result
}

/**
 * Only the hesitation sounds, which are never words the speaker meant. The
 * rest of the filler pass waits until after spoken corrections, because it
 * lifts out a sentence-opening "I mean," that a correction needs to see.
 */
function removeHesitations(text: string, rules: EnglishRules): string {
  return HESITATION_RULES[rules].reduce(applyFillerRule, text)
}

function capitalise(text: string): string {
  // A leading quote is skipped, but a leading number is the start: "3 apples".
  const first = text.search(/[\p{L}\p{N}]/u)
  const opened = first >= 0 ? upperFirstLetterAt(text, first) : text
  return opened.replace(
    /([.!?]\s+|\n)(\p{Ll})/gu,
    (match: string, gap: string, letter: string, offset: number) =>
      gap.startsWith('.') && DOTTED_ABBREVIATION.test(opened.slice(0, offset + 1))
        ? match
        : `${gap}${letter.toUpperCase()}`
  )
}

/**
 * Spacing, punctuation and capitals, in every language.
 *
 * No space is ever inserted after punctuation: recognisers already space
 * their own output, and inserting one broke `example.com`, `3.5`, `10:30`
 * and `e.g.`. Only spaces and tabs are trimmed from the ends: a line break
 * there was asked for out loud ("Hello team. New line.") and stays. When
 * nothing but punctuation is left, only those line breaks remain — usually
 * none, so `''`.
 */
export function repairPunctuation(text: string): string {
  const tidied = text
    // What the earlier passes removed leaves doubled spaces behind.
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ ?\n ?/gu, '\n')
    .replace(/ ([,.;:!?])/gu, '$1')
    .replace(/,{2,}/gu, ',')
    .replace(/!{2,}/gu, '!')
    .replace(/\?{2,}/gu, '?')
    // Two full stops are a slip; three are an ellipsis and stay.
    .replace(/(?<!\.)\.\.(?!\.)/gu, '.')
    // ", ." — a comma stranded before the end of a sentence.
    .replace(/,+(?=[.!?])/gu, '')
    // Punctuation stranded at the start of a line by a removed hesitation:
    // "Um. Hello." and "Hmm... okay." A leading ".NET" or "...and" runs
    // straight into its word and stays.
    .replace(/(^|\n)[,.;:!?…]+(?: |(?=\n)|$)/gu, '$1')
    .replace(/^[ \t]+|[ \t]+$/gu, '')
  if (!/[^\p{P}\p{Z}\s]/u.test(tidied)) return tidied.replace(/[^\n]/gu, '')
  return capitalise(tidied)
}

/**
 * Cleans a transcript according to the user's three switches.
 *
 * With every switch off the provider's text is returned as it came, apart
 * from outer whitespace. Otherwise the passes run in a fixed order, each
 * blind to the switches it does not own: spoken formatting, spoken
 * corrections, fillers, then the repairs that tidy up after all of them.
 */
export function cleanupTranscript(input: string, options: CleanupOptions): string {
  const { removeFillers, spokenCorrections, spokenFormatting } = options
  if (!removeFillers && !spokenCorrections && !spokenFormatting) return input.trim()

  let text = normaliseWhitespace(input)
  const rules = englishRulesFor(options.language, text)
  const english = rules !== 'none'
  if (spokenFormatting && english) text = applySpokenFormatting(text)
  if (spokenCorrections && english) {
    // A hesitation beside a marker hides it: in "Tuesday. Uh, no sorry,
    // Wednesday." the sentence opens with "Uh", not "No sorry". With fillers
    // switched on they go first, and the punctuation they leave is tidied so
    // the sentence boundaries are where the corrections expect them.
    if (removeFillers) text = repairPunctuation(removeHesitations(text, rules))
    text = applySpokenCorrections(text)
  }
  if (removeFillers) text = removeFillerWords(text, rules)
  return repairPunctuation(text)
}
