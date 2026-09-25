# Brief 07a — On-device transcription engine: runtime

Queue item 7a of `docs/launch-plan.md`. Free. One commit. UI is 07b (separate commit).

Evidence: `docs/research/engine-spike.md` (read it first — it has the working config
snippet). Key facts from it:

- `sherpa-onnx-node@1.13.8` (N-API) + `sherpa-onnx-win-x64@1.13.8` works on this machine.
  Native files live in `node_modules/sherpa-onnx-win-x64/`: `sherpa-onnx.node`,
  `sherpa-onnx-c-api.dll`, `sherpa-onnx-cxx-api.dll`, `onnxruntime.dll`,
  `onnxruntime_providers_shared.dll`. The wrapper requires the sibling package by relative
  path.
- Model: Parakeet TDT 0.6B v3 int8 (CC-BY-4.0, NVIDIA; 25 European languages, automatic
  language detection, punctuation and capitalisation built in). Files and pinned hashes
  below. Total 670,478,772 bytes.
- `OfflineRecognizer.createAsync(config)` loads in ~2.5 s without blocking;
  `decodeAsync(stream)` decodes without blocking. Keep the JS `stream` and `recognizer`
  referenced until the promise settles (the native worker holds raw pointers).
- `numThreads: 2` was fastest on this laptop (RTF ≈ 0.09–0.10); memory ≈ 765 MB RSS after
  load, ≈ 1.2 GB peak while decoding, not returned until the process exits — which is why
  the engine lives in its own utility process that is **killed** when idle.
- Proven under Electron 43: the addon loads in the main process **and** in
  `utilityProcess.fork()` with no flags or PATH changes (cold spawn ≈ 0.9 s, load ≈ 2.1–2.6 s,
  4 s clip ≈ 0.6–0.75 s, IPC 1–2 ms). A packaged simulation with only
  `node_modules/sherpa-onnx-win-x64/**` unpacked worked, with the worker script inside
  `app.asar`.
- **Traps the spike hit, all mandatory to avoid:**
  - `readWave` / `readWaveFromBinary` throw "External buffers are not allowed" inside
    Electron (V8 memory cage). Parse the WAV in JS and pass an ordinary `Float32Array`.
  - The **synchronous** `new OfflineRecognizer()` kills the whole process on a truncated or
    corrupt model file (native abort, no JS error). `createAsync` rejects cleanly and the
    worker survives. Use `createAsync` only.
  - `greedy_search` combined with `modelingUnit: 'bpe'` + hotwords is a native access
    violation. Use `greedy_search` and set **no** hotword/bpe options at all. (Hotwords do
    work with `modified_beam_search`, but beam search changed punctuation for the worse and
    misheard "Kirinde" differently without them; vocabulary is handled after recognition
    by brief 08 instead.)
  - Memory grows ≈ 7 MB per second of audio decoded in one piece (130 s → 1.7 GB peak), so
    long takes must be split (≤ 30 s pieces kept a 261 s take at ≈ 940 MB).
  - Native streams are freed only when V8 collects them; RSS creeps without GC. In the
    worker, `v8.setFlagsFromString('--expose-gc')` then `vm.runInNewContext('gc')` yields a
    working `gc` (plain `--expose-gc` in `execArgv` does not) — call it after each job.
  - An invalid `decodingMethod` exits the process with code −1 without a JS error: keep the
    config a constant.

## What the user sees (after 07b wires the UI)

Nothing in this commit on its own except: with `engine: 'local'` and the model files
present, dictation transcribes on the PC with no network call.

## Design

### Dependencies and build

- `package.json`: add `"sherpa-onnx-node": "1.13.8"` (exact) to `dependencies`, and an
  `overrides` block pinning every `sherpa-onnx-*` platform package to `1.13.8` so the
  wrapper and native addon can never drift apart. Run `npm install`; commit the lockfile.
- `electron.vite.config.ts`: add a second main-process entry
  `'engine-worker': resolve(__dirname, 'src/main/engine/worker.ts')` so it builds to
  `out/main/engine-worker.js`. The addon stays external (it is a dependency; confirm
  `externalizeDepsPlugin` leaves `require('sherpa-onnx-node')` in the output).
- `electron-builder.yml`: `asarUnpack` adds `'**/node_modules/sherpa-onnx-*/**'` (covers
  the platform packages holding the `.node` and DLLs; the spike proved the native package
  is what must be unpacked — native loading from disk, like koffi/uiohook).
- `scripts/check-native-packaging.mjs`: also require, on Windows x64,
  `app.asar.unpacked/node_modules/sherpa-onnx-win-x64/sherpa-onnx.node` and
  `onnxruntime.dll` (and the macOS/Linux equivalents only if trivially knowable — otherwise
  Windows only, with a comment).

