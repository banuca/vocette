/**
 * The on-device engine's check of itself, run after every model load.
 *
 * A model build once turned speech into nonsense on some AMD processors
 * ("Ask not what you're comstrich and do for you", 19 Oct; see
 * docs/plan-p1-mac-linux.md), and nothing in the app could tell. Users will
 * have processors nobody has tested, so before taking any dictation the engine
 * transcribes a short known recording, and is trusted only if the words come
 * back.
 *
 * The recording, `resources/self-check.wav`, is "It is a truth universally
 * acknowledged", the opening words of Jane Austen's Pride and Prejudice
 * (1813), read by Karen Savage for LibriVox in 2007. LibriVox recordings are
 * dedicated to the public domain, and the text is out of copyright
 * everywhere. `resources/self-check.md`, beside it, records the source file,
 * the licence and how it was cut: 2.17 s of 16 kHz mono PCM16,
 *   SHA-256 71e41bf591c73affb142e0124e64a72724f8fec7231fd0bceda392298f5d507a (69,484 bytes).
 * The released model reads it as "It is a truth universally acknowledged.",
 * about as fast as the recording it replaced (cut from sherpa-onnx's test
 * file, whose source and licence could not be confirmed).
 */

/** The recording's name in the app's resources folder. */
export const SELF_CHECK_FILE = 'self-check.wav'

/** What the recording says, as the words that must come back. */
export const SELF_CHECK_WORDS: readonly string[] = [
  'it',
  'is',
  'a',
  'truth',
  'universally',
  'acknowledged'
]

/** Lower case, letters and digits only: "It is, a TRUTH" becomes ["it", "is", "a", "truth"]. */
export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/**
 * True when every expected word comes back, in order. Case and punctuation
 * are ignored, and other words may sit between them, so a correct engine is
 * never failed over a comma or an extra word; a garbled one cannot pass.
 */
export function selfCheckPasses(text: string): boolean {
  let next = 0
  for (const word of wordsOf(text)) {
    if (word === SELF_CHECK_WORDS[next]) next += 1
    if (next === SELF_CHECK_WORDS.length) return true
  }
  return false
}
