import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  RESTING_BARS,
  drawBars,
  encodePng,
  listeningBars,
  trayColour,
  trayFrame,
  writingAlphas
} from '../src/main/tray-icon'

/** Reads back the pixels of a PNG this module wrote: filter 0 rows, RGBA. */
function decode(png: Buffer): { size: number; rgba: Buffer } {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const size = png.readUInt32BE(16)
  const idatLength = png.readUInt32BE(33)
  expect(png.subarray(37, 41).toString('ascii')).toBe('IDAT')
  const rows = inflateSync(png.subarray(41, 41 + idatLength))
  const rgba = Buffer.alloc(size * size * 4)
  for (let row = 0; row < size; row += 1) {
    expect(rows[row * (size * 4 + 1)]).toBe(0)
    rows.copy(rgba, row * size * 4, row * (size * 4 + 1) + 1, (row + 1) * (size * 4 + 1))
  }
  return { size, rgba }
}

/** How many rows of a column are painted: one bar's height in pixels. */
function columnHeight(rgba: Buffer, size: number, column: number): number {
  let painted = 0
  for (let row = 0; row < size; row += 1) {
    if ((rgba[(row * size + column) * 4 + 3] ?? 0) > 0) painted += 1
  }
  return painted
}

describe('the tray icon', () => {
  it('writes real PNGs at 16 and 32 pixels, transparent around the bars', () => {
    const frame = trayFrame('ready', false)
    const small = decode(frame.small)
    const large = decode(frame.large)
    expect(small.size).toBe(16)
    expect(large.size).toBe(32)
    // The corner pixel is ground, not bar.
    expect(small.rgba[3]).toBe(0)
    expect(large.rgba[3]).toBe(0)
  })

  it('draws the mark at rest with the middle bar tallest', () => {
    const { rgba, size } = decode(encodePng(32, drawBars(32, RESTING_BARS, [0, 0, 0])))
    const heights = [2, 8, 14, 20, 26].map((column) => columnHeight(rgba, size, column + 1))
    expect(Math.max(...heights)).toBe(heights[2])
    expect(heights[2]).toBe(28)
    expect(heights[0]).toBeLessThan(heights[1]!)
  })

  it('takes the taskbar’s ink when ready, and red only while listening', () => {
    expect(trayColour('ready', false)).toEqual([0x3d, 0x3d, 0x45])
    expect(trayColour('ready', true)).toEqual([0xe6, 0xe6, 0xea])
    expect(trayColour('listening', false)).toEqual([0xe5, 0x38, 0x3b])
    expect(trayColour('listening', true)).toEqual([0xff, 0x5a, 0x5f])
    expect(trayColour('writing', true)).not.toEqual(trayColour('listening', true))
  })

  it('raises the bars with the voice, and never lets one vanish', () => {
    const still = () => 0.5
    const quiet = listeningBars(0, still)
    const loud = listeningBars(1, still)
    expect(quiet.every((share) => share >= 0.18)).toBe(true)
    expect(loud[2]).toBeGreaterThan(quiet[2]!)
    expect(loud.every((share) => share <= 1)).toBe(true)
    // The middle bar answers most.
    expect(loud[2]).toBeGreaterThan(loud[0]!)
  })

  it('passes a light along the bars while writing', () => {
    expect(writingAlphas(0)).toEqual([1, 0.45, 0.45, 0.45, 0.7])
    expect(writingAlphas(1)).toEqual([0.7, 1, 0.45, 0.45, 0.45])
    expect(writingAlphas(5)).toEqual(writingAlphas(0))
  })
})