### Model manifest — `src/main/engine/models.ts`

```ts
export interface ModelFile { name: string; url: string; bytes: number; sha256: string }
export interface ModelManifest {
  id: 'parakeet-tdt-0.6b-v3-int8'; displayName: string; languages: readonly string[]
  licence: string; attribution: string; files: readonly ModelFile[]; totalBytes: number
}
```

Base URL pinned to the commit, never `main`:
`https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/2bda32ec70b097a55adaa07d9a7173915b43cc78/`

| file | bytes | sha256 |
|---|---|---|
| encoder.int8.onnx | 652184281 | acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247 |
| decoder.int8.onnx | 11845275 | 179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e |
| joiner.int8.onnx | 6355277 | 3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3 |
| tokens.txt | 93939 | d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d |

Languages: bg hr cs da nl en et fi fr de el hu it lv lt mt pl pt ro sk sl es sv ru uk.
Attribution line: "Speech model: NVIDIA Parakeet TDT 0.6B v3, CC-BY-4.0; ONNX export by
the sherpa-onnx project (k2-fsa)."

### Model store — `src/main/engine/model-store.ts`

- Folder: `MURMUR_MODELS_DIR` if set; else on Windows `%LOCALAPPDATA%\Murmur\models`
  (the model must not sit in the *roaming* profile, which corporate machines sync at every
  sign-in); else `app.getPath('userData')/models`. One subfolder per model id.
- `ModelStore` with injectable `fetch` (production: Electron `net.fetch`, which uses the
  system proxy and certificate store) and fs, so it is unit-testable:
  - `state(id)`: `'installed'` when every file exists with the manifest size **and** a
    `verified.json` marker listing the same hashes exists (written only after a full hash
    check — so startup never re-hashes 650 MB); `'partial'` when `.part` files exist;
    else `'missing'`.
  - `download(id, onProgress, signal)`: per file, skip if already verified; otherwise
    download to `<name>.part`, **resuming** with a `Range` header when a `.part` exists (hash
    the existing part first, then continue the same hash); stream to disk while hashing;
    on completion check size + sha256; on mismatch delete the part and fail with "The
    download was damaged. Try again."; rename to the final name. After all files, write
    `verified.json`. `onProgress({ receivedBytes, totalBytes })` at most ~5 times a second.
    Honour `signal` (cancel keeps `.part` for a later resume). Map errors to plain
    sentences: offline/DNS → "Could not reach the download server. Check your internet
    connection."; HTTP ≥ 400 → "The download server answered with an error (HTTP n).";
    `ENOSPC` → "Not enough free disk space — about 700 MB is needed.".
    A server that ignores `Range` (200 instead of 206) restarts that file from zero.
  - `remove(id)`: delete the model folder (and parts).
  - `path(id)`: the folder, for the engine.

### WAV decoding — `src/main/wav.ts`

`decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } | null` —
RIFF/WAVE, walk the chunks (skip unknown ones, handle an 18-byte `fmt ` chunk), PCM 16-bit
only, mono or stereo (average to mono), return null for anything else. Pure, tested.

### Protocol and worker

- `src/main/engine/protocol.ts`: `ToWorker = { type: 'load', modelDir, numThreads } |
  { type: 'transcribe', id, samples: Float32Array, sampleRate } | { type: 'unload' }`;
  `FromWorker = { type: 'loaded', ms } | { type: 'result', id, text, ms } |
  { type: 'error', id?: string, message: string }`.
- `src/main/engine/worker.ts` (utility process, `process.parentPort`): `require` the addon
  lazily on first `load`; build the NeMo transducer config exactly as the spike's working
  snippet (`modelType: 'nemo_transducer'`, encoder/decoder/joiner/tokens paths, `numThreads`,
  `debug: 0`, `provider: 'cpu'`, `decodingMethod: 'greedy_search'`), `createAsync`; per
  transcription `createStream()`, `acceptWaveform({ sampleRate, samples })`,
  `await recognizer.decodeAsync(stream)`, read `.text`, keep references alive until settled,
  then call the `gc` obtained as described above. Long audio: if longer than 30 s, split
  with `splitForDecoding` (below) and decode the pieces in order, joining with a space.
  Every failure becomes an `error` message; never let an exception kill the process
  silently.
- `src/main/engine/chunking.ts` (pure): `splitForDecoding(samples, sampleRate, maxSeconds =
  30)` → array of subarrays; cut at the quietest 300 ms window (lowest RMS, reuse the idea
  of `windowRms` from `src/renderer/audio-prep.ts` — copy the function, do not import the
  renderer) between 15 s and 30 s of each piece; never produce a piece longer than
  `maxSeconds`.

### Main-side engine — `src/main/engine/local-engine.ts`

