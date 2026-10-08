# Hand test: the Graphite app (Claude's notes)

Build under test: `%LOCALAPPDATA%\vocette-release\0.5.0-graphite\Vocette-0.5.0-win-x64.exe`,
branch `go-live`. Commits: de63916 colours, 469c50b theme switch, d30a97c icon and tray. It also
carries the launch offer (d9c09fe) and the Polar connection (8101885). Unsigned.

Profile backup before the reinstall: `C:\Users\KIRINDE\murmur-backups\Murmur-profile-2026-10-08-before-graphite`
(99 files, licence present). The owner's saved theme is `light`, an explicit choice, so their
window stays light until they press the moon; only a fresh profile follows Windows.

Checked before handing over: tsc, lint, 1,498 tests. In the built app: every page in light and
dark, and the overlay (recording, writing, pasted) in both themes. The switch follows the system
on a fresh profile, a press saves the choice, and it works in the packaged build. A real
dictation through the built app succeeded with the tray states changing. The tray drawing was
previewed at 16 and 32 px. **Not checked:** the tray on the real taskbar, because headless runs
cannot see it.

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Quit Vocette; uninstall it in Settings → Apps | Gone from Apps; profile kept | **Pass** 8 Oct: unregistered, folder and shortcuts gone; profile kept (licence, 1,476 entries). The stray Start shortcut to the zip and four old build folders were removed by Claude beforehand |
| 2 | Install the Graphite build | Opens in Graphite, no purple; history and Pro intact | **Pass** (owner, light and dark screenshots): 1,476 dictations, Pro, switch works. Findings: (a) in dark, the Windows title bar stays light — set `nativeTheme.themeSource` from the theme; (b) "Typical wait 2.3s", because AI polish is on and adds 2–8 s a take; (c) "Vocette" is heard as "Vaset" — add it to the owner's words |
| 3 | Look at the taskbar and tray icons | Grey bars, no tile; tray bars in the taskbar's ink | **Pass** for the tray (owner's screenshot: dark bars, no tile, bottom right). Taskbar icon not shown. Owner's notes: (d) in a narrow window the sidebar collapses to icons, which is intended, but the stats row breaks into a ragged indented column; (e) wants Ctrl + mouse wheel to zoom in and out |
| 4 | Dictate once, watching the tray | Red bars moving with the voice, then grey, then still | **Pass** (owner) — first sight of the tray on a real taskbar |
| 5 | Sun and moon switch | Switches the window and the overlay; remembered after restart | Overlay in dark: **Pass** (owner's screenshots: dark pill, red bars and mic while listening, green check when copied). "Copied — paste manually (focus moved)" was expected: the desktop was focused. Remembered after restart: **Pass** (owner: opens in dark) |
| 6 | A full day of real use | Notes on anything that feels off | Midday notes (owner): (f) with polish on, the text takes a while to come; options are on the motion page (show "Polishing", skip polish under about 8 words, faster model, a 2 s limit); (g) wants better animations, inspired by React animated components, perhaps "always there"; three options (Rise, Ripple, Island) published for a choice. Linux testing will be on the owner's own Linux machine at home |
