# Benchmark results, 16 Oct 2026 (Claude's notes)

The plan is in `benchmark-plan.md`. Runner: `e2e/bench/run.ps1`; scorer: `e2e/bench/score.py`.
Raw rows are in `%LOCALAPPDATA%\vocette-bench\results\*.jsonl` and `summary.json`.

Set-up: 20 recordings by the owner, played digitally into VB-CABLE (Plan B), with both apps'
microphone set to CABLE Output. Shortcut held from 500 ms before playback (the "warm" run holds
it 1,500 ms first) to 300 ms after speech ends. Wait = key release → text arrives in the window.
Vocette 0.6.7 (installed), polish off, as the owner uses it. Wispr Flow free install, defaults.

| Engine | WER, all 20 | WER, answered only | Openings right (first 3 words) | No text | Wait p50 | Wait p90 | Terms |
|---|---|---|---|---|---|---|---|
| Wispr Flow | 7.7% | **5.2%** | **17/20** | 1 (p01, its first take) | **0.77 s** | 1.03 s | 7/8 (missed Vocette: "Voicet") |
| Vocette cloud | 11.4% | 11.4% | 12/20 | 0 | 0.81 s | 1.04 s | 7/8 (missed Polar) |
| Vocette cloud, 1.5 s pre-roll | 10.6% | 10.6% | 12/20 | 0 | 0.92 s | 1.12 s | 7/8 (missed Polar) |
| **Vocette on-device (the default for new users)** | **31.2%** | 22.4% | **7/20** | 3 | 0.69 s | 1.28 s | 5/8 |

## Against the pass mark

- Speed, cloud: 0.81 s vs 0.77 s, within the 0.2 s tie band. **Pass.**
- Accuracy, cloud: 11.4% vs 5.2–7.7%. **Fail.** More than 1 point worse either way.
- On-device: **fail on both counts.** The engine every new user starts on got 31% of words
  wrong and returned nothing for 3 passages.
- The beta-user half of the done mark can't be run until there are beta users.

## What goes wrong

1. **Vocette loses the first words of a dictation.** It got the opening right on 12/20 cloud
   passages and 7/20 on-device, against Wispr's 17/20. Examples: "Remind me to call" became "I
   need to call"; "At the ITU we work" became "ITU, we work"; "Our subscriptions run through
   Polar" became "Subscriptions run through."; "Hi Sarah, following up" became "Calla, speak."
   A longer wait before speaking (1.5 s) didn't fix the openings (still 12/20). So this isn't
   only the microphone opening late; the first second of a freshly opened stream comes out
   damaged. **Lead:** `src/renderer/recorder.ts:164-170` opens a new stream per take with
   `echoCancellation`, `noiseSuppression` and `autoGainControl` all on. WebRTC's AGC and NS
   need time to settle on a new stream. Dictation has no far end to cancel. To test: turn
   them off (or keep one warm stream), then re-run this benchmark.
2. **Mic open lag.** At 500 ms pre-roll the one-word "Okay" (starts 0.65 s into the file) was
   lost twice in pilots. At 1,000 ms it always came through. So opening the cable mic takes
   about 1.2–1.6 s. In the full runs p19 passed at 500 ms, so it's variable. Real users start
   speaking 0.3–0.7 s after pressing. Fix candidates: open the stream on the first modifier
   key-down, or keep it open for a short time after each take.
3. **On-device drops whole stretches**, not just openings. p06 "The bug only happens when the
   window is minimised, so I think the Electron main process…" became "So I think the
   electron process is losing the focus event." p04 became "We said diction as windows…".
   Three passages produced no text at all (likely "only filler or silence"). Possible causes:
   the same stream issue as 1, plus the model prewarm competing for CPU while recording
   (`index.ts` prewarm comment). Investigate before launch: this is the free default.
4. Vocette's p01 "Can you send me…" was perfect while Wispr's first take produced nothing.
   Wispr also drops the spelled-out letters in p09 by design, and writes "Voicet".
5. Speed is fine on cloud. On-device is faster at the median here (0.69 s) than in the
   owner's history (2.49 s). The model was warm and the passages short. Its p90 is 1.28 s.

## For the finish list (ordered by effect on conversion)

1. Fix openings and dropouts in the recorder (A/B the audio processing; warm stream). Re-run
   the benchmark; pass = openings ≥ 17/20 and cloud WER within 1 point of Wispr.
2. On-device accuracy: after 1, re-run. If it's still far behind, decide whether new users
   start on cloud (a key or a hosted proxy) or a better local model. This is the engine the
   free tier lives on.
