# Hand test 0.7.0 (Claude's notes)

Build: `%LOCALAPPDATA%\vocette-release\0.7.0\Vocette-0.7.0-win-x64.exe` (111.1 MB, commit
22b90ac, unsigned). Contains everything from 0.6.6 and 0.6.7. Gate per the 16 Oct rule: one
guided test per release candidate, one step per message.

What the benchmark can't prove, so this test does: the real microphone in a real room with
the processing off (noise, quiet voice), the first dictation after a real start, and the
0.6.6/0.6.7 items that are still unproven.

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Quit Vocette from the tray; install 0.7.0 over 0.6.7 | Installs; resting pill appears | |
| 2 | Straight away, dictate into Notepad: "Remind me to send the invoice on Friday." | Every word, including "Remind me", and it pastes | |
| 3 | Dictate a longer sentence with some background noise (a video playing quietly) | Accurate; no worse than before | |
| 4 | Dictate quietly, close to a whisper | Text arrives (no AGC now); note if words go missing | |
| 5 | Start a dictation and, while talking, move the pointer onto the open pill (K11) | It fades while the pointer is on it | |
| 6 | Make Vocette's window as narrow as it goes (K2) | Five History numbers stay in one row | |
| 7 | Ctrl and + twice, then Ctrl and 0 | 3 + 2 numbers, "Export .txt" on one line; back to normal | |

Still unproven after this: K8 install-and-restart (needs a published release feed), the
NSIS uninstall removing the Run entry, S6 on a non-English Windows, the first-run card on a
fresh profile. These go into the 0.8.0 test.
