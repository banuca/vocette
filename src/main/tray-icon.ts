import { crc32, deflateSync } from 'node:zlib'

/**
 * The tray icon: Vocette's five bars, drawn in code so they can follow the
 * voice. Three states: ready (still bars in the taskbar's ink), listening (red
 * bars that rise and fall with the microphone level) and writing (grey bars
 * with a light passing along them). Drawing is pure and returns PNG bytes at
 * 16 and 32 pixels, so the main process only hands them to the tray.
 */

export type TrayState = 'ready' | 'listening' | 'writing'

/** The bars at rest, as a share of the tallest: the mark's own profile. */
export const RESTING_BARS: readonly number[] = [0.33, 0.67, 1, 0.6, 0.27]

/** How much each bar answers the level: the middle most, the edges least. */
const LEVEL_WEIGHT: readonly number[] = [0.5, 0.8, 1, 0.75, 0.45]
/** No bar ever disappears: below this share it would read as a dot of dirt. */
const MIN_SHARE = 0.18

type Rgb = readonly [number, number, number]

/** Ink for each state, against a light or a dark taskbar. */
export function trayColour(state: TrayState, darkTaskbar: boolean): Rgb {
  if (state === 'listening') return darkTaskbar ? [0xff, 0x5a, 0x5f] : [0xe5, 0x38, 0x3b]
  if (state === 'writing') return darkTaskbar ? [0xb4, 0xb4, 0xbe] : [0x5e, 0x5e, 0x69]
  return darkTaskbar ? [0xe6, 0xe6, 0xea] : [0x3d, 0x3d, 0x45]
}

/**
 * Bar heights for a microphone level from 0 to 1. `wobble` gives each bar a
 * slightly different answer, so speech looks alive rather than like one
 * fader; tests pass a fixed one.
 */
export function listeningBars(level: number, wobble: () => number = Math.random): number[] {
  const loud = Math.min(1, Math.max(0, level)) ** 0.6
  // At full voice the middle bar just reaches the top and the edges stay
  // short, so the icon keeps the shape of a waveform instead of a wall.
  return LEVEL_WEIGHT.map((weight) =>
    Math.min(
      1,
      Math.max(MIN_SHARE, MIN_SHARE + loud * (1 - MIN_SHARE) * weight * (0.85 + 0.3 * wobble()))
    )
  )
}

/** Opacity of each bar while writing: a light passing from left to right. */
export function writingAlphas(step: number): number[] {
  const lit = ((step % 5) + 5) % 5
  return RESTING_BARS.map((_, index) => (index === lit ? 1 : index === (lit + 4) % 5 ? 0.7 : 0.45))
}

/** Bar positions in pixels for the two sizes drawn: x and width. */
function layout(size: 16 | 32): { x: number[]; width: number; pad: number } {
  return size === 16
    ? { x: [1, 4, 7, 10, 13], width: 2, pad: 1 }
    : { x: [2, 8, 14, 20, 26], width: 4, pad: 2 }
}

/**
 * Five bars into an RGBA buffer, centred, on a transparent ground. A bar's
 * corners are softened at 32 px, where a square end would look blunt.
 */
export function drawBars(
  size: 16 | 32,
  heights: readonly number[],
  colour: Rgb,
  alphas: readonly number[] = [1, 1, 1, 1, 1]
): Buffer {
  const pixels = Buffer.alloc(size * size * 4)
  const { x, width, pad } = layout(size)
  const tallest = size - pad * 2
  heights.forEach((share, bar) => {
    const left = x[bar] ?? 0
    const height = Math.max(width, Math.round(Math.min(1, Math.max(0, share)) * tallest))
    const top = Math.round((size - height) / 2)
    const alpha = Math.round(255 * Math.min(1, Math.max(0, alphas[bar] ?? 1)))
    for (let row = top; row < top + height; row += 1) {
      for (let column = left; column < left + width; column += 1) {
        const corner =
          width >= 4 &&
          (row === top || row === top + height - 1) &&
          (column === left || column === left + width - 1)
        const offset = (row * size + column) * 4
        pixels[offset] = colour[0]
        pixels[offset + 1] = colour[1]
        pixels[offset + 2] = colour[2]
        pixels[offset + 3] = corner ? Math.round(alpha * 0.35) : alpha
      }
    }
  })
  return pixels
}

/** A PNG file for an RGBA buffer, using only Node's zlib. */
export function encodePng(size: number, rgba: Buffer): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([length, body, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bits per channel
  header[9] = 6 // RGBA
  // Each row starts with filter type 0 (none).
  const rows = Buffer.alloc((size * 4 + 1) * size)
  for (let row = 0; row < size; row += 1) {
    rgba.copy(rows, row * (size * 4 + 1) + 1, row * size * 4, (row + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

export interface TrayFrame {
  /** PNG at 16 px, for a 100% display. */
  small: Buffer
  /** PNG at 32 px, for 200%. */
  large: Buffer
}

/** One frame of the tray icon in both sizes. */
export function trayFrame(
  state: TrayState,
  darkTaskbar: boolean,
  heights: readonly number[] = RESTING_BARS,
  alphas?: readonly number[]
): TrayFrame {
  const colour = trayColour(state, darkTaskbar)
  return {
    small: encodePng(16, drawBars(16, heights, colour, alphas)),
    large: encodePng(32, drawBars(32, heights, colour, alphas))
  }
}
