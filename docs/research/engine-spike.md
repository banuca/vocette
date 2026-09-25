# On-device engine spike — Parakeet TDT 0.6B v3 via sherpa-onnx-node (25 Sep 2026)

Feasibility spike run in a scratch folder, outside the repo. Working notes and raw data
lived in the session scratchpad (`engine-spike/NOTES.md`, `results/`); this file keeps the
findings.

**Machine:** Intel Core Ultra 7 265U (2 P + 8 E + 2 LP-E cores, 15 W class), 16 GB RAM
(~3 GB free), Windows 11 26100, AC power, Balanced; CPU 30–80 % busy with Teams, Defender,
VS Code and Chrome throughout, so timings are ranges. Node 24.19.0; Electron 43.3.0 (Node
24.18.1, N-API 10); sherpa-onnx 1.13.8 (git 11afbd00); onnxruntime 1.28.2 (bundled).

## Verdict: feasible

Loads and transcribes correctly in plain Node, the Electron main process, and
`utilityProcess.fork()` (audio over `process.parentPort` or a MessagePort), including from a
real `app.asar` with only `node_modules/sherpa-onnx-win-x64/**` unpacked. No flags, PATH
changes or rebuilds. A 4–7 s dictation decodes in ~0.4–1.1 s. Punctuated and capitalised
output in all four languages tested. Silence and low noise → empty string.

## Risks (and what the product does about them)

1. **Native failures kill the process with no JS exception** — sync constructor on a
   truncated/empty encoder (0xC0000409 in Node, 0xE06D7363 in a utility process), an invalid
   `decodingMethod` (`exit(-1)`, seen as 4294967295), greedy search + bpe config + hotwords
   (0xC0000005). → Engine runs in a utility process; `createAsync` only (a corrupt model is
   then a clean rejection: "Protobuf parsing failed." / "ModelProto does not have a graph.",
   worker survives); SHA-256 checked before first load; config is a constant.
2. **Memory** — ~765 MB RSS after load, 0.8–1.0 GB after typical dictations, never returned;
   +~7 MB per audio second for a whole-file decode (983 MB at 32 s, 1,706 MB at 130 s); a
   second recognizer costs another 651 MB. → Lazy load (spawn 0.9 s + load 2.1–2.7 s), idle
   unload by killing the process, split recordings longer than ~30 s.
3. **Electron-only breakages** — `readWave`, `readWaveFromBinary`, `vad.front` need
   `enableExternalBuffer = false` or throw "External buffers are not allowed";
   `readWaveFromBinary` is only at `sherpa-onnx-node/addon.js`. → Murmur parses its own WAV
   in JS and passes an ordinary `Float32Array`.
4. **Hotwords are partial** — fix names, never add the hyphen to "ITU-T", case-sensitive, need
   beam search + a generated `bpe.vocab`. → v1 uses greedy search and a post-recognition
   correction pass (brief 08) instead.
5. **Threads** — 4 threads fastest in 4 of 5 batches; 8 was 2–4× slower. → Default 4,
   bounded by the machine; never `os.cpus().length`.
6. **An in-flight decode cannot be cancelled** — discard the result or kill the worker.
7. Not tested: macOS, Linux.

## Working configuration

```js
const recognizer = await sherpa.OfflineRecognizer.createAsync({
  featConfig: { sampleRate: 16000, featureDim: 80 },   // featureDim is overridden to 128 by model metadata
  modelConfig: {
    transducer: { encoder: '<dir>/encoder.int8.onnx', decoder: '<dir>/decoder.int8.onnx', joiner: '<dir>/joiner.int8.onnx' },
    tokens: '<dir>/tokens.txt',
    numThreads: 4, provider: 'cpu', debug: 0, modelType: 'nemo_transducer'
  },
  decodingMethod: 'greedy_search'
})
const stream = recognizer.createStream()
stream.acceptWaveform({ sampleRate, samples })          // any rate; resampled internally
const { text } = await recognizer.decodeAsync(stream)   // keep `stream` referenced until settled
```

