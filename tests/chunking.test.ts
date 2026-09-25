import { describe, expect, it } from 'vitest'
import { splitForDecoding } from '../src/main/engine/chunking'

/**
 * Long takes are decoded in pieces to keep the engine's memory bounded. A cut
 * through a word costs that word, so these cases pin down where cuts may go,
 * and that nothing is lost or reordered by cutting.
 */
const RATE = 16000

/** Loud noise everywhere, with silent gaps at the given seconds. */
function speechWithPauses(totalSeconds: number, pauses: Array<[number, number]>): Float32Array {
  const samples = new Float32Array(Math.round(totalSeconds * RATE))
  let seed = 7
  for (let index = 0; index < samples.length; index += 1) {
    // A deterministic pseudo-random signal standing in for speech.
    seed = (seed * 1103515245 + 12345) % 2147483648
    samples[index] = (seed / 2147483648 - 0.5) * 0.8
  }
  for (const [start, end] of pauses) {
    samples.fill(0, Math.round(start * RATE), Math.round(end * RATE))
  }
  return samples
}

/**
 * True when the pieces are views over `samples` that follow one another with
 * no gap or overlap and end where it ends — every sample kept, in order.
 */
function coversInOrder(pieces: Float32Array[], samples: Float32Array): boolean {
  let expectedOffset = samples.byteOffset
  for (const piece of pieces) {
    if (piece.buffer !== samples.buffer || piece.byteOffset !== expectedOffset) return false
    expectedOffset += piece.byteLength
  }
  return expectedOffset === samples.byteOffset + samples.byteLength
}

describe('splitForDecoding', () => {
  it('leaves a take that fits alone, as one piece and no copy', () => {
    const samples = new Float32Array(RATE * 30)
    const pieces = splitForDecoding(samples, RATE)
    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toBe(samples)
  })

  it('splits a take only just over the limit', () => {
    const samples = speechWithPauses(30.01, [])
    const pieces = splitForDecoding(samples, RATE)
    expect(pieces).toHaveLength(2)
    expect(coversInOrder(pieces, samples)).toBe(true)
  })

  it('cuts in the pause, not through the speech', () => {
    // 40 s of speech with one clear pause at 22.0–22.6 s.
    const samples = speechWithPauses(40, [[22, 22.6]])
    const pieces = splitForDecoding(samples, RATE)
    expect(pieces).toHaveLength(2)
    const cutSeconds = (pieces[0]?.length ?? 0) / RATE
    expect(cutSeconds).toBeGreaterThan(22)
    expect(cutSeconds).toBeLessThan(22.6)
  })

  it('prefers the quietest pause when there is more than one', () => {
    const samples = speechWithPauses(45, [
      [17, 17.5],
      [26, 26.5]
    ])
    // Make the earlier pause merely quiet rather than silent.
    for (let index = Math.round(17 * RATE); index < Math.round(17.5 * RATE); index += 1) {
      samples[index] = index % 2 === 0 ? 0.05 : -0.05
    }
    const cutSeconds = (splitForDecoding(samples, RATE)[0]?.length ?? 0) / RATE
    expect(cutSeconds).toBeGreaterThan(26)
    expect(cutSeconds).toBeLessThan(26.5)
  })

  it('between silences equally quiet, cuts in the middle of the longest', () => {
    // Digital silence ties exactly. A comma's pause (0.35 s at 27 s) must lose
    // to a sentence's (0.8 s at 19 s), or the next piece would open
    // mid-sentence with a capital letter the speaker never meant.
    const samples = speechWithPauses(40, [
      [19, 19.8],
      [27, 27.35]
    ])
    const cutSeconds = (splitForDecoding(samples, RATE)[0]?.length ?? 0) / RATE
    expect(cutSeconds).toBeGreaterThan(19.3)
    expect(cutSeconds).toBeLessThan(19.5)
  })

  it('cuts a long silence in its middle, leaving both pieces a margin', () => {
    const samples = speechWithPauses(40, [[16, 29]])
    const cutSeconds = (splitForDecoding(samples, RATE)[0]?.length ?? 0) / RATE
    expect(cutSeconds).toBeGreaterThan(22)
    expect(cutSeconds).toBeLessThan(23)
  })

  it('never cuts before half the limit, however quiet it is earlier', () => {
    const samples = speechWithPauses(40, [[5, 10]])
    const first = splitForDecoding(samples, RATE)[0]
    expect((first?.length ?? 0) / RATE).toBeGreaterThanOrEqual(15)
  })

  it('never produces a piece longer than the limit, even with no pause at all', () => {
    const samples = speechWithPauses(301, [])
    const pieces = splitForDecoding(samples, RATE)
    expect(coversInOrder(pieces, samples)).toBe(true)
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(30 * RATE)
    // Every piece but the last is at least half the limit, so a five-minute
    // take is at most a handful of decodes.
    for (const piece of pieces.slice(0, -1)) expect(piece.length).toBeGreaterThanOrEqual(15 * RATE)
  })

  it('keeps every sample, in order, across the pieces', () => {
    const samples = speechWithPauses(130, [
      [20, 20.4],
      [48, 49],
      [70, 70.3],
      [101, 101.5]
    ])
    const pieces = splitForDecoding(samples, RATE)
    expect(pieces.length).toBeGreaterThan(4)
    // Views over the one buffer, not copies of it, and nothing dropped.
    expect(coversInOrder(pieces, samples)).toBe(true)
  })

  it('honours a smaller limit', () => {
    const samples = speechWithPauses(25, [[7, 7.4]])
    const pieces = splitForDecoding(samples, RATE, 10)
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(10 * RATE)
    expect(coversInOrder(pieces, samples)).toBe(true)
    const cutSeconds = (pieces[0]?.length ?? 0) / RATE
    expect(cutSeconds).toBeGreaterThan(7)
    expect(cutSeconds).toBeLessThan(7.4)
  })

  it('still makes progress with a limit shorter than the quiet window', () => {
    const samples = new Float32Array(10)
    const pieces = splitForDecoding(samples, 10, 0.2)
    expect(pieces.map((piece) => piece.length)).toEqual([2, 2, 2, 2, 2])
  })

  it('returns an unusable rate or limit as a single piece rather than loop', () => {
    const samples = new Float32Array(100)
    expect(splitForDecoding(samples, 0)).toHaveLength(1)
    expect(splitForDecoding(samples, Number.NaN)).toHaveLength(1)
    expect(splitForDecoding(samples, RATE, 0)).toHaveLength(1)
  })
})
