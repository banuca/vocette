/**
 * Whether a microphone's name reads like a Bluetooth headset's.
 *
 * Classic Bluetooth cannot carry stereo sound and a headset's microphone at
 * the same time. Opening the microphone moves the headset to its hands-free
 * profile, and whatever the user is listening to drops to mono, call-quality
 * sound until the microphone closes again. Vocette cannot change that; it can
 * say so where the microphone is chosen, so the drop is not a mystery.
 *
 * A web page is never told how a device is connected — a microphone has an
 * id, a group and a name, nothing more — so the name is all there is to go
 * on. It is a guess, which is why the note says "looks like": "headset", for
 * one, is also in the name of a wired headset. The words are the ones
 * headsets carry in the names Windows gives them ("Headset (WH-1000XM4
 * Hands-Free AG Audio)") and product names people know. Vendors do not agree
 * on capitals, so capitals are ignored.
 */
const BLUETOOTH_HEADSET_WORDS: readonly string[] = [
  'hands-free',
  'handsfree',
  'headset',
  'airpods',
  'buds',
  'bluetooth',
  // With its space, so the two letters inside a longer word do not count.
  'bt ',
  // Sony's model prefixes: WH-1000XM5 headphones, WF-1000XM5 earbuds.
  'wh-',
  'wf-'
]

/** Shown under the microphone picker while the one chosen looks like a headset. */
export const BLUETOOTH_HEADSET_NOTE =
  'This looks like a Bluetooth headset. While its microphone is open, Windows switches ' +
  "your headphones to call quality. Choose your computer's built-in microphone to keep full sound."

export function looksLikeBluetoothHeadset(label: string): boolean {
  // toLowerCase, not the locale's version: under a Turkish locale "AIRPODS"
  // would lower to "aırpods", with a dotless i, and stop matching.
  const name = label.toLowerCase()
  return BLUETOOTH_HEADSET_WORDS.some((word) => name.includes(word))
}
