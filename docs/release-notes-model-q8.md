On-device speech model files for Vocette. The app downloads these itself and checks
each file's SHA-256 before loading it. This is not an app release.

**Model:** NVIDIA Parakeet TDT 0.6B v3, licensed CC-BY-4.0. The ONNX export is by the
sherpa-onnx project (k2-fsa), from `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3` at
commit `1a468a35cbba69418f126de829e75261dea4a4e4`.

**Changed by Vocette:** the MatMul and Gemm weights were quantised to int8 (dynamic, per
channel) with onnxruntime 1.31.0. Everything else is unchanged. The script is
`e2e/bench/to-int8.py` (mode `dyn`) in this repository, and the build is reproducible.

| File | Bytes | SHA-256 |
|---|---|---|
| encoder.int8.onnx | 881498555 | c5cdff28d4ac8690b3e3f7780ac5089586d87a2800cebf0ed5d5a128e94f2b86 |
| decoder.int8.onnx | 47235689 | 167873a811f683e6ce94204887954297e77a2c6604a5121dcc234394a7fbfe3e |
| joiner.int8.onnx | 6402684 | 2de5c9796ae6d01e075161d6d25416fa9b19dcac130715401470545ddc51191b |
| tokens.txt | 93939 | d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d |
