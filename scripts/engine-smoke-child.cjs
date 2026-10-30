// Run by engine-smoke.mjs inside the packaged Electron binary
// (ELECTRON_RUN_AS_NODE=1). Loads the shipped sherpa-onnx addon, decodes each
// WAV and prints one JSON line. The recogniser settings mirror
// recognizerConfig() in src/main/engine/worker.ts.
//   <exe> engine-smoke-child.cjs <resources> <model dir> <file.wav>...
// VOCETTE_SMOKE_STAGE_TO: copy the model there first and load it from there.
// Run inside the Store package, that is how the app's own download lands in
// the package's private copy of AppData (scripts/store-smoke.ps1).
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: it runs as plain Node inside the packaged binary. */
const { join, basename } = require('node:path')
const { copyFileSync, mkdirSync, readFileSync } = require('node:fs')
const os = require('node:os')

const [resources, sourceModelDir, ...files] = process.argv.slice(2)
const sherpa = require(join(resources, 'app.asar.unpacked', 'node_modules', 'sherpa-onnx-node'))
const MODEL_FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']

/** The model folder to load: the source, or a copy made where the app would keep it. */
function modelFolder() {
  const stage = process.env.VOCETTE_SMOKE_STAGE_TO
  if (!stage) return { dir: sourceModelDir, stagedMs: null }
  const startedAt = performance.now()
  mkdirSync(stage, { recursive: true })
  for (const name of MODEL_FILES) copyFileSync(join(sourceModelDir, name), join(stage, name))
  return { dir: stage, stagedMs: Math.round(performance.now() - startedAt) }
}

/**
 * The MSIX package this process runs as, or null: proof that a run through
 * the Store package's alias really had the package's identity.
 */
function packageFullName() {
  if (process.platform !== 'win32') return null
  try {
    const koffi = require(join(resources, 'app.asar.unpacked', 'node_modules', 'koffi'))
    const GetCurrentPackageFullName = koffi
      .load('kernel32.dll')
      .func('int32 __stdcall GetCurrentPackageFullName(_Inout_ uint32 *length, void *name)')
    const length = [256]
    const name = Buffer.alloc(length[0] * 2)
    // 0 is ERROR_SUCCESS; 15700, APPMODEL_ERROR_NO_PACKAGE, means unpackaged.
    if (GetCurrentPackageFullName(length, name) !== 0) return null
    return name.toString('utf16le', 0, Math.max(0, length[0] - 1) * 2)
  } catch {
    return null
  }
}

function readWav(path) {
  const b = readFileSync(path)
  let p = 12
  let rate = 16000
  let data = null
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4)
    const len = b.readUInt32LE(p + 4)
    if (id === 'fmt ') rate = b.readUInt32LE(p + 12)
    if (id === 'data') {
      data = b.subarray(p + 8, p + 8 + len)
      break
    }
    p += 8 + len + (len & 1)
  }
  const samples = new Float32Array(data.length / 2)
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 32768
  return { rate, samples }
}

;(async () => {
  const { dir: modelDir, stagedMs } = modelFolder()
  const startedAt = performance.now()
  const recogniser = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(modelDir, 'encoder.int8.onnx'),
        decoder: join(modelDir, 'decoder.int8.onnx'),
        joiner: join(modelDir, 'joiner.int8.onnx')
      },
      tokens: join(modelDir, 'tokens.txt'),
      numThreads: Math.min(4, Math.max(1, os.availableParallelism() - 1)),
      provider: 'cpu',
      debug: 0,
      modelType: 'nemo_transducer'
    },
    decodingMethod: 'greedy_search'
  })
  const loadMs = Math.round(performance.now() - startedAt)
  const decoded = []
  for (const file of files) {
    const { rate, samples } = readWav(file)
    const began = performance.now()
    const stream = recogniser.createStream()
    stream.acceptWaveform({ sampleRate: rate, samples })
    await recogniser.decodeAsync(stream)
    decoded.push({
      name: basename(file),
      ms: Math.round(performance.now() - began),
      text: recogniser.getResult(stream).text.trim()
    })
  }
  console.log(
    JSON.stringify({
      loadMs,
      cpu: os.cpus()[0]?.model,
      threads: os.availableParallelism(),
      package: packageFullName(),
      modelDir,
      stagedMs,
      decoded
    })
  )
})().catch((error) => {
  console.error(error?.stack ?? String(error))
  process.exit(1)
})