Result object: `{ text, tokens[], timestamps[], durations[], ys_log_probs[], lang: '' (always
empty), emotion, event, words: [] (always empty) }` — the detected language is not exposed.

Utility-process notes: nothing special needed; the worker script may live inside
`app.asar`; `gc` is obtained with `require('v8').setFlagsFromString('--expose-gc'); const gc
= require('vm').runInNewContext('gc')` (`execArgv: ['--expose-gc']` does not define it). In
this development shell `ELECTRON_RUN_AS_NODE=1` is inherited from VS Code and must be unset
before launching Electron.

## Model files

Hugging Face `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`, commit
`2bda32ec70b097a55adaa07d9a7173915b43cc78` (pin the commit in URLs, not `main`). All verified
locally with `sha256sum -c`.

| File | Bytes | SHA-256 |
|---|---|---|
| encoder.int8.onnx | 652,184,281 | acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247 |
| decoder.int8.onnx | 11,845,275 | 179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e |
| joiner.int8.onnx | 6,355,277 | 3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3 |
| tokens.txt | 93,939 | d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d |
| **Total** | **670,478,772** (639 MiB) | |

Alternative single archive (not used; needs bz2 extraction): GitHub release `asr-models`,
`sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`, 487,170,055 B, SHA-256
`5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf`.

Download took 24 s on this network. `curl` needed `--ssl-no-revoke` (corporate TLS
inspection breaks revocation checks: `CRYPT_E_NO_REVOCATION_CHECK`); Electron `net` untested
at spike time.

