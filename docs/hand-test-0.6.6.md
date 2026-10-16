# Hand test 0.6.6 (Claude's notes)

Build: `%LOCALAPPDATA%\vocette-release\0.6.6\Vocette-0.6.6-win-x64.exe`, at 3d4eb3d on
`go-live`, unsigned. It replaces 0.6.5, which was built but never installed: the owner paused
testing on 15 Oct and asked Claude to carry on. The owner's engine is **cloud** (OpenAI), and
the on-device model is installed too.

## In this build, one commit each

| Item | Commit | Checked before handing over |
|---|---|---|
| Tick hold 1.5 s (0.6.5) | e0d1f80 | `quiet-check`, dev and packaged: beat 216x48 to about 1.5 s, folded by about 2.05 s, at rest about 3.2 s |
| K13 own name | c38d96b | Unit tests (`own-name`), and a start-up test where the engine returns "Voset" and History gets "Vocette". **Not run in the packaged app**: the test audio doesn't say the name |
| App checks into the project | 9f57c18 | `e2e/`, with data in `%LOCALAPPDATA%\vocette-e2e`. `quiet-check` ran from the new place |
| S4 Download saves the engine | 652a79a | Unit tests; `engine-download-check`, dev and packaged: a cloud user picks this PC and presses Download, the engine saves as local, and an unsaved switch stays unsaved |
| K2 stats row | 07336bd | `stats-narrow-check`: 5 in a row at 1060, 941, 900 and 860 px; at 125% and 150% zoom 3 + 2, each row flush. Screenshots in work `stats/` |
| Toolbar on one line | 320eee0 | The same screenshots at 150% |
| K11 fade | 343a7c3 | Unit tests (`overlay-peek`); `peek-check`, dev and packaged, moves the real pointer: on the pill the body opacity is 0.12; beside the pill (still in the window) and away it is 1 |

## Unproven

- K11 while dictating (open pill), and on a display that isn't at 100% scale. The check covers
  the resting pill at scale 1 only.
- K13 with the cloud recogniser (the owner's engine). The term now goes into the prompt, and
  the replacements catch "Voset" either way.
- S4 by hand: the model is installed on this PC, so Settings shows no Download button. e2e only.

**15 Oct, test run:** installing the 0.6.7 release build instead
(`%LOCALAPPDATA%\vocette-release\0.6.7\Vocette-0.6.7-win-x64.exe`, 111 MB, 02:39). It contains
every 0.6.6 item; run these steps first, then add the 0.6.7 steps. Engine still cloud.

## Steps (one at a time, wait for each)

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Install 0.6.6 over 0.6.4 | Installs; the resting pill is there | Pass (16 Oct, 0.6.7 installed) |
| 2 | Dictate a sentence into any app | Lands; the open pill holds the green tick about 1.5 s, then folds | Pass (16 Oct) |
| 3 | Dictate "I am writing this with Vocette" | Typed as "Vocette" | Pass (16 Oct, cloud engine, dictated into Claude chat) |
| 4 | Rest the mouse pointer on the small pill | It fades almost away; moving off brings it back | Pass (16 Oct). Paused here: owner moved to another task; steps 5–7 and the 0.6.7 steps still to run |
| 5 | Start a dictation, and while talking move the pointer onto the open pill | It fades while the pointer is on it | |
| 6 | Make Vocette's window as narrow as it goes | The five numbers on History stay in one row | |
| 7 | Press Ctrl and + twice, then Ctrl and 0 | Zoomed: numbers in 3 + 2, "Export .txt" on one line; Ctrl 0 puts it back | |
