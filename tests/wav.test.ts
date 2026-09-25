import { describe, expect, it } from 'vitest'
import { encodeWavPcm16 } from '../src/renderer/audio-prep'
import { decodeWav } from '../src/main/wav'

/**
 * The on-device engine hears only what this parser hands it, so every case
 * is about reading the recorder's own files exactly, and refusing — rather
 * than misreading — anything else.
 */

interface WavParts {
  formatTag?: number
  channels?: number
  sampleRate?: number
  bitsPerSample?: number
  /** Extra bytes appended to the `fmt ` chunk (18-byte and extensible forms). */
  fmtExtra?: Uint8Array
  /** Chunks placed between `fmt ` and `data`. */
  between?: Array<{ id: string; body: Uint8Array }>
  data: Uint8Array
  /** Overrides the size written in the `data` header. */
  dataSize?: number
}

function chunk(id: string, body: Uint8Array, declaredSize = body.byteLength): Uint8Array {
  const padded = body.byteLength % 2 === 1 ? body.byteLength + 1 : body.byteLength
  const bytes = new Uint8Array(8 + padded)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < 4; index += 1) bytes[index] = id.charCodeAt(index)
  view.setUint32(4, declaredSize, true)
  bytes.set(body, 8)
  return bytes
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

function wav(parts: WavParts): Uint8Array {
  const channels = parts.channels ?? 1
  const sampleRate = parts.sampleRate ?? 16000
  const bits = parts.bitsPerSample ?? 16
  const fmt = new Uint8Array(16 + (parts.fmtExtra?.byteLength ?? 0))
  const view = new DataView(fmt.buffer)
  view.setUint16(0, parts.formatTag ?? 1, true)
  view.setUint16(2, channels, true)
  view.setUint32(4, sampleRate, true)
  view.setUint32(8, (sampleRate * channels * bits) / 8, true)
  view.setUint16(12, (channels * bits) / 8, true)
  view.setUint16(14, bits, true)
  if (parts.fmtExtra) fmt.set(parts.fmtExtra, 16)

  const body = concat([
    new TextEncoder().encode('WAVE'),
    chunk('fmt ', fmt),
    ...(parts.between ?? []).map((extra) => chunk(extra.id, extra.body)),
    chunk('data', parts.data, parts.dataSize)
  ])
  const header = new Uint8Array(8)
  header.set(new TextEncoder().encode('RIFF'), 0)
  new DataView(header.buffer).setUint32(4, body.byteLength, true)
  return concat([header, body])
}

function pcm16(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setInt16(index * 2, value, true))
  return bytes
}

