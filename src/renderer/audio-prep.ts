/**
 * Audio preparation for transcription.
 *
 * The recorder captures Opus in a WebM container. Before upload we decode,
 * downsample to 16 kHz mono, trim leading/trailing silence (the user pays per
 * audio second), and encode as PCM16 WAV — the format whisper-family models
 * transcribe best. A take with no speech in it at all is reported as such, so
 * the main process can drop it instead of transcribing silence. Any failure
 * falls back to sending the original blob, so a codec quirk can never break
 * dictation.
 *
 * `findSpeechBounds`, `encodeWavPcm16` and `prepareSamples` are pure so they
 * are unit-testable in the Node test environment; only
 * `prepareForTranscription` touches the Web Audio APIs.
 */

const TARGET_SAMPLE_RATE = 16000

export interface PreparedAudio {
  buffer: ArrayBuffer
  mimeType: string
  /**
   * Whether any part of the take reached speech level. False means the take
   * is silence throughout and is not worth transcribing. A take that could
   * not be decoded reports true: nothing is known about it, so it is still
   * sent, as it always was.
   */
  speechDetected: boolean
}

/** Root-mean-square level of a window of samples (DC removed). */
export function windowRms(samples: Float32Array, start: number, length: number): number {
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
 * First and last sample index (exclusive end) containing speech, or null when
 * the buffer is silent. A window counts as speech when its level reaches a
 * fraction of the take's peak or an absolute floor, whichever is higher — so
 * a quiet dictation is not trimmed away and a noisy room is not kept.
 */
export function findSpeechBounds(
  samples: Float32Array,
  sampleRate: number,
  windowMs = 30,
  thresholdRatio = 0.04,
  minLevel = 0.0015
): [number, number] | null {
  const windowSize = Math.max(1, Math.round((sampleRate * windowMs) / 1000))
  const levels: number[] = []
  for (let start = 0; start < samples.length; start += windowSize) {
    levels.push(windowRms(samples, start, windowSize))
  }
  if (!levels.length) return null

  let peak = 0
  for (const level of levels) peak = Math.max(peak, level)
  const threshold = Math.max(peak * thresholdRatio, minLevel)

  let first = -1
  let last = -1
  for (let index = 0; index < levels.length; index += 1) {
    if ((levels[index] ?? 0) >= threshold) {
      if (first < 0) first = index
      last = index
    }
  }
  if (first < 0) return null

  // Keep one window of air before the first word and two after the last, so
  // the transcription start is never clipped.
  const start = Math.max(0, (first - 1) * windowSize)
  const end = Math.min(samples.length, (last + 2) * windowSize)
  return start >= end ? null : [start, end]
}

/** Encodes mono float samples as a 16-bit PCM WAV file. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const byteCount = samples.length * 2
  const buffer = new ArrayBuffer(44 + byteCount)
  const view = new DataView(buffer)
  const writeAscii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + byteCount, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(36, 'data')
  view.setUint32(40, byteCount, true)

  let offset = 44
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
    view.setInt16(offset, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true)
    offset += 2
  }
  return buffer
}

/**
 * The pure half of `prepareForTranscription`: trims silence from decoded mono
 * samples, encodes what is left as WAV, and says whether any speech was found
 * at all. The one measurement serves both, so the take that is trimmed and the
 * take that is judged silent can never disagree.
 */
export function prepareSamples(samples: Float32Array, sampleRate: number): PreparedAudio {
  const bounds = findSpeechBounds(samples, sampleRate)
  const trimmed = bounds ? samples.subarray(bounds[0], bounds[1]) : samples
  return {
    buffer: encodeWavPcm16(trimmed, sampleRate),
    mimeType: 'audio/wav',
    speechDetected: bounds !== null
  }
}

/**
 * Decodes the recorded blob, trims silence, and returns a 16 kHz WAV ready
 * for the transcription API. Falls back to the original blob on any error.
 */
export async function prepareForTranscription(
  blob: Blob,
  mimeType: string
): Promise<PreparedAudio> {
  try {
    const inputBuffer = await blob.arrayBuffer()
    // OfflineAudioContext is not subject to the autoplay policy that would
    // suspend a live AudioContext in a hidden, never-focused window.
    const decodeContext = new OfflineAudioContext(1, 1, 48000)
    const decoded = await decodeContext.decodeAudioData(inputBuffer.slice(0))

    const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE))
    const renderContext = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE)
    const source = renderContext.createBufferSource()
    source.buffer = decoded
    source.connect(renderContext.destination)
    source.start(0)
    const rendered = await renderContext.startRendering()

    return prepareSamples(rendered.getChannelData(0), TARGET_SAMPLE_RATE)
  } catch {
    // Never let audio processing break dictation: the API accepts WebM too.
    // A take that could not be read is not known to be silent, so it counts
    // as speech and is sent exactly as it was before silence was checked.
    return { buffer: await blob.arrayBuffer(), mimeType, speechDetected: true }
  }
}