3. Mic open lag: open on modifier-down, or keep warm.
4. Proper nouns: add Polar (and the user's own terms) to the vocabulary prompt; K13 worked
   for Vocette.

## 0.7.0 (same evening, development build then packaged)

Fixes: raw capture (EC/NS/AGC off), warm-up of the audio service at load, 500 ms lead and
300 ms tail kept by the silence trim, and the glued-price fix. Commits 566e9a6, 5e5bfaa,
da18e0d, 53425c3.

| Engine | WER all 20 | WER answered | Openings | Empty | Wait p50 |
|---|---|---|---|---|---|
| Wispr Flow (earlier run) | 7.7% | 5.2% | 17/20 | 1 | 0.77 s |
| Vocette cloud 0.6.7 | 11.4% | 11.4% | 12/20 | 0 | 0.81 s |
| **Vocette cloud 0.7.0** | 10.1% | **7.6%** | 13/20 | 1 (p01, paste) | 1.01 s |
| Vocette on-device 0.6.7 | 31.2% | 22.4% | 7/20 | 3 | 0.69 s |
| **Vocette on-device 0.7.0** | **22.2%** | 22.2% | 10/20 | **0** | 0.73 s |
| On-device model, originals decoded directly | 21.2% | 14.1% | 12/20 | 2 | n/a |

Evidence for each fix:
- **Capture:** takes now match the source at 0.99 correlation (`fidelity.py`); with
  processing on, takes hit 1.00 peak (clipping) and the first take lost 1.3 s.
- **Mic open:** the first take after start-up took 2,348 ms to open, later ones about 50 ms.
  After the warm-up the first open is 174 ms. Idle for 60 s, it stays at 127 ms. Longer idle
  is not measured.
- **Lead-in:** with 30 ms of lead the cloud model rewrote openings ("Calla, speak", "ITU
  be"). With 500 ms: "Following up on our call…", "At ITU, we work on…".
- **Model limits, not capture:** p13 "Remind me" stays "I need" on the cloud model with
  faithful audio; gpt-4o-transcribe is worse (drops "Our subscriptions run through Polar."
  entirely). The on-device model gives 21% on the clean originals: its ceiling.
- **Vocabulary:** adding "Polar" to the word list fixes it on cloud ("…run through Polar.").
  On-device can't: its miss ("Hold up.") is too far from the word to correct.
- **Speed:** preparation in the app is 11–83 ms; the cloud request is ~0.8 s of the ~0.95 s.
  In a back-to-back A/B on p11–p20, Wispr answered in 0.28–0.58 s (median 0.42 s), but only
  5 of 10 takes produced text (its free plan?), and Vocette in 1.05 s median. Wispr very
  likely streams while you speak. **Speed: fail** (not a tie).

Against the 0.7.0 pass marks: openings 13/20 (target 17) **fail**; cloud WER 7.6% vs 5.2%
(target within 1 point) **fail, gap halved**; on-device 22% (target ≤ 10%) **fail**, which
needs a better model; empty takes 0 on-device **pass**; mic open lag **pass**.

Open:
- **First take after launch sometimes doesn't paste** (2 of ~6 restarts; transcribed fine,
  text never reached the window). Not reproduced on demand. The runner now records
  `focusTakenBy`. Diagnostics (0.8.0) should log the paste refusal reason.
- **Streaming transcription** for speed: the only way to match Wispr's ~0.4 s.
- **On-device model**: the full-precision Parakeet v3 (2.5 GB,
  csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3) would show whether int8 quantisation
  costs accuracy. Download needs the owner's OK.
- Benchmark is one speaker (the owner). It shows real gains, but it isn't a population
  measure.

Notes: the benchmark added about 100 entries to the owner's History (texts match the
passages). They're not removed: deleting needs the owner's OK. A backup of the settings from
before the benchmark is at `%LOCALAPPDATA%\vocette-bench\settings-before-bench.json`, and it
has been restored.

## Full-precision on-device model (19 Oct)

Owner approved the 2.5 GB download. `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3` (fp32,
encoder.weights 2.44 GB), kept in `%LOCALAPPDATA%\vocette-bench\models\parakeet-tdt-0.6b-v3-fp32`.
Run with `e2e/bench/local-direct.ps1 -Model fp32`: model alone on the 16 kHz originals, greedy,
4 threads, no app cleanup (so "is$49" glue is still in the raw text).

| | int8 (shipping) | fp32 |
|---|---|---|
| WER, all 20 | 21.2% | **9.8%** |
| WER, answered only | 14.1% | 9.8% |
| Empty takes | 2 | 0 |
| Openings | 12/20 | 14/20 |
| Decode p50 / p90 | 0.64 / 1.20 s | 1.27 / 2.46 s |
| Warm decode, 6.5 s clip | 0.5–0.8 s | 1.1–1.4 s |
| Process memory | 0.84 GB | **2.57 GB** |
| Download | ~0.65 GB | ~2.55 GB |

- Meets the Q2 pass mark (≤ 10%, no empties) on the model alone.
- Wins: p02, p03, p04 (empty → right), p14, p15. p12 now hears "subscriptions run through
  Cola" (int8 lost the clause) and writes $4.99/$49.
- Worse: p09 (the owner's spelled surname, both poor), p12/p13 small.
- Cost: about 2× decode time and 3× memory. 2.6 GB resident is heavy for a background
  dictation app and undercuts "lightweight".
- No ready fp16 export: `csukuangfj/...-v3-fp16` is empty on Hugging Face (19 Oct). A local
  fp32 → fp16 conversion (onnxconverter-common) would likely halve memory and download; needs
  a pip install and the owner's OK. Not tried.
- Not yet run through the app (instant capture, lead-in, cleanup); this is the model alone.
