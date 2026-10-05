# Hand test 0.5.0 — running order and record (Claude's notes)

Build under test: `%LOCALAPPDATA%\murmur-release\0.5.0\murmur-0.5.0-win-x64.exe`, commit
35dfe9b, unsigned. Owner's real profile backed up to
`C:\Users\KIRINDE\murmur-backups\Murmur-profile-2026-09-28-before-hand-test` (89 files).

Starting state of the owner's profile: settings v5, a saved OpenAI key, so the upgrade
keeps the **cloud** engine; 1,389 history entries; hold to talk on Left Ctrl + Left Shift;
no vocabulary or replacements; no speech model in `%LOCALAPPDATA%\Murmur\models`. No other
copy of the app running; no startup entries for it. Node's fetch reaches OpenAI, GitHub and
Hugging Face from this network.

Rules: one step per message; wait for the owner's result; a failure stops the run until it
is dealt with. Pass/fail recorded here, not in the chat.

| # | Step (what the owner does) | Expected | Covers | Result |
|---|---|---|---|---|
| 1 | Run the installer (SmartScreen: More info → Run anyway), default options | Installs per user, Vocette opens on History; sidebar "Pro Trial · 30d" | 15, 11 | |
| 2 | Settings → Transcription → On this PC → Download | 670 MB downloads with progress, then "Ready" | 7b on the real profile | |
| 3 | Notepad open, hold Left Ctrl + Left Shift, say a sentence, let go | Text typed into Notepad; overlay "Pasted", the wait at its right | core, 10 | |
| 4 | Copy a word first; dictate; then Ctrl + V somewhere | Pasting gives the copied word back (clipboard restored) | 4 | |
| 5 | Alt + Shift + V in Notepad | Last dictation pasted again | 4 | |
| 6 | Hold the chord and speak immediately | First word kept | 9 | |
| 7 | Settings → Your words: add "Kirinde" and "ITU-T", save; dictate them | Spelled as written | 8 | |
| 8 | Say "um, move it to Tuesday, no sorry, Wednesday" | "Move it to Wednesday." | 2 | |
| 9 | Replacement `my email => …` then say "my email" | Expands | 3 | |
| 10 | Start dictating, switch to another window before letting go | Not pasted; "Copied — paste manually (focus moved)" | 4 | |
| 11 | Settings → Press to start and stop; press, speak, Esc | Cancelled, nothing pasted; hint shows Esc | R3 | |
| 12 | History: Edit one entry, Delete + Undo, Show original; "ready in …s" | All work | 13, 10 | |
| 13 | About → Check now | "You have the latest version (0.5.0)." | 14 | |
| 14 | Win + L, unlock, dictate | Shortcut still works | R5 | |
| 15 | (If willing) AI polish with the OpenAI preset, Professional; dictate a casual sentence | Polished text, "Polished" tag; a question in the dictation is tidied, not answered | 12 (real model) | |
| 16 | Pro page | Trial days shown; Yearly/Monthly "opens soon" (no Polar links yet); "Your subscription" key field | 11, 18 | |