`LocalEngine` with an injectable `spawn(): WorkerHandle` (production: Electron
`utilityProcess.fork(join(__dirname, 'engine-worker.js'), [], { serviceName: 'Murmur speech engine' })`)
so it is unit-testable with a fake:
- `prewarm()`: spawn and load if not loaded or loading; idempotent.
- `transcribe(samples, sampleRate, signal): Promise<string>` — loads first if needed
  (awaiting the same load promise), posts the job, resolves with trimmed text. Transfer
  the samples buffer (it is Murmur's own copy; zero the caller's copy after posting —
  document who owns what). Timeout: `max(20 s, audioSeconds × 1.5 + 10 s)` → reject "The
  speech engine took too long." and **kill** the worker (it will respawn next time).
  Abort via `signal`: reject immediately with an `AbortError`; the worker result is ignored
  when it arrives.
- Worker exit/crash while jobs are pending → reject them with "The speech engine stopped
  unexpectedly. Try again." and clear state; next call respawns.
- Idle unload: `IDLE_UNLOAD_MS = 5 * 60 * 1000` after the last transcription (reset on
  every use; prewarm also resets it) → kill the process, freeing its memory. Constant for
  now; a setting may come later.
- `numThreads`: `Math.min(4, Math.max(1, os.availableParallelism() - 1))` — document the
  spike's finding that 4 was fastest in 4 of 5 batches on this hybrid CPU and 8 was 2–4×
  slower, and that `os.cpus().length` must never be used.
- `dispose()` for quit.

### Settings, routing and readiness

- Settings: `engine: 'local' | 'cloud'` in `PublicSettings`, `SettingsUpdate`,
  `StoredSettings`. Load path: a valid stored value is kept; when absent, **`'cloud'` if the
  file already holds an `encryptedApiKey`** (an existing user keeps what works), otherwise
  `'local'`. `DEFAULT_SETTINGS.engine = 'local'`. Save path validates the enum. Tests for
  all three load cases.
- `src/shared/engine.ts`: `EngineStatus = { engine: 'local' | 'cloud'; model: { id; state:
  'missing' | 'partial' | 'downloading' | 'verifying' | 'installed' | 'failed';
  receivedBytes; totalBytes; error: string | null }; ready: boolean; notReadyReason: string
  | null }` and a pure `engineReady(settings, modelState)` → local: installed; cloud:
  `apiKeySource !== 'none'`. Reasons: "Download the speech model in Settings first." /
  "Add your API key in Settings before recording.".
- `src/main/index.ts`:
  - Create `ModelStore` and `LocalEngine` in `bootstrap`; dispose the engine in
    `before-quit`.
  - `transcribe()` routes: `engine === 'local'` → `decodeWav(payload.audio)` (null → throw
    "This recording could not be read for on-device transcription. Try again.") →
    `localEngine.transcribe(...)`; else the existing cloud path. History `model` for local
    takes is the model id.
  - `workflowSettings().apiKeyConfigured` becomes `transcriptionReady` (+ `notReadyReason`);
    update the controller's start check and its message to use the reason.
  - IPC (all `fromMain`-guarded, like their siblings): `engine:get-status`,
    `engine:download` (starts; progress and completion are broadcast), `engine:cancel-download`,
    `engine:remove-model`; broadcast `engine:status` to the main window on every change
    (throttled progress). Preload wrappers `getEngineStatus`, `downloadModel`,
    `cancelModelDownload`, `removeModel`, `onEngineStatus`.
  - First-launch page choice (`showMain(hasApiKey ? 'history' : 'settings')`) becomes
    `showMain('history')` when ready, else `'history'` too — 07b adds the setup card there;
    keep Settings only for cloud users without a key.
- Renderer: only the readiness plumbing needed so nothing breaks —
  `recording-control.ts` and `setup-guide.ts` take `ready`/`notReadyReason` instead of
  `apiKeySource` (update their tests). The visible engine UI is 07b.

## Tests

`tests/wav.test.ts`, `tests/chunking.test.ts`, `tests/model-store.test.ts` (fake fetch +
temp dir: fresh download, resume with 206, server ignoring Range, hash mismatch, cancel
keeps part, ENOSPC mapping, installed detection via marker, remove),
`tests/local-engine.test.ts` (fake worker: lazy spawn, shared load promise, transcribe
result, timeout kills, abort ignores late result, crash rejects pending and respawns,
idle unload after 5 min with fake timers, prewarm idempotent), settings-store engine
migration cases, controller/readiness tests updated. Real-addon smoke test is **not** a
unit test — Claude runs it against the built app.

## Done when

`npm run typecheck && npx vitest run && npm run lint && npx electron-vite build` pass and
`out/main/engine-worker.js` exists. Do not commit.
