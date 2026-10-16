// Decodes WAV files with the on-device model directly (no app), to separate the model's
// own accuracy from anything the app does to the audio.
//   node e2e/bench/local-direct.cjs <greedy_search|modified_beam_search> <file.wav>...
// Files must be 16 kHz mono PCM16 (ffmpeg -ar 16000 -ac 1).
const { join } = require('node:path')
const { readFileSync } = require('node:fs')
const sherpa = require(join(__dirname, '..', '..', 'node_modules', 'sherpa-onnx-node'))

const modelDir = join(process.env.LOCALAPPDATA, 'Murmur', 'models', 'parakeet-tdt-0.6b-v3-int8')
const [method, ...files] = process.argv.slice(2)

function readWav(path) {
  const b = readFileSync(path)
  let p = 12, rate = 16000, data = null
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), len = b.readUInt32LE(p + 4)
    if (id === 'fmt ') rate = b.readUInt32LE(p + 12)
    if (id === 'data') { data = b.subarray(p + 8, p + 8 + len); break }
    p += 8 + len + (len & 1)
  }
  const s = new Float32Array(data.length / 2)
  for (let i = 0; i < s.length; i++) s[i] = data.readInt16LE(i * 2) / 32768
  return { rate, s }
}

;(async () => {
  const rec = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(modelDir, 'encoder.int8.onnx'),
        decoder: join(modelDir, 'decoder.int8.onnx'),
        joiner: join(modelDir, 'joiner.int8.onnx')
      },
      tokens: join(modelDir, 'tokens.txt'),
      numThreads: 4, provider: 'cpu', debug: 0, modelType: 'nemo_transducer'
    },
    decodingMethod: method,
    ...(method === 'modified_beam_search' ? { maxActivePaths: 4 } : {})
  })
  for (const f of files) {
    const { rate, s } = readWav(f)
    const stream = rec.createStream()
    stream.acceptWaveform({ sampleRate: rate, samples: s })
    await rec.decodeAsync(stream)
    console.log(`${f.split(/[\\/]/).pop()}: ${rec.getResult(stream).text.trim()}`)
  }
})()
