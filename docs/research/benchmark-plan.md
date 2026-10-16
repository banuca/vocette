# Vocette vs Wispr Flow benchmark (Claude's notes)

Brief step 3, 16 Oct 2026. It should be re-runnable: after any engine change, play the same
recordings again and compare.

## What it measures

- **Accuracy:** word error rate (WER) per passage and overall, with `jiwer`. Text is normalised
  first (lower case, punctuation removed, numbers written the same way) so it scores words, not
  formatting. A second pass scores formatting separately: capitals, punctuation, and the
  numbers/dates/currency in the passages.
- **Speed:** from the end of the speech to the text appearing in the target window, per
  passage; report p50 and p90.
- **Must-get terms:** Vocette, ITU, Kirinde, TypeScript, Electron, Polar, GitHub. These are
  counted as hit or miss, because proper nouns are what users notice.

Engines: Wispr Flow (free tier, its defaults), Vocette cloud (gpt-transcribe, polish as the
owner has it), Vocette on-device (Parakeet int8). Polish on and off are reported apart if
time allows.

## Fair audio path

Wispr Flow only listens to a microphone, so every engine must hear the **same recordings
through the same path**. Feeding Vocette clean WAV files through e2e's fake microphone while
Wispr Flow hears the room would bias the test.

Plan A, no installs: play each recording through the laptop speakers (CS42L43) into the
laptop's own microphone array, in a quiet room, at a fixed volume, for every engine. Room
sound affects all engines equally.
Plan B, if A is too noisy: a virtual audio cable (VB-Audio, a driver the owner would
install). Only if A fails.

The runner (to be written, `e2e/bench/run.ps1` or `.mjs`):
1. Focuses a plain target window (Notepad, empty file).
2. Holds the engine's hotkey via SendInput: Vocette is Left Ctrl + Left Shift (hold mode);
   Wispr Flow's shortcut on this PC is **hold Ctrl + Alt** (owner's screenshot, 16 Oct).
3. Plays the WAV, releases the hotkey 300 ms after the audio ends, and stamps that time.
4. Polls the window text and stamps when it changes. That gap is the speed figure.
5. Saves the text, clears the window and moves to the next passage.

**Unknown, to check first:** whether Wispr Flow accepts a synthesised hotkey. Low-level
keyboard hooks can see the injected flag. If it refuses, the owner presses the key for the
Wispr runs only and the runner keeps time from the audio. That is less exact; say so in the
results.

## Pilot, 16 Oct (passage p04 only)

| Run | Path | Result |
|---|---|---|
| Vocette cloud | Dell monitor speakers → laptop mic | "Send is an intention of, it is the types of, you say in a program." 1.64 s |
| Vocette cloud | laptop speakers → laptop mic | Transcribed, but not pasted: the focus check declined and left it on the clipboard. "Who said this? Dictation also includes the tags…" |
| Wispr Flow | laptop speakers → (its mic, unconfirmed) | "This is a dictation app which types what you say into any program" 1.22 s |
| Vocette cloud | laptop speakers → laptop mic, repeat | "Use indentation of plus the tags what you say in any program." 1.21 s, pasted |

Findings:
- **Wispr Flow accepts the runner's synthesised Ctrl+Alt hold.** It can be fully automated.
- Played through the air, Vocette's text is far worse than Wispr Flow's on the same audio.
  This is confounded: Wispr's microphone is unconfirmed, and Vocette's capture turns on
  Chromium's `echoCancellation`, `noiseSuppression` and `autoGainControl`
  (`src/renderer/recorder.ts:166`). Those are tuned for calls and may hurt dictation. **Lead
  for the finish list:** A/B test the recorder with echo cancellation off. Dictation has no
  far end to cancel.
- Vocette sometimes declines to paste into the runner's window (1 in 3). The runner now
  records `pasted` and keeps the clipboard text, so accuracy still counts. Worth knowing for
  real users too: why did the focus check fail on a window that never lost focus?
- **Decision: switch to Plan B (virtual cable).** The through-air path can't separate engine
  quality from speaker/mic acoustics and audio processing.

## Recordings

The owner reads the 20 passages in `benchmark-passages.md` once, in Windows Sound Recorder,
one file per passage, named `p01` … `p20`, at a normal speaking pace. Claude converts them
with ffmpeg to 16 kHz mono WAV in `%LOCALAPPDATA%\vocette-bench\audio`. Passages match real
use: the median dictation is 16 words, p90 51 (history.json). Total about 900 words, which
fits inside Wispr Flow's 2,000 free words a week, with room for one re-run.

## Pass / fail (from the brief)

Vocette ties or beats Wispr Flow on median speed **and** on overall WER, across the same
20 passages, on this PC. A tie means within 0.2 s on speed and within 1 point of WER. The
on-device result is reported on its own; it isn't required to pass at launch.

## Owner steps, in order (give one at a time)

1. Install Wispr Flow (free) from wisprflow.ai, sign in, keep its default hotkey. **Done 16 Oct.**
2. Record the 20 passages.
3. Stay nearby, with the room quiet, while the runner plays them (~20 minutes, three engines).
