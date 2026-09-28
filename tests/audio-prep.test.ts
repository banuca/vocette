import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  encodeWavPcm16,
  findSpeechBounds,
  prepareForTranscription,
  prepareSamples,
  windowRms
} from '../src/renderer/audio-prep'

function tone(frequency: number, sampleRate: number, length: number, amplitude = 0.5): Float32Array {
  const samples = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate)
  }
  return samples
}

describe('findSpeechBounds', () => {
  const RATE = 16000

  it('returns null for silence', () => {
    expect(findSpeechBounds(new Float32Array(RATE), RATE)).toBeNull()
  })

  it('returns null for a near-silent buffer', () => {
    const samples = new Float32Array(RATE)
    for (let index = 0; index < RATE; index += 1) {
      samples[index] = (Math.random() - 0.5) * 0.0002
    }
    expect(findSpeechBounds(samples, RATE)).toBeNull()
  })

  it('finds a tone surrounded by silence with padding', () => {
    const silenceBefore = RATE // 1 s
    const speechLength = RATE // 1 s
    const silenceAfter = RATE * 2 // 2 s
    const samples = new Float32Array(silenceBefore + speechLength + silenceAfter)
    samples.set(tone(440, RATE, speechLength, 0.4), silenceBefore)

    const bounds = findSpeechBounds(samples, RATE)
    expect(bounds).not.toBeNull()
    const [start, end] = bounds as [number, number]
    // One window of padding before the tone, two after.
    expect(start).toBeLessThanOrEqual(silenceBefore)
    expect(start).toBeGreaterThan(silenceBefore - RATE / 10)
    expect(end).toBeGreaterThanOrEqual(silenceBefore + speechLength)
    expect(end).toBeLessThanOrEqual(silenceBefore + speechLength + RATE / 5)
  })

  it('keeps quiet speech when the absolute floor is hit', () => {
    // A quiet take: amplitude 0.01 with no noise. 4% of peak would be 0.0004,
    // below the 0.0015 floor, so the floor must keep it classified as speech.
    const samples = tone(220, RATE, RATE, 0.01)
    expect(findSpeechBounds(samples, RATE)).not.toBeNull()
  })

  it('trims the ends of a fully-voiced buffer', () => {
    const samples = tone(440, RATE, RATE, 0.5)
    const bounds = findSpeechBounds(samples, RATE)
    expect(bounds).not.toBeNull()
    const [start, end] = bounds as [number, number]
    expect(start).toBe(0)
    expect(end).toBeLessThanOrEqual(RATE)
    expect(end).toBeGreaterThan(RATE / 2)
  })
})

describe('prepareSamples: whether a take held any speech', () => {
  const RATE = 16000

  it('reports a silent buffer as holding no speech', () => {
    const prepared = prepareSamples(new Float32Array(RATE), RATE)
    expect(prepared.speechDetected).toBe(false)
  })

  it('reports a quiet sine at 0.01 as speech, because a whisper must still be sent', () => {
    const prepared = prepareSamples(tone(220, RATE, RATE, 0.01), RATE)
    expect(prepared.speechDetected).toBe(true)
    expect(prepared.mimeType).toBe('audio/wav')
  })

  it('still trims the silence around a take that held speech', () => {
    // One second of silence either side of a one-second tone.
    const samples = new Float32Array(RATE * 3)
    samples.set(tone(440, RATE, RATE, 0.4), RATE)
    const bounds = findSpeechBounds(samples, RATE) as [number, number]

    const prepared = prepareSamples(samples, RATE)
    expect(prepared.speechDetected).toBe(true)
    expect(prepared.buffer.byteLength).toBe(44 + (bounds[1] - bounds[0]) * 2)
  })
})

describe('prepareForTranscription', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends a take it cannot decode as it is, and never calls it silent', async () => {
    // A codec quirk: the recording exists, but Web Audio cannot read it.
    vi.stubGlobal(
      'OfflineAudioContext',
      class {
        decodeAudioData(): Promise<AudioBuffer> {
          return Promise.reject(new Error('Unable to decode audio data'))
        }
      }
    )
    const recording = new Uint8Array([26, 69, 223, 163])

    const prepared = await prepareForTranscription(
      new Blob([recording], { type: 'audio/webm' }),
      'audio/webm'
    )

    expect(prepared.speechDetected).toBe(true)
    expect(prepared.mimeType).toBe('audio/webm')
    expect([...new Uint8Array(prepared.buffer)]).toEqual([...recording])
  })
})

describe('windowRms', () => {
  it('computes the RMS of a sine wave as amplitude / sqrt(2)', () => {
    const samples = tone(1000, 16000, 1600, 0.5)
    const rms = windowRms(samples, 0, samples.length)
    expect(rms).toBeCloseTo(0.5 / Math.sqrt(2), 2)
  })

  it('is zero for silence', () => {
    expect(windowRms(new Float32Array(800), 0, 800)).toBe(0)
  })
})

describe('encodeWavPcm16', () => {
  it('writes a valid 16 kHz mono PCM header and samples', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1])
    const buffer = encodeWavPcm16(samples, 16000)
    const view = new DataView(buffer)

    expect(buffer.byteLength).toBe(44 + samples.length * 2)
    const ascii = (offset: number, length: number): string => {
      let text = ''
      for (let index = 0; index < length; index += 1) {
        text += String.fromCharCode(view.getUint8(offset + index))
      }
      return text
    }
    expect(ascii(0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2)
    expect(ascii(8, 4)).toBe('WAVE')
    expect(ascii(12, 4)).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
    expect(ascii(36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(samples.length * 2)

    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBe(Math.round(0.5 * 0x7fff))
    expect(view.getInt16(48, true)).toBe(Math.round(-0.5 * 0x8000))
    expect(view.getInt16(50, true)).toBe(0x7fff)
    expect(view.getInt16(52, true)).toBe(-0x8000)
  })
})
