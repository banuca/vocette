# Converts the full-precision on-device model to half precision (fp16 weights, fp32 inputs
# and outputs, so sherpa-onnx can load it unchanged).
#   python e2e/bench/to-fp16.py <fp32 dir> <fp16 dir>
import shutil
import sys
from pathlib import Path

import onnx
from onnxconverter_common import float16

INTEGER_TYPES = {onnx.TensorProto.INT32, onnx.TensorProto.INT64}


def length_path(model: onnx.ModelProto) -> list[str]:
    """Nodes that do arithmetic on the integer "length" input. They cast it to float, so the
    converter would half one side of an Add and not the other; and fp16 can't count frames
    past 2048 exactly. Keep them in fp32, stopping where the result is cast back to an int."""
    graph = model.graph
    consumers: dict[str, list[onnx.NodeProto]] = {}
    for node in graph.node:
        for name in node.input:
            consumers.setdefault(name, []).append(node)
    starts = [i.name for i in graph.input if i.type.tensor_type.elem_type in INTEGER_TYPES]
    blocked: list[str] = []
    seen: set[str] = set()
    queue = list(starts)
    while queue:
        for node in consumers.get(queue.pop(), []):
            if node.name in seen:
                continue
            seen.add(node.name)
            blocked.append(node.name)
            to = next((a.i for a in node.attribute if a.name == "to"), None)
            if node.op_type == "Cast" and to in INTEGER_TYPES:
                continue
            queue.extend(node.output)
    # Constants feeding blocked nodes stay fp32 too.
    names = set(blocked)
    blocked += [n.name for n in graph.node if n.op_type == "Constant" and any(
        c.name in names for o in n.output for c in consumers.get(o, []))]
    return blocked


src, dst = Path(sys.argv[1]), Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)
for name in ("encoder", "decoder", "joiner"):
    model = onnx.load(str(src / f"{name}.onnx"), load_external_data=True)
    block = length_path(model)
    half = float16.convert_float_to_float16(
        model, keep_io_types=True, disable_shape_infer=True, node_block_list=block)
    out = dst / f"{name}.onnx"
    big = half.ByteSize() > 1_800_000_000
    onnx.save(half, str(out), save_as_external_data=big, location=f"{name}.weights" if big else None)
    print(f"{name}: done, {len(block)} nodes kept in fp32", flush=True)
shutil.copy(src / "tokens.txt", dst / "tokens.txt")
