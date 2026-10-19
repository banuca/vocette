# Quantises the full-precision on-device model's matrix weights to int8, leaving the
# convolutions and the rest in fp32. Two ways, to compare with the shipped int8 export
# (which quantises every op dynamically):
#   dyn   QDQ-free dynamic quantisation of MatMul/Gemm only, per channel (int8 activations
#         computed at run time)
#   dynrr as dyn, with 7-bit weights (reduce_range), so ONNX Runtime's uint8 x int8 kernel
#         cannot saturate on x86 CPUs without VNNI
#   dynu8 as dyn, with uint8 weights (uint8 x uint8 kernel), the other cure for that
#   nbits weight-only int8 (MatMulNBits, 8 bits, block 32): activations stay fp32
#   python e2e/bench/to-int8.py <dyn|dynrr|dynu8|nbits> <fp32 dir> <out dir> [--app-names]
# "dyn" garbles speech on CPUs without VNNI (AMD Zen 3, Intel before Ice Lake): see
# docs/plan-p1-mac-linux.md.
# --app-names writes encoder.int8.onnx etc., the names the app's manifest uses. The model
# Vocette ships is "dyn" from csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3 at commit
# 1a468a35cbba69418f126de829e75261dea4a4e4 (docs/plan-model-q8.md).
import shutil
import sys
from pathlib import Path

import onnx
from onnxruntime.quantization import QuantType, quantize_dynamic

mode, src, dst = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
app_names = "--app-names" in sys.argv[4:]
dst.mkdir(parents=True, exist_ok=True)
for name in ("encoder", "decoder", "joiner"):
    source = src / f"{name}.onnx"
    out = dst / (f"{name}.int8.onnx" if app_names else f"{name}.onnx")
    if mode in ("dyn", "dynrr", "dynu8"):
        quantize_dynamic(
            str(source), str(out), op_types_to_quantize=["MatMul", "Gemm"],
            per_channel=True, reduce_range=mode == "dynrr",
            weight_type=QuantType.QUInt8 if mode == "dynu8" else QuantType.QInt8,
            extra_options={"MatMulConstBOnly": True})
    else:
        from onnxruntime.quantization.matmul_nbits_quantizer import (
            DefaultWeightOnlyQuantConfig, MatMulNBitsQuantizer)
        model = onnx.load(str(source), load_external_data=True)
        config = DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=True, bits=8)
        quantizer = MatMulNBitsQuantizer(model, algo_config=config)
        quantizer.process()
        q = quantizer.model.model
        big = q.ByteSize() > 1_800_000_000
        onnx.save(q, str(out), save_as_external_data=big, location=f"{name}.weights" if big else None)
    print(f"{name}: {out.stat().st_size / 1e6:.0f} MB", flush=True)
shutil.copy(src / "tokens.txt", dst / "tokens.txt")
