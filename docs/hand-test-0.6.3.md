# Hand test 0.6.3, the floating pill (Claude's notes)

Build: `%LOCALAPPDATA%\vocette-release\0.6.3\Vocette-0.6.3-win-x64.exe`, at 00fc243 on
`go-live`, unsigned. It installs over 0.6.2 and leaves the profile alone. The owner chose
smoked glass, polishing look A, and the resting pill on by default (9 Oct). Brief:
`briefs/20-floating-pill.md`.

## Checked before handing over

- tsc, eslint and 1,525 unit tests pass.
- e2e scripts in the session scratchpad `e2e/` ran against both the dev build and the packaged
  `win-unpacked\Vocette.exe`:
  - `pill-check`: the pill rises from 59 px to 0 with overshoot, hugs its words (229 px while
    listening, 216 px while transcribing) and sinks. Screenshots in dark and light over a white
    page, a photo and a dark app.
  - `polish-look-check`: with a 3 s stand-in server, polishing has an ink badge, the sparkle
    shown, the `twinkle` bars and the `shimmer` text clip. Transcribing keeps `write-sweep`.
  - `quiet-check`: with automatic paste off, the success is quiet. It folds from 216x48 to
    56x20 in about 300 ms, the tick shows from about 250 ms, and the pill sinks at idle.
  - `resting-check`: the window is visible from start-up, resting at 56x20 with the bars. A
    take springs it open (271x49 overshoot, settling at 265x48, lifting 4 px). A said success
    returns to rest with the window kept. A quiet success shows the tick on the small pill.
    The switch off hides the window; on brings it back.
  - `resting-switch-check`: the Settings row is drawn with the Windows hint and is on by
    default. Off + Save hides the pill and stores false; on + Save brings it back.
- The real `SHQueryUserNotificationState` on this PC returns S_OK with state 5 (accepts
  notifications) on the normal desktop.

## Unproven before the hand test

- Stepping aside for a real full-screen app. Only the probe (unit tests) and the desktop state
  (5) are checked. No full-screen window was opened on the owner's screen.
- Readability over the owner's real apps, and the look in motion.
- Mac and Linux: not built or run for this change.

## 0.6.4: the fold fix for step 2

- The owner picked timing B.
- Fix b9d3194: a quiet success holds the open pill for 700 ms with a green-tick badge, then folds
  over 550 ms. The tick stays on the small pill, and the controller resets a quiet success after
  2.4 s.
- e2e `quiet-check` on the dev build: the beat held at 216x48 for about 660 ms, folded to 56x20
  by about 1165 ms, the tick showed from about 1079 ms, and the pill was back at rest at
  2356 ms.
- Build `%LOCALAPPDATA%\vocette-release\0.6.4`. Steps continue on 0.6.4 from the step 2
  retest.

## Steps

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Install 0.6.3 over 0.6.2 | A small see-through pill with five bars rests at the bottom centre | **Pass** (owner: "I love the animation, it looks so slick. So cool.") |
| 2 | Dictate a sentence into Notepad | Springs open (red mic, bars follow voice, "Listening…", clock); "Transcribing…" with a passing light; pasted; folds back with a green tick, no "Pasted"; bars return | **Not passed: fold too fast.** The open, listening, transcribing and paste parts are fine; the owner dictated into VS Code (screenshot: listening pill, readable). Owner: "it disappears super quick… it just collapses the pill really fast". Timing options A (now, 300 ms fold), B (a 700 ms beat with a green check in the open pill, then a 550 ms fold) and C (1.4 s beat, 650 ms fold) at https://claude.ai/artifact/6ZNq7uXTauJNQCofwnUy6M. Claude recommends B. Implementing it needs a quiet-success reset of about 2.4 s instead of `SUCCESS_RESET_MS` 1600<br>**Retest on 0.6.4 (15 Oct): pass, with a note.** The text landed in the app. Owner: "I do feel it's a bit too fast, but that's fine. It's not a bummer." Timing C (a 1.4 s beat) stays an option if users say the same. The dictation also showed K13 ("Vocette" heard as "Voset") |
| 3 | Polish on: dictate 8+ words | "Polishing…" with a white sparkle badge, twinkling bars, a shine on the word, a clock; then the tick | **Pass** (15 Oct, 0.6.4; casual polish typed "Send me the latest figures before Thursday's review meeting.") |
| 4 | In Vocette's window, record with the big microphone button | The pill says "Copied to clipboard" with the start of the text, then rests | **Pass** (15 Oct). Owner: the green animation works perfectly from the button. The said success holds about 1.6 s, against the quiet beat of 0.7 s, which suggests a longer quiet beat (timing C) |
| 5 | Full-screen video or F11 in the browser | The pill disappears within about 2 s; comes back after leaving full screen | **Pass** (15 Oct, Edge F11): hides on entering full screen and returns on leaving it |
| 6 | Settings: "Show the pill while idle" off, Save | The pill sinks away; a dictation still rises and opens, then sinks | **Pass** (15 Oct): the pill disappears once the transcription is over |
| 7 | Switch it back on, Save | The pill comes back | **Pass** (15 Oct) |

## Outcome (15 Oct)

All seven steps pass on 0.6.4. One note: the quiet beat feels a little fast next to the said
success's 1.6 s. Mac and Linux are still unproven.

## 0.6.5: a longer tick hold (15 Oct)

- e0d1f80: `LANDED_BEAT_MS` goes from 700 to 1500, and `QUIET_SUCCESS_RESET_MS` from 2400 to 3200.
- e2e `quiet-check` on dev and on the packaged win-unpacked: the open pill holds the tick at
  216x48 until about 1.5 s, is folded to 56x20 by about 2.05 s, and is back at rest at about
  3.2 s.
- Hand step: dictate once; the owner judges the feel. Result:
