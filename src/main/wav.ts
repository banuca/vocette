/**
 * Reads the WAV the recorder produces, for the on-device engine.
 *
 * The speech addon ships WAV readers of its own, but inside Electron they
 * throw "External buffers are not allowed" (the V8 memory cage), so Murmur
 * parses the file here and hands the engine an ordinary `Float32Array`.
 *
 * Only what Murmur's own recorder and common tools write is accepted: a
 * RIFF/WAVE file holding 16-bit PCM, mono or stereo. Anything else returns
 * null so the caller can say plainly that the recording could not be read,
 * rather than transcribe noise.
 */

export interface DecodedWav {
  /** Mono samples in [-1, 1). Stereo is averaged down. */
  samples: Float32Array
  sampleRate: number
}

const WAVE_FORMAT_PCM = 0x0001
/** WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of its sub-format GUID. */
const WAVE_FORMAT_EXTENSIBLE = 0xfffe
const MAX_SAMPLE_RATE = 384_000

function fourCc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  )
}

interface Format {
  channels: number
  sampleRate: number
  bitsPerSample: number
  formatTag: number
}

function readFormat(view: DataView, offset: number, size: number): Format | null {
  // 16 bytes is the PCM minimum; SAPI and others write 18 (a zero cbSize),
  // WAVE_FORMAT_EXTENSIBLE writes 40.
  if (size < 16) return null
  let formatTag = view.getUint16(offset, true)
  if (formatTag === WAVE_FORMAT_EXTENSIBLE) {
    if (size < 40) return null
    formatTag = view.getUint16(offset + 24, true)
  }
  return {
    formatTag,
    channels: view.getUint16(offset + 2, true),
    sampleRate: view.getUint32(offset + 4, true),
    bitsPerSample: view.getUint16(offset + 14, true)
  }
}

export function decodeWav(bytes: Uint8Array): DecodedWav | null {
  if (bytes.byteLength < 12) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (fourCc(view, 0) !== 'RIFF' || fourCc(view, 8) !== 'WAVE') return null

  let format: Format | null = null
  let dataOffset = -1
  let dataSize = 0

  // Walk the chunks rather than assume the 44-byte layout: `LIST`, `fact` and
  // other chunks may sit anywhere, and `fmt ` is not always 16 bytes long.
  let offset = 12
  while (offset + 8 <= view.byteLength) {
    const id = fourCc(view, offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      if (body + size > view.byteLength) return null
      format = readFormat(view, body, size)
      if (!format) return null
    } else if (id === 'data') {
      dataOffset = body
      // A writer that streamed the file may leave the size unset or too
      // large; what is actually there is what counts.
      dataSize = Math.min(size, view.byteLength - body)
      if (format) break
    }
    // Chunks are word-aligned: an odd size is followed by a pad byte.
    offset = body + size + (size % 2)
  }

  if (!format || dataOffset < 0) return null
  if (format.formatTag !== WAVE_FORMAT_PCM || format.bitsPerSample !== 16) return null
  if (format.channels !== 1 && format.channels !== 2) return null
  if (format.sampleRate <= 0 || format.sampleRate > MAX_SAMPLE_RATE) return null

  const frameBytes = format.channels * 2
  const frames = Math.floor(dataSize / frameBytes)
  const samples = new Float32Array(frames)
  let position = dataOffset
  if (format.channels === 1) {
    for (let frame = 0; frame < frames; frame += 1) {
      samples[frame] = view.getInt16(position, true) / 32768
      position += 2
    }
  } else {
    for (let frame = 0; frame < frames; frame += 1) {
      const left = view.getInt16(position, true)
      const right = view.getInt16(position + 2, true)
      samples[frame] = (left + right) / 65536
      position += 4
    }
  }
  return { samples, sampleRate: format.sampleRate }
}
