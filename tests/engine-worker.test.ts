import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { FromWorker } from '../src/main/engine/protocol'
import {
  DECODE_FAILED,
  ENGINE_UNAVAILABLE,
  MODEL_UNREADABLE,
  NOT_LOADED,
  recognizerConfig,
  startEngineWorker,
  type RecognizerConfig,
  type RecognizerStream,
  type SpeechAddon
} from '../src/main/engine/worker'

/**
 * The utility-process side, with the native addon replaced by a fake. What
 * matters here is what the spike found could go wrong: a configuration that
 * crashes the native code, an exception that ends the process silently, and
 * memory that grows with every take.
 */

interface FakeStream extends RecognizerStream {
  samples: Float32Array | null
  sampleRate: number
}

interface AddonOptions {
  failLoad?: boolean
  /** The text for one decoded piece; may throw, or hold the decode back. */
  decode?: (samples: Float32Array, index: number) => Promise<string> | string
}

function fakeAddon(options: AddonOptions = {}) {
  const configs: RecognizerConfig[] = []
  /** Copies of each piece as it was handed to the recogniser. */
  const pieces: Float32Array[] = []
  let failLoad = options.failLoad ?? false
  const addon: SpeechAddon = {
    OfflineRecognizer: {
      createAsync: async (config) => {
        configs.push(config)
        if (failLoad) {
          throw new Error('Load model from C:\\m\\encoder.int8.onnx failed:Protobuf parsing failed.')
        }
        return {
          createStream: (): FakeStream => {
            const stream: FakeStream = {
              samples: null,
              sampleRate: 0,
              acceptWaveform: (wave) => {
                stream.samples = wave.samples.slice()
                stream.sampleRate = wave.sampleRate
              }
            }
            return stream
          },
          decodeAsync: async (stream) => {
            const samples = (stream as FakeStream).samples ?? new Float32Array(0)
            pieces.push(samples)
            const text = await (options.decode?.(samples, pieces.length - 1) ?? ' Hello there. ')
            return { text }
          }
        }
      }
    }
  }
  return {
    addon,
    configs,
    pieces,
    succeedFromNowOn: () => {
      failLoad = false
    }
  }
}

function harness(options: { addon?: SpeechAddon; addonThrows?: boolean } = {}) {
  const sent: FromWorker[] = []
  let listener: ((message: unknown) => void) | null = null
  const exit = vi.fn<(code: number) => void>()
  const collectGarbage = vi.fn<() => void>()
  let clock = 0
  startEngineWorker(
    {
      post: (message) => sent.push(message),
      listen: (next) => {
        listener = next
      }
    },
    {
      loadAddon: () => {
        if (options.addonThrows || !options.addon) {
          throw new Error('Could not find sherpa-onnx-node. Tried ...')
        }
        return options.addon
      },
      collectGarbage,
      exit,
      now: () => (clock += 100)
    }
  )
  const deliver = (message: unknown): void => listener?.(message)
  /** Lets the worker's job queue run. */
  const settle = async (): Promise<void> => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise<void>((resolve) => setImmediate(resolve))
  }
  return { sent, deliver, settle, exit, collectGarbage }
}

const MODEL_DIR = 'C:\\models\\parakeet-tdt-0.6b-v3-int8'

