"""Scores benchmark runs against docs/research/benchmark-passages.md.

    python e2e/bench/score.py wispr vocette-cloud vocette-cloud-warm

Word error rate is on normalised words (case, punctuation and number formatting removed),
so "$4,250" and "four thousand two hundred and fifty dollars" count as the same words.
Formatting is reported apart: must-get terms, and whether a sentence ends with punctuation.
Writes %LOCALAPPDATA%/vocette-bench/results/summary.json.
"""
import json
import os
import re
import statistics
import sys
from pathlib import Path

import jiwer
from num2words import num2words

ROOT = Path(__file__).resolve().parents[2]
RESULTS = Path(os.environ["LOCALAPPDATA"]) / "vocette-bench" / "results"
TERMS = ["Vocette", "ITU", "Kirinde", "TypeScript", "Electron", "Polar", "GitHub", "getUserSettings"]


def passages():
    text = (ROOT / "docs" / "research" / "benchmark-passages.md").read_text(encoding="utf-8")
    return {m.group(1): m.group(2).strip() for m in re.finditer(r"^(p\d\d)\. (.+)$", text, re.M)}


def words_for_number(s: str, ordinal: bool = False) -> str:
    n = float(s.replace(",", ""))
    if ordinal:
        return num2words(int(n), to="ordinal")
    return num2words(int(n)) if n.is_integer() else num2words(n)


def normalise(t: str) -> str:
    t = t.lower().replace("’", "'")
    # Currency: $4.99 -> four ninety nine dollars; $4,250 -> four thousand two hundred fifty dollars
    t = re.sub(r"\$(\d[\d,]*)\.(\d\d)\b", lambda m: f"{words_for_number(m[1])} {words_for_number(m[2])} dollars", t)
    t = re.sub(r"\$(\d[\d,]*)", lambda m: f"{words_for_number(m[1])} dollars", t)
    t = re.sub(r"(\d+):(\d\d)", lambda m: f"{words_for_number(m[1])} {words_for_number(m[2])}", t)
    t = re.sub(r"(\d+(?:\.\d+)?)\s*%", lambda m: f"{words_for_number(m[1])} percent", t)
    t = re.sub(r"(\d+)\s*°\s*c?(?!\w)", lambda m: f"{words_for_number(m[1])} degrees ", t)
    t = re.sub(r"(\d+)(st|nd|rd|th)\b", lambda m: words_for_number(m[1], ordinal=True), t)
    t = re.sub(r"\d[\d,]*(?:\.\d+)?", lambda m: words_for_number(m[0]), t)
    t = t.replace("percent", " percent ").replace("-", " ")
    t = re.sub(r"[^\w\s']", " ", t)
    words = [w for w in t.split() if w != "and"]  # "two hundred and fifty" == "two hundred fifty"
    return " ".join(words)


def load(engine: str):
    # Only text that reached the window counts. The clipboard can hold an older take, so it
    # can't prove what this passage produced.
    rows = {}
    for line in (RESULTS / f"{engine}.jsonl").read_text(encoding="utf-8-sig").splitlines():
        r = json.loads(line)
        r["final"] = (r.get("text") or "").strip()
        rows[r["id"]] = r
    return rows


def opening_ok(ref: str, hyp: str, n: int = 3) -> bool:
    """The first n words came through, which is where a late or warming microphone shows."""
    return normalise(ref).split()[:n] == normalise(hyp).split()[:n]


def pct(values, q):
    s = sorted(values)
    return s[min(len(s) - 1, int(q * (len(s) - 1)))] if s else None


def score(engine: str, truth: dict):
    rows = load(engine)
    refs, hyps, per = [], [], []
    for pid, ref in truth.items():
        r = rows.get(pid)
        hyp = r["final"] if r else ""
        refs.append(normalise(ref))
        hyps.append(normalise(hyp) or "")
        w = jiwer.wer(normalise(ref), normalise(hyp)) if hyp else 1.0
        per.append({
            "id": pid, "wer": round(w, 3), "text": hyp,
            "firstTextMs": r.get("firstTextMs") if r else None,
            "pasted": bool(r and r.get("pasted")),
        })
    overall = jiwer.wer(refs, [h if h else "<empty>" for h in hyps])
    got = [(r, h) for r, h in zip(refs, hyps) if h]
    wer_answered = jiwer.wer([r for r, _ in got], [h for _, h in got]) if got else None
    openings = sum(1 for pid, ref in truth.items() if opening_ok(ref, next(p["text"] for p in per if p["id"] == pid)))
    waits = [p["firstTextMs"] for p in per if p["pasted"] and p["firstTextMs"] is not None]
    term_hits = {}
    for term in TERMS:
        for pid, ref in truth.items():
            if term.lower() in ref.lower():
                got = next(p["text"] for p in per if p["id"] == pid)
                term_hits[term] = term.lower() in got.lower().replace(" ", "")
    return {
        "engine": engine,
        "wer": round(overall, 4),
        "werAnswered": round(wer_answered, 4) if wer_answered is not None else None,
        "openingsOk": openings,
        "empty": sum(1 for p in per if not p["text"]),
        "notPasted": sum(1 for p in per if not p["pasted"]),
        "waitP50": pct(waits, 0.5), "waitP90": pct(waits, 0.9), "waitN": len(waits),
        "terms": term_hits,
        "passages": per,
    }


def main():
    truth = passages()
    assert len(truth) == 20, f"expected 20 passages, found {len(truth)}"
    out = [score(e, truth) for e in sys.argv[1:]]
    (RESULTS / "summary.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    for s in out:
        hits = sum(s["terms"].values())
        print(f"{s['engine']:<22} WER {s['wer']*100:5.1f}% (answered only {s['werAnswered']*100:4.1f}%)  "
              f"openings {s['openingsOk']}/20  wait p50 {s['waitP50']} ms  p90 {s['waitP90']} ms  "
              f"(n={s['waitN']})  empty {s['empty']}  not pasted {s['notPasted']}  terms {hits}/{len(s['terms'])}")
    print()
    ids = list(truth)
    print("id   " + "  ".join(f"{s['engine'][:14]:>14}" for s in out))
    for i, pid in enumerate(ids):
        print(f"{pid}  " + "  ".join(f"{s['passages'][i]['wer']*100:13.0f}%" for s in out))


if __name__ == "__main__":
    main()
