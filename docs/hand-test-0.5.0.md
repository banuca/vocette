# Hand test 0.5.0 — running order and record (Claude's notes)

Build under test: `%LOCALAPPDATA%\vocette-release\0.5.0\Vocette-0.5.0-win-x64.exe`, app code
at commit 6912b56 (4b13e2f changes only the release script's summary line), unsigned.
Smoke-tested 5 Oct: the packaged app downloads the model (20 s) and dictates with vocabulary
correction. Owner's real profile backed up to
`C:\Users\KIRINDE\murmur-backups\Murmur-profile-2026-10-05-before-hand-test` (89 files).

From step 8 (retest) on: `%LOCALAPPDATA%\vocette-release\0.5.0-cd77be1\Vocette-0.5.0-win-x64.exe`,
built at 1ec368e with the step 8 fix (cd77be1); its app.asar holds `HESITATION_RULES`, the
first build's does not. Same version number, installed over the top.

Starting state of the owner's profile: settings v5, a saved OpenAI key, so the upgrade
keeps the **cloud** engine; 1,389 history entries; hold to talk on Left Ctrl + Left Shift;
no vocabulary or replacements; no speech model in `%LOCALAPPDATA%\Murmur\models`. No other
copy of the app running; no startup entries for it. Node's fetch reaches OpenAI, GitHub and
Hugging Face from this network.

Rules: one step per message; wait for the owner's result; a failure stops the run until it
is dealt with. Pass/fail recorded here, not in the chat.

| # | Step (what the owner does) | Expected | Covers | Result |
|---|---|---|---|---|
| 1 | Run the installer (SmartScreen: More info → Run anyway), default options | Installs per user, Vocette opens on History; sidebar "Pro Trial · 30d" | 15, 11 | **Pass** 5 Oct: opened on History, 1,389 dictations, "Pro Trial · 30d", Typical wait "—" (old entries unmeasured, as designed) |
| 2 | Settings → Transcription → On this PC → Download | 670 MB downloads with progress, then "Ready" | 7b on the real profile | **Pass** 5 Oct: downloaded and verified (verified.json). Finding: the owner pressed Download but not Save settings, so the engine stayed on cloud until a second prompt — choosing an engine and downloading feels like the switch is made. Candidate: save the engine choice when the download finishes, or say "Save to switch" beside the Ready row |
| 3 | Notepad open, hold Left Ctrl + Left Shift, say a sentence, let go | Text typed into Notepad; overlay "Pasted", the wait at its right | core, 10 | **Pass** (owner) |
| 4 | Copy a word first; dictate; then Ctrl + V somewhere | Pasting gives the copied word back (clipboard restored) | 4 | **Pass** (owner) — first real-keyboard proof of clipboard restore |
| 5 | Alt + Shift + V in Notepad | Last dictation pasted again | 4 | **Pass** (owner) |
| 6 | Hold the chord and speak immediately | First word kept | 9 | **Pass** (owner) |
| 7 | Settings → Your words: add "Kirinde" and "ITU-T", save; dictate them | Spelled as written | 8 | **Pass** (owner) |
| 8 | Say "um, move it to Tuesday, no sorry, Wednesday" | "Move it to Wednesday." | 2 | **Fail** 7 Oct: pasted "Move to Tuesday. No sorry, Wednesday." Settings correct (corrections and fillers on, English, local engine). History's `heardText` (I first missed it) shows the recogniser heard "Um move to Tuesday. No sorry, uh Wednesday." — confirmed cause: a hesitation sound beside the marker ("Tuesday. Uh, no sorry, Wednesday." or "No sorry, um Wednesday") hides the marker, because corrections run before filler removal; the fillers are removed afterwards, which leaves exactly the pasted text. Planned fix: remove hesitation sounds only (um, uh, er…) before the corrections pass, then run the full filler pass as now (it must stay after corrections because it removes a sentence-opening "I mean,"). ("it" missing: the recogniser's, not cleanup's). **Retest Pass** (owner) on the cd77be1 build: heard "Um moving to Tuesday. No, sorry, uh Wednesday." → pasted "Moving to Wednesday." |
| 9 | Replacement `my email => …` then say "my email" | Expands | 3 | **Pass** (owner) |
| 10 | Start dictating, switch to another window before letting go | Not pasted; "Copied — paste manually (focus moved)" | 4 | **Pass** (owner) |
| 11 | Settings → Press to start and stop; press, speak, Esc | Cancelled, nothing pasted; hint shows Esc | R3 | **Pass** (owner) |
| 12 | History: Edit one entry, Delete + Undo, Show original; "ready in …s" | All work | 13, 10 | 12a Show original **Pass** (owner): showed the heard text exactly; 12b Edit **Pass** (owner), kept after leaving the page; 12c Delete + Undo **Pass** (owner); "ready in 0.4s" seen on the owner's screenshot. **Pass** |
| 13 | About → Check now | "You have the latest version (0.5.0)." | 14 | **Pass** (owner, screenshot); daily check left off |
| 14 | Win + L, unlock, dictate | Shortcut still works | R5 | **Pass** (owner); mode back on hold to talk |
| 15 | (If willing) AI polish with the OpenAI preset, Professional; dictate a casual sentence | Polished text, "Polished" tag; a question in the dictation is tidied, not answered | 12 (real model) | **Fail** 7 Oct: switching polish on turned the whole window white (screenshot). Not saved (settings.json polishEnabled false). Cause, reproduced on the packaged build: `.toggle-row input` was `position: absolute` with no positioned ancestor, so it sat against the window below the page (document 2,683 px in a 700 px window); focusing it scrolled the root by 745 px. Every Settings switch did this once the page was scrolled. Fix 0ba9384: `.toggle-row { position: relative }`. Packaged build `%LOCALAPPDATA%\vocette-release\0.5.0-styles-fix` (03c876d): all 11 switches leave the window scroll at 0. Retest: switch on, page stays **Pass** (owner). 15b Test: "api.openai.com refused the key (HTTP 401)". No polish key saved, so the stored transcription key was used (apiEndpoint empty, as designed); its last successful use in History is 17 Sep. Reading: the key is no longer valid at OpenAI, and the app reported it correctly — not an app fault, unproven which. Owner pasted a current key: Test **Pass** — "Polished in 2264 ms: “This is a test of the Polish.”" Finding (cosmetic): the test sentence 'this is a test um of the polish' reads as the nationality to the model; candidate: a test sentence without "polish" in it. 15c dictation **Pass** (owner): heard "Hey, so um can you send me the report by Friday? Thanks." → cleaned "Hey, so can you send me the report by Friday? Thanks." → polished "Could you please send me the report by Friday? Thank you." (tidied, not answered); History keeps originalText; wait 2.5 s |
| 16 | Pro page | Trial days shown; Yearly/Monthly "opens soon" (no Polar links yet); "Your subscription" key field | 11, 18 | **Pass** (owner, screenshot): "Pro trial — 29 days left", Yearly/Monthly "opens soon", 3 PCs note, key field with "Licence keys can be activated once Pro purchases open." |

**Result, 7 Oct:** all 16 steps pass on the final build (`0.5.0-styles-fix`, 03c876d), after two
fixes found by the run: step 8 (cd77be1, hesitation hid a correction) and step 15 (0ba9384,
switches scrolled the window blank). Open findings, not blockers: the engine choice is not saved
after Download (step 2); the polish Test sentence contains "polish" (step 15). Left on the
owner's profile: AI polish on with their new OpenAI key; replacement `my email`; vocabulary
Kirinde, ITU-T.