describe('loading', () => {
  it('uses the one configuration the spike proved, and nothing more', async () => {
    const fake = fakeAddon()
    const worker = harness({ addon: fake.addon })
    worker.deliver({ type: 'load', modelDir: MODEL_DIR, numThreads: 4 })
    await worker.settle()

    // Greedy search with no hotword, modelling-unit or vocabulary option: the
    // combinations that crash the native code cannot be reached from here.
    expect(fake.configs).toEqual([
      {
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          transducer: {
            encoder: join(MODEL_DIR, 'encoder.int8.onnx'),
            decoder: join(MODEL_DIR, 'decoder.int8.onnx'),
            joiner: join(MODEL_DIR, 'joiner.int8.onnx')
          },
          tokens: join(MODEL_DIR, 'tokens.txt'),
          numThreads: 4,
          provider: 'cpu',
          debug: 0,
          modelType: 'nemo_transducer'
        },
        decodingMethod: 'greedy_search'
      }
    ])
    expect(worker.sent).toEqual([{ type: 'loaded', ms: 100 }])
    expect(worker.collectGarbage).toHaveBeenCalled()
  })

  it('keeps the thread count within reason whatever it is sent', () => {
    const threads = (value: number): number => recognizerConfig(MODEL_DIR, value).modelConfig.numThreads
    expect(threads(0)).toBe(1)
    expect(threads(-3)).toBe(1)
    expect(threads(Number.NaN)).toBe(1)
    expect(threads(2.7)).toBe(2)
    expect(threads(64)).toBe(8)
  })

  it('loads once, however often it is asked', async () => {
    const fake = fakeAddon()
    const worker = harness({ addon: fake.addon })
    worker.deliver({ type: 'load', modelDir: MODEL_DIR, numThreads: 2 })
    worker.deliver({ type: 'load', modelDir: MODEL_DIR, numThreads: 2 })
    await worker.settle()
    expect(fake.configs).toHaveLength(1)
    expect(worker.sent).toEqual([
      { type: 'loaded', ms: 100 },
      { type: 'loaded', ms: 0 }
    ])
  })

  it('says the engine cannot start when the native package will not load', async () => {
    const worker = harness({ addonThrows: true })
    worker.deliver({ type: 'load', modelDir: MODEL_DIR, numThreads: 2 })
    await worker.settle()
    expect(worker.sent).toEqual([{ type: 'error', message: ENGINE_UNAVAILABLE }])
    expect(worker.exit).not.toHaveBeenCalled()
  })

  it('turns a model that will not load into a sentence, and survives it', async () => {
    const fake = fakeAddon({ failLoad: true })
    const worker = harness({ addon: fake.addon })
    worker.deliver({ type: 'load', modelDir: MODEL_DIR, numThreads: 2 })
    await worker.settle()
    expect(worker.sent).toEqual([{ type: 'error', message: MODEL_UNREADABLE }])
    // Nothing of the native error's path or wording reaches the user.
    expect(MODEL_UNREADABLE).not.toMatch(/Protobuf|onnx/iu)

    fake.succeedFromNowOn()
    worker.deliver({ type: 'load', modelDir: MODEL_DIR, numThreads: 2 })
    await worker.settle()
    expect(worker.sent.at(-1)).toEqual({ type: 'loaded', ms: 100 })
  })
})

