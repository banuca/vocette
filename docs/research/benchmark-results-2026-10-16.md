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

Notes: the benchmark added about 100 entries to the owner's History (texts match the
passages). They're not removed: deleting needs the owner's OK. A backup of the settings from
before the benchmark is at `%LOCALAPPDATA%\vocette-bench\settings-before-bench.json`, and it
has been restored.
