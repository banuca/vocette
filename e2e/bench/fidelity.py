"""How faithfully a captured take copies the original recording, sample by sample.

    python e2e/bench/fidelity.py <take.wav> <pNN>

Finds the best alignment by cross-correlation (16 kHz), then reports the correlation of
each 250 ms slice of the original's speech with the take. ~1.0 means a clean copy;
a slice near 0 means that stretch is missing or damaged in the take.
"""
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from align import read, resample  # noqa: E402

AUDIO = Path(os.environ["LOCALAPPDATA"]) / "vocette-bench" / "audio"


def main():
    take, r1 = read(Path(sys.argv[1]))
    orig, r0 = read(AUDIO / f"{sys.argv[2]}.wav")
    take, orig = resample(take, r1), resample(orig, r0)
    # FFT cross-correlation for the lag of take[0] in the original.
    n = 1 << int(np.ceil(np.log2(len(orig) + len(take))))
    c = np.fft.irfft(np.fft.rfft(orig, n) * np.conj(np.fft.rfft(take, n)), n)
    lag = int(np.argmax(c))
    if lag > n // 2:
        lag -= n
    print(f"take starts at {lag / 16000:+.3f}s of the original")
    sl = 4000  # 250 ms
    for start in range(0, len(orig) - sl, sl):
        t0 = start - lag
        if t0 < 0 or t0 + sl > len(take):
            status = "not in take"
        else:
            a, b = orig[start:start + sl], take[t0:t0 + sl]
            if np.abs(a).max() < 0.01:
                status = "(silence)"
            else:
                r = np.corrcoef(a, b)[0, 1]
                status = f"corr {r:.2f}"
        print(f"  {start / 16000:5.2f}s  level {np.abs(orig[start:start + sl]).max():.2f}  {status}")
        if start / 16000 > 3:
            break


if __name__ == "__main__":
    main()