describe('transcribing', () => {
  async function loaded(options: AddonOptions = {}) {
    const fake = fakeAddon(options)
    const worker = harness({ addon: fake.addon })
    worker.deliver({ type: 'load', modelDir: MODEL_DIR, numThreads: 2 })
    await worker.settle()
    worker.sent.length = 0
    worker.collectGarbage.mockClear()
    return { fake, worker }
  }

  it('decodes, trims, zeroes its copy of the audio and collects garbage', async () => {
    const { fake, worker } = await loaded()
    const samples = new Float32Array(16000).fill(0.5)
    worker.deliver({ type: 'transcribe', id: 'take-1', samples, sampleRate: 16000 })
    await worker.settle()

    expect(worker.sent).toEqual([{ type: 'result', id: 'take-1', text: 'Hello there.', ms: 100 }])
    expect(fake.pieces).toHaveLength(1)
    expect(fake.pieces[0]?.every((value) => value === 0.5)).toBe(true)
    expect(samples.every((value) => value === 0)).toBe(true)
    expect(worker.collectGarbage).toHaveBeenCalledTimes(1)
  })

  it('decodes a long take in pieces of at most 30 s, in order, joined by spaces', async () => {
    const { fake, worker } = await loaded({ decode: (_samples, index) => `Piece ${index + 1}.` })
    // 75 s of level sound with a pause at 28 s and another at 56 s.
    const samples = new Float32Array(16000 * 75)
    for (let index = 0; index < samples.length; index += 1) samples[index] = index % 2 ? 0.3 : -0.3
    samples.fill(0, 16000 * 28, 16000 * 28.5)
    samples.fill(0, 16000 * 56, 16000 * 56.5)
    worker.deliver({ type: 'transcribe', id: 'long', samples, sampleRate: 16000 })
    await worker.settle()

    // Each cut sits inside a pause, not in the level sound either side of it.
    expect(fake.pieces.map((piece) => piece.length / 16000)).toEqual([28.25, 28, 18.75])
    expect(fake.pieces.reduce((sum, piece) => sum + piece.length, 0)).toBe(16000 * 75)
    expect(worker.sent).toEqual([
      { type: 'result', id: 'long', text: 'Piece 1. Piece 2. Piece 3.', ms: 100 }
    ])
  })

  it('answers an empty result with empty text, not an error', async () => {
    const { worker } = await loaded({ decode: () => '' })
    worker.deliver({ type: 'transcribe', id: 'quiet', samples: new Float32Array(3200), sampleRate: 16000 })
    await worker.settle()
    expect(worker.sent).toEqual([{ type: 'result', id: 'quiet', text: '', ms: 100 }])
  })

  it('reports a failed decode for that take only, and carries on', async () => {
    let calls = 0
    const { worker } = await loaded({
      decode: () => {
        calls += 1
        if (calls === 1) throw new Error('native decode failure')
        return 'Second time lucky.'
      }
    })
    const first = new Float32Array(1600).fill(0.1)
    worker.deliver({ type: 'transcribe', id: 'a', samples: first, sampleRate: 16000 })
    worker.deliver({ type: 'transcribe', id: 'b', samples: new Float32Array(1600), sampleRate: 16000 })
    await worker.settle()
    expect(worker.sent).toEqual([
      { type: 'error', id: 'a', message: DECODE_FAILED },
      { type: 'result', id: 'b', text: 'Second time lucky.', ms: 100 }
    ])
    // Even a failed take's audio is not left behind.
    expect(first.every((value) => value === 0)).toBe(true)
  })

  it('runs one job at a time, in the order they arrived', async () => {
    const gate = { release: (): void => undefined }
    const held = new Promise<string>((resolve) => {
      gate.release = () => resolve('First.')
    })
    const { fake, worker } = await loaded({
      decode: (_samples, index) => (index === 0 ? held : 'Second.')
    })
    worker.deliver({ type: 'transcribe', id: 'one', samples: new Float32Array(1600), sampleRate: 16000 })
    worker.deliver({ type: 'transcribe', id: 'two', samples: new Float32Array(1600), sampleRate: 16000 })
    await worker.settle()
    // The second has not even reached the recogniser while the first decodes.
    expect(fake.pieces).toHaveLength(1)
    expect(worker.sent).toEqual([])

    gate.release()
    await worker.settle()
    expect(worker.sent.map((message) => message.type === 'result' && message.id)).toEqual(['one', 'two'])
  })

  it('says it is not ready when asked to transcribe before loading', async () => {
    const worker = harness({ addon: fakeAddon().addon })
    worker.deliver({ type: 'transcribe', id: 'early', samples: new Float32Array(10), sampleRate: 16000 })
    await worker.settle()
    expect(worker.sent).toEqual([{ type: 'error', id: 'early', message: NOT_LOADED }])
  })

  it('answers a job it cannot read, and ignores anything else it cannot read', async () => {
    const { worker } = await loaded()
    worker.deliver({ type: 'transcribe', id: 'bad', samples: [0.1, 0.2], sampleRate: 16000 })
    worker.deliver({ type: 'transcribe', id: 'rate', samples: new Float32Array(4), sampleRate: 0 })
    worker.deliver({ type: 'mystery' })
    worker.deliver(null)
    worker.deliver('load')
    await worker.settle()
    expect(worker.sent).toEqual([
      { type: 'error', id: 'bad', message: DECODE_FAILED },
      { type: 'error', id: 'rate', message: DECODE_FAILED }
    ])
  })
})

describe('unloading', () => {
  it('ends the process, the only way the memory comes back', () => {
    const worker = harness({ addon: fakeAddon().addon })
    worker.deliver({ type: 'unload' })
    expect(worker.exit).toHaveBeenCalledWith(0)
  })
})
