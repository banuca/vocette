/**
 * Splits a long take into pieces the on-device engine can decode safely.
 *
 * The recogniser's memory grows by roughly 7 MB per second of audio decoded
 * in one piece and is never handed back (130 s peaked at 1.7 GB in the spike),
 * while pieces of up to 30 s kept a 261 s take under 1 GB. A cut through a word
 * costs that word, so each cut goes in the quietest 300 ms the piece offers
 * between its halfway point and its limit — in practice, a pause between
 * words or sentences.
 */

const QUIET_WINDOW_SECONDS = 0.3
/** How far apart candidate windows start. Fine enough to find a pause. */
const SEARCH_STEP_SECONDS = 0.05

/**
 * Root-mean-square level of a window of samples (DC removed).
 *
 * A copy of `windowRms` in `src/renderer/audio-prep.ts`: the main process
 * must not import renderer code, and this needs to stay a pure function.
 */
function windowRms(samples: Float32Array, start: number, length: number): number {
  let sum = 0
  let mean = 0
  const end = Math.min(start + length, samples.length)
  for (let index = start; index < end; index += 1) mean += samples[index] ?? 0
  mean /= Math.max(1, end - start)
  for (let index = start; index < end; index += 1) {
    const value = (samples[index] ?? 0) - mean
    sum += value * value
  }
  return Math.sqrt(sum / Math.max(1, end - start))
}

/**
 * Returns the take as consecutive, non-overlapping views over `samples` (no
 * copies), each at most `maxSeconds` long, that together cover every sample
 * in order. A take that already fits comes back as a single piece.
 */
export function splitForDecoding(
  samples: Float32Array,
  sampleRate: number,
  maxSeconds = 30
): Float32Array[] {
  const maxLength = Math.floor(sampleRate * maxSeconds)
  if (!(maxLength > 0) || samples.length <= maxLength) return [samples]

  const minLength = Math.floor(maxLength / 2)
  const windowLength = Math.max(1, Math.round(sampleRate * QUIET_WINDOW_SECONDS))
  const step = Math.max(1, Math.round(sampleRate * SEARCH_STEP_SECONDS))

  const pieces: Float32Array[] = []
  let start = 0
  while (samples.length - start > maxLength) {
    // The cut lands in the middle of the chosen window, so the window has to
    // end by the limit for the piece to stay within it.
    const firstWindow = start + minLength
    const lastWindow = start + maxLength - windowLength
    let cut = start + maxLength
    if (lastWindow >= firstWindow) {
      const levels: number[] = []
      for (let window = firstWindow; window <= lastWindow; window += step) {
        levels.push(windowRms(samples, window, windowLength))
      }
      const chosen = quietestWindow(levels)
      cut = firstWindow + chosen * step + Math.floor(windowLength / 2)
    }
    pieces.push(samples.subarray(start, cut))
    start = cut
  }
  pieces.push(samples.subarray(start))
  return pieces
}

/**
 * The index of the quietest window. Real recordings almost never tie, but
 * digital silence does — every window in it is exactly as quiet as the next —
 * so a tie goes to the middle of the longest unbroken run of them: the pause
 * after a sentence outlasts the one after a comma, and cutting in its middle
 * leaves both pieces a margin of silence. Equal runs go to the later one, for
 * fewer and longer pieces.
 */
function quietestWindow(levels: readonly number[]): number {
  let quietest = Number.POSITIVE_INFINITY
  for (const level of levels) quietest = Math.min(quietest, level)

  let bestStart = 0
  let bestLength = 0
  let runStart = -1
  for (let index = 0; index <= levels.length; index += 1) {
    if (index < levels.length && levels[index] === quietest) {
      if (runStart < 0) runStart = index
      continue
    }
    if (runStart >= 0) {
      const length = index - runStart
      if (length >= bestLength) {
        bestStart = runStart
        bestLength = length
      }
      runStart = -1
    }
  }
  // Only a level that is not a number (samples that are not either) finds no run.
  return bestLength > 0 ? bestStart + Math.floor((bestLength - 1) / 2) : 0
}