describe('decodeWav', () => {
  it('reads the WAV the recorder itself writes, sample for sample', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 0.25, -1])
    const decoded = decodeWav(new Uint8Array(encodeWavPcm16(samples, 16000)))
    expect(decoded?.sampleRate).toBe(16000)
    expect(decoded?.samples.length).toBe(5)
    // Within one step of 16-bit quantisation.
    decoded?.samples.forEach((value, index) => {
      expect(Math.abs(value - (samples[index] ?? 0))).toBeLessThan(1 / 32000)
    })
  })

  it('scales 16-bit values into [-1, 1)', () => {
    const decoded = decodeWav(wav({ data: pcm16([0, 16384, -32768, 32767]) }))
    expect(Array.from(decoded?.samples ?? [])).toEqual([0, 0.5, -1, 32767 / 32768])
  })

  it('averages stereo down to mono', () => {
    const decoded = decodeWav(wav({ channels: 2, data: pcm16([16384, 0, -16384, -16384]) }))
    expect(Array.from(decoded?.samples ?? [])).toEqual([0.25, -0.5])
  })

  it('handles the 18-byte fmt chunk that SAPI and others write', () => {
    const decoded = decodeWav(wav({ fmtExtra: new Uint8Array(2), data: pcm16([8192, -8192]) }))
    expect(Array.from(decoded?.samples ?? [])).toEqual([0.25, -0.25])
  })

  it('walks past chunks it does not know, including an odd-sized one', () => {
    const decoded = decodeWav(
      wav({
        between: [
          { id: 'LIST', body: new Uint8Array([1, 2, 3]) },
          { id: 'fact', body: new Uint8Array(4) }
        ],
        data: pcm16([16384])
      })
    )
    expect(Array.from(decoded?.samples ?? [])).toEqual([0.5])
  })

  it('accepts WAVE_FORMAT_EXTENSIBLE when the sub-format is PCM', () => {
    const extensible = new Uint8Array(24)
    const view = new DataView(extensible.buffer)
    view.setUint16(0, 22, true) // cbSize
    view.setUint16(2, 16, true) // valid bits
    view.setUint32(4, 4, true) // channel mask
    view.setUint16(8, 1, true) // sub-format GUID starts with the format tag
    const pcm = decodeWav(wav({ formatTag: 0xfffe, fmtExtra: extensible, data: pcm16([16384]) }))
    expect(Array.from(pcm?.samples ?? [])).toEqual([0.5])

    view.setUint16(8, 3, true) // IEEE float
    expect(decodeWav(wav({ formatTag: 0xfffe, fmtExtra: extensible, data: pcm16([16384]) }))).toBeNull()
  })

  it('keeps the sample rate it was given', () => {
    expect(decodeWav(wav({ sampleRate: 48000, data: pcm16([1]) }))?.sampleRate).toBe(48000)
  })

  it('reads what is there when the data size overstates it', () => {
    // A writer that streamed the file may never have gone back to fix the size.
    const decoded = decodeWav(wav({ data: pcm16([16384, 16384]), dataSize: 0xffffffff }))
    expect(Array.from(decoded?.samples ?? [])).toEqual([0.5, 0.5])
  })

  it('returns no samples, not null, for a valid file with no audio', () => {
    const decoded = decodeWav(wav({ data: new Uint8Array(0) }))
    expect(decoded?.samples.length).toBe(0)
    expect(decoded?.sampleRate).toBe(16000)
  })

  it('reads from a view into a larger buffer', () => {
    const file = wav({ data: pcm16([16384]) })
    const larger = new Uint8Array(file.byteLength + 10)
    larger.set(file, 7)
    expect(Array.from(decodeWav(larger.subarray(7, 7 + file.byteLength))?.samples ?? [])).toEqual([
      0.5
    ])
  })

  it('refuses anything that is not 16-bit PCM WAV, rather than guess', () => {
    const data = pcm16([1, 2, 3, 4])
    expect(decodeWav(wav({ formatTag: 3, bitsPerSample: 32, data }))).toBeNull() // float
    expect(decodeWav(wav({ bitsPerSample: 8, data }))).toBeNull()
    expect(decodeWav(wav({ bitsPerSample: 24, data }))).toBeNull()
    expect(decodeWav(wav({ channels: 3, data }))).toBeNull()
    expect(decodeWav(wav({ channels: 0, data }))).toBeNull()
    expect(decodeWav(wav({ sampleRate: 0, data }))).toBeNull()
  })

  it('refuses a file that is not a WAV at all', () => {
    // The first bytes of a WebM recording, the container the recorder falls
    // back to when it could not prepare a WAV.
    expect(decodeWav(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]))).toBeNull()
    expect(decodeWav(new Uint8Array(0))).toBeNull()
    expect(decodeWav(new TextEncoder().encode('RIFF\0\0\0\0AVI LIST'))).toBeNull()
  })

  it('refuses a WAV with no data chunk, or no format chunk', () => {
    const full = wav({ data: pcm16([1]) })
    // Cut before the data chunk.
    expect(decodeWav(full.subarray(0, 12 + 8 + 16))).toBeNull()

    const noFormat = concat([
      new TextEncoder().encode('RIFF'),
      new Uint8Array(4),
      new TextEncoder().encode('WAVE'),
      chunk('data', pcm16([1]))
    ])
    expect(decodeWav(noFormat)).toBeNull()
  })

  it('refuses a format chunk that runs past the end of the file', () => {
    const truncated = concat([
      new TextEncoder().encode('RIFF'),
      new Uint8Array(4),
      new TextEncoder().encode('WAVE'),
      chunk('fmt ', new Uint8Array(16), 400)
    ])
    expect(decodeWav(truncated)).toBeNull()
  })
})
