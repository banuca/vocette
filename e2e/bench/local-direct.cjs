// Decodes WAV files with the on-device model directly (no app), to separate the model's
// own accuracy from anything the app does to the audio.
//   node e2e/bench/local-direct.cjs <greedy_search|modified_beam_search> <file.wav>...
// Files must be 16 kHz mono PCM16 (ffmpeg -ar 16000 -ac 1).
const { join } = require('node:path')
const { readFileSync } = require('node:fs')
const sherpa = require(join(__dirname, '..', '..', 'node_modules', 'sherpa-onnx-node'))

// BENCH_MODEL=fp32 or fp16 uses that export, kept in the bench folder, instead of the app's
// int8 model.
const variant = process.env.BENCH_MODEL
const bundled = !['fp32', 'fp16', 'q8dyn', 'q8nbits', 'q8rr', 'q8u8'].includes(variant)
const modelDir = bundled
  ? join(process.env.LOCALAPPDATA, 'Murmur', 'models', 'parakeet-tdt-0.6b-v3-int8')
  : join(process.env.LOCALAPPDATA, 'vocette-bench', 'models', `parakeet-tdt-0.6b-v3-${variant}`)
const part = (name) => join(modelDir, bundled ? `${name}.int8.onnx` : `${name}.onnx`)
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
        encoder: part('encoder'),
        decoder: part('decoder'),
        joiner: part('joiner')
      },
      tokens: join(modelDir, 'tokens.txt'),
      numThreads: 4, provider: 'cpu', debug: 0, modelType: 'nemo_transducer'
    },
    decodingMethod: method,
    ...(method === 'modified_beam_search' ? { maxActivePaths: 4 } : {})
  })
  for (const f of files) {
    const { rate, s } = readWav(f)
    const startedAt = performance.now()
    const stream = rec.createStream()
    stream.acceptWaveform({ sampleRate: rate, samples: s })
    await rec.decodeAsync(stream)
    const ms = Math.round(performance.now() - startedAt)
    console.log(`${f.split(/[\\/]/).pop()} ${ms}ms ${(s.length / rate).toFixed(1)}s: ${rec.getResult(stream).text.trim()}`)
  }
  console.error(`memory: ${Math.round(process.memoryUsage().rss / 1048576)} MB`)
})()
