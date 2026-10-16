"""Finds which part of an original recording a captured take contains.

    python e2e/bench/align.py <dump-dir> p05 p08 ...   (dumps in time order = passages in order)

For each pair it cross-correlates the take's envelope with the original's, and prints where
the original's speech starts and where the take's audio starts in the original's timeline.
A take starting after the speech means the opening was lost before it reached the engine.
"""
import os
import sys
import wave
from pathlib import Path

import numpy as np

AUDIO = Path(os.environ["LOCALAPPDATA"]) / "vocette-bench" / "audio"


def read(path: Path):
    with wave.open(str(path)) as w:
        rate, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return x, rate


def resample(x, rate, to=16000):
    if rate == to:
        return x
    t = np.arange(0, len(x) / rate, 1 / to)
    return np.interp(t, np.arange(len(x)) / rate, x)


def envelope(x, rate, win_ms=10):
    w = int(rate * win_ms / 1000)
    n = len(x) // w
    return np.sqrt((x[: n * w].reshape(n, w) ** 2).mean(axis=1)), win_ms / 1000


def speech_start(env, step, frac=0.1):
    thr = env.max() * frac
    idx = np.argmax(env > thr)
    return idx * step


def main():
    dumps = sorted(Path(sys.argv[1]).glob("*.wav"))
    ids = sys.argv[2:]
    for pid, dump in zip(ids, dumps):
        orig, r0 = read(AUDIO / f"{pid}.wav")
        take, r1 = read(dump)
        orig, take = resample(orig, r0), resample(take, r1)
        eo, step = envelope(orig, 16000)
        et, _ = envelope(take, 16000)
        # Normalised envelopes, so the take's gain doesn't matter.
        a = (eo - eo.mean()) / (eo.std() + 1e-9)
        b = (et - et.mean()) / (et.std() + 1e-9)
        corr = np.correlate(a, b, mode="full")
        lag = (np.argmax(corr) - (len(b) - 1)) * step  # take[0] sits at this time in the original
        s_orig = speech_start(eo, step)
        s_take = speech_start(et, step)
        print(f"{pid}: original speech starts {s_orig:.2f}s; take covers original from {lag:+.2f}s "
              f"to {lag + len(take) / 16000:.2f}s (take {len(take) / 16000:.2f}s long, its speech starts at {s_take:.2f}s "
              f"= {lag + s_take:.2f}s in original); peak level take {np.abs(take).max():.2f}")


if __name__ == "__main__":
    main()
