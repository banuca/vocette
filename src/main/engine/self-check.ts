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
 * The recording, `resources/self-check.wav`, is the line "Ask not what your
 * country can do for you" from John F. Kennedy's inaugural address (1961), a
 * work of the US federal government and so in the public domain. It comes
 * from sherpa-onnx's test file for this model:
 *   https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3/resolve/1a468a35cbba69418f126de829e75261dea4a4e4/test_wavs/en.wav
 *   SHA-256 148b936b43ce7c546a866e64da059f0458aee2d65e617f16e9d94f06e8d99ed6 (24 kHz mono, 3.85 s)
 * which runs quicker than the 1961 delivery: that it is the original
 * recording is unconfirmed. Cut at the pause at 3.23 s, made 16 kHz mono PCM16:
 *   ffmpeg -i en.wav -af "atrim=end=3.23,afade=t=out:st=3.21:d=0.02,aresample=16000:resampler=soxr"
 *     -ac 1 -c:a pcm_s16le -map_metadata -1 -fflags +bitexact -flags:a +bitexact self-check.wav
 *   SHA-256 3b90f6d7920851cb8a1f01583a8ab526cf7a0f6c04b2f9a92ffb4444c18d4b50 (103,404 bytes)
 * The released model reads it as "Ask not what your country can do for you,
 * ask what you can do for your country." in about 0.3 s on a Core Ultra 7 265U.
 */

/** The recording's name in the app's resources folder. */
export const SELF_CHECK_FILE = 'self-check.wav'

/** What the recording says, as the words that must come back. */
export const SELF_CHECK_WORDS: readonly string[] = [
  'ask',
  'not',
  'what',
  'your',
  'country',
  'can',
  'do',
  'for',
  'you'
]

/** Lower case, letters and digits only: "Ask not, what" becomes ["ask", "not", "what"]. */
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
