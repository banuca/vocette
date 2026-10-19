// Run by engine-smoke.mjs inside the packaged Electron binary
// (ELECTRON_RUN_AS_NODE=1). Loads the shipped sherpa-onnx addon, decodes each
// WAV and prints one JSON line. The recogniser settings mirror
// recognizerConfig() in src/main/engine/worker.ts.
//   <exe> engine-smoke-child.cjs <resources> <model dir> <file.wav>...
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: it runs as plain Node inside the packaged binary. */
const { join, basename } = require("node:path");
const { readFileSync } = require("node:fs");
const os = require("node:os");

const [resources, modelDir, ...files] = process.argv.slice(2);
const sherpa = require(
  join(resources, "app.asar.unpacked", "node_modules", "sherpa-onnx-node"),
);

function readWav(path) {
  const b = readFileSync(path);
  let p = 12;
  let rate = 16000;
  let data = null;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4);
    const len = b.readUInt32LE(p + 4);
    if (id === "fmt ") rate = b.readUInt32LE(p + 12);
    if (id === "data") {
      data = b.subarray(p + 8, p + 8 + len);
      break;
    }
    p += 8 + len + (len & 1);
  }
  const samples = new Float32Array(data.length / 2);
  for (let i = 0; i < samples.length; i++)
    samples[i] = data.readInt16LE(i * 2) / 32768;
  return { rate, samples };
}

(async () => {
  const startedAt = performance.now();
  const recogniser = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(modelDir, "encoder.int8.onnx"),
        decoder: join(modelDir, "decoder.int8.onnx"),
        joiner: join(modelDir, "joiner.int8.onnx"),
      },
      tokens: join(modelDir, "tokens.txt"),
      numThreads: Math.min(4, Math.max(1, os.availableParallelism() - 1)),
      provider: "cpu",
      debug: 0,
      modelType: "nemo_transducer",
    },
    decodingMethod: "greedy_search",
  });
  const loadMs = Math.round(performance.now() - startedAt);
  const decoded = [];
  for (const file of files) {
    const { rate, samples } = readWav(file);
    const began = performance.now();
    const stream = recogniser.createStream();
    stream.acceptWaveform({ sampleRate: rate, samples });
    await recogniser.decodeAsync(stream);
    decoded.push({
      name: basename(file),
      ms: Math.round(performance.now() - began),
      text: recogniser.getResult(stream).text.trim(),
    });
  }
  console.log(JSON.stringify({ loadMs, decoded }));
})().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