**Licence: CC-BY-4.0**, from the upstream `nvidia/parakeet-tdt-0.6b-v3` card ("ready for
commercial/non-commercial use"); attribution to NVIDIA required. The sherpa HF repo carries
no licence file. 25 languages: bg hr cs da nl en et fi fr de el hu it lv lt mt pl pt ro sk sl
es sv ru uk, detected automatically.

Silero VAD (optional, MIT): `silero_vad.onnx` 643,854 B
`9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6`; `silero_vad.int8.onnx`
212,860 B `c36d490aff5ab924ca6c7aeec4d8f6bd3d22db6fa17611b9c5b17eae58ac3a20`.

## Measurements

Load (fresh process each, warm OS cache): 2.2–2.9 s regardless of threads; `createAsync`
2.1–2.6 s. RSS 56 MB → 73 after require → ~765 after load → ~1.2 GB peak over 44 decodes
including four 32 s files; ~815 MB peak for a single short clip.

Decode, three interleaved rounds (typical ms, RTF, best):

| Config | a (4.26 s) | c (7.25 s) | d (32.0 s) |
|---|---|---|---|
| 1 thread greedy | 697 (0.163), 580 | 1,391 (0.192), 991 | 6,115 (0.191), 5,497 |
| 2 threads greedy | 651 (0.153), 521 | 1,055 (0.145), 700 | 5,035 (0.157), 3,879 |
| 4 threads greedy | 441 (0.103), 360 | 818 (0.113), 693 | 3,487 (0.109), 2,940 |
| 2 threads beam | 641 (0.150) | 822 (0.113) | 5,385 (0.168) |
| 2 threads beam + hotwords | 630 (0.148) | 1,130 (0.156) | 5,317 (0.166) |

Event loop: `decode()` and `new OfflineRecognizer()` block it fully (2.6–3.0 s);
`decodeAsync()` and `createAsync()` do not (max gap 21–24 ms). Four overlapping
`decodeAsync` calls on one recognizer: no crash, results identical to sequential.

Electron: main process `createAsync` 2,307 ms, decode of (a) 630–749 ms; utility process
cold spawn 929 ms, `createAsync` 2,119–2,635 ms, decode of (a) 609–755 ms; IPC 1–2 ms;
working set ~814 MB.

Repeated use: 150 decodes → RSS 861 → 901 MB without GC, flat at 864 MB with `gc()` — no
native leak; streams are freed when V8 collects them.

## Transcripts (greedy; test speech is SAPI TTS except the de/fr/es/en clips)

| Spoken | Output |
|---|---|
| "Please send the ITU-T draft to Kirinde before Friday." | `Please send the ITUT draft to Kirinda before Friday.` |
| "The coffee machine on the third floor is broken again." | `The coffee machine on the third floor is broken again.` |
| "Um, so I think we should, uh, move the meeting to Tuesday, no sorry, Wednesday." | `Um, so I think we should uh move the meeting to Tuesday. No sorry, Wednesday.` |
| 2 s digital silence / −50 dBFS noise | `` (empty) |
| same as first, at 48 kHz | `Please send the ITUT draft to Kiranda before Friday.` |
| de / fr / es / en real speech | `Alles hat ein Ende, nur die Wurst hat zwei.` / `Ne vous demandez pas ce que votre pays peut faire pour vous. Demandez-vous plutôt ce que vous pouvez faire pour lui.` / `No preguntes que puede hacer tu país por ti, pregunta qué puedes hacer tú por tu país.` / `Ask not what your country can do for you, ask what you can do for your country.` |

Numbers come out as digits; fillers and spoken self-corrections are kept verbatim;
spelling can vary with context ("harbor" whole-file, "harbour" as a VAD segment).

## Hotwords

Supported for NeMo TDT in 1.13.8 with `modified_beam_search`, `modelingUnit: 'bpe'` and a
`bpe.vocab` generated from `tokens.txt` (`<token>\t-1.0` per line); per stream via
`createStream('ITU-T/Kirinde')` or a `hotwordsFile`. Greedy → "Kirinda"; beam without
hotwords → "Kyranda"; beam + hotwords at any score 1–12 → "Kirinde", but "ITUT" never gains
its hyphen. Lower-case hotwords have no effect. No false insertions in the coffee or
paragraph files up to score 12. Failure modes: greedy + bpe + hotwords crashes (0xC0000005);
greedy without bpe silently ignores them; beam with the default `cjkchar` unit silently
ignores them; `setConfig()` does not rebuild the decoder, so switching greedy/beam needs a
new recognizer (another 651 MB). Beam also re-punctuated the disfluent sample worse ("we
should. Uh, move the meeting…"). Decision for v1: greedy + post-recognition correction.

## Packaging

`node_modules/sherpa-onnx-node/` is the JS wrapper (~60 KB, may stay in the asar);
`node_modules/sherpa-onnx-win-x64/` holds the native files (~23.5 MB) and **must be
unpacked**: `sherpa-onnx.node` (681,984 B, loaded), `sherpa-onnx-c-api.dll` (4,605,952 B,
loaded), `onnxruntime.dll` (17,799,168 B, loaded), plus `sherpa-onnx-cxx-api.dll` and
`onnxruntime_providers_shared.dll` (not loaded; ship anyway). With nothing unpacked loading
fails with "Could not find sherpa-onnx-node. Tried …" (the loader hides the real error).
Windows ships its own `System32\onnxruntime.dll` (Windows ML); every process loaded the
package's copy, never System32's. Keep `npmRebuild: false`; pin 1.13.8 with the lockfile and
an `overrides` entry.

## VAD for long audio

Silero config that worked: `{ sileroVad: { model, threshold: 0.3, minSilenceDuration: 0.5,
minSpeechDuration: 0.25, maxSpeechDuration: 20, windowSize: 512 }, sampleRate: 16000,
numThreads: 1 }`, read with `front(false)`. 261 s file → 32 segments of 5–10 s, peak RSS
938 MB, no words lost. Threshold 0.5 clipped an onset ("We spent"); 0.3 did not.

## Not verified at spike time

macOS and Linux; electron-builder output (an equivalent asar build was tested); the
electron-vite worker entry; cold-cache load and the first Defender scan of the model;
whole-file decode of 261 s; the tar.bz2; a downloader using Electron `net` behind the
corporate proxy; real microphone and accented speech; TEN-VAD.
