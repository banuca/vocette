# Plan: ship the q8dyn on-device model from a GitHub release (Claude's notes, 19 Oct 2026)

Evidence: `docs/research/benchmark-results-2026-10-16.md`, "Int8 made from the fp32 model".
q8dyn: 11.1% WER (shipping int8 21.2%), 0 empties, decode p50 0.41 s, 1.04 GB RSS, 0.94 GB files.

## Steps (one commit each)

1. **Reproducible build of the files.** `e2e/bench/to-int8.py dyn` from
   `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3` at a pinned commit (record it). Output
   names kept as `encoder.int8.onnx`, `decoder.int8.onnx`, `joiner.int8.onnx`, `tokens.txt`,
   so `PARAKEET_FILES` and the worker don't change. Record bytes + SHA-256. Re-run twice to
   check the conversion is deterministic (same hashes); if not, the published bytes are the
   reference.
2. **Publish (owner's OK at the moment of publishing).** `gh release create
   model-parakeet-v3-q8-1 --prerelease --latest=false` on banuca/vocette with the four files and
   a notes text: source, licence CC-BY-4.0, what was changed (MatMul/Gemm weights to int8,
   per channel), the script. Prerelease + not latest, so the update check
   (`/releases/latest`) never sees it. Then download each asset back and compare SHA-256.
3. **Manifest.** `src/main/engine/models.ts`: new id `parakeet-tdt-0.6b-v3-q8`, BASE_URL
   `https://github.com/banuca/vocette/releases/download/model-parakeet-v3-q8-1/`, new sizes and
   hashes. `src/shared/speech-model.ts`: same id; attribution adds "int8 conversion by
   Vocette" (CC-BY asks to say what was changed). Display name stays "Parakeet v3".
4. **Old model.** New id → new folder, so existing installs show "download the model" again
   (0.94 GB). At startup, if the new model is installed, delete the old
   `parakeet-tdt-0.6b-v3-int8` folder (0.67 GB). Pre-launch, so only the owner and testers
   re-download. (Alternative, more code: keep the old model working until the new one is in.)
5. **Tests and docs.** Update tests that name the id (≈17 files), model-store fixtures,
   SECURITY.md (download source is now GitHub), About/licence text, CHANGELOG, size copy in
   the download prompt (0.67 → 0.94 GB) and any "~0.8 GB memory" claims.
6. **Check through the app.** Dev build on the bench profile, `run.ps1 -Engine local` on all
   20, score; plus a fresh-profile download from the real release URL (resume, hash refusal).
   Pass: on-device WER ≤ 12% through the app, 0 empties, download verifies.

## Unproven after this

- Mac and Linux: same ONNX files, but sherpa-onnx runtimes there are unbenchmarked (P1).
- 20 clips only; the beta (S3) is the wider check.
- Memory measured on the model alone (1.04 GB), not the whole app.
