On-device speech model files for Vocette. The app downloads these itself and checks
each file's SHA-256 before loading it. This is not an app release.

**Replaces `model-parakeet-v3-q8-1`,** whose int8 build produced garbled text on some x86
processors (seen on AMD EPYC Zen 3 and Zen 4). This build quantises with `reduce_range`,
which avoids the overflow in ONNX Runtime's uint8 x int8 kernel, and transcribes correctly on
those processors, on Apple silicon and on Intel Core Ultra.

**Model:** NVIDIA Parakeet TDT 0.6B v3, licensed CC-BY-4.0. The ONNX export is by the
sherpa-onnx project (k2-fsa), from `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3` at
commit `1a468a35cbba69418f126de829e75261dea4a4e4`.

**Changed by Vocette:** the MatMul and Gemm weights were quantised to int8 (dynamic, per
channel, reduced range) with onnxruntime 1.31.0. Everything else is unchanged. The script is
`e2e/bench/to-int8.py` (mode `dynrr`) in this repository.

| File | Bytes | SHA-256 |
|---|---|---|
| encoder.int8.onnx | 881498555 | f1103b2adcd067232a88d8f65d4918909be63c3fb84ebfe1bd0be6a42d14429b |
| decoder.int8.onnx | 47235689 | 167873a811f683e6ce94204887954297e77a2c6604a5121dcc234394a7fbfe3e |
| joiner.int8.onnx | 6402684 | c1e0fea6822eae1c378810cf7d712907f352cf30e0dd4c9bcfea370d17d40151 |
| tokens.txt | 93939 | d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d |
