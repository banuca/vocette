# Brief 20: the floating pill (K10)

The owner's feedback on Rise (0.6.2, 9 Oct), dictated:
- "the bounce is pretty good": keep the spring.
- When idle, keep a floating pill that "opens up into something" and "springs up". It listens,
  then transcribes.
- Pasting stays ("should be an option, for sure"), but the pill "doesn't have to show" Pasted.
  `autoPaste` is already a setting (`src/shared/types.ts`, Settings `#auto-paste`), so no new
  setting is needed.
- "I still don't like the black background… keep it transparent."
- "transcribing and polishing have the same icon or style": polishing needs its own look.

Options page (private): https://claude.ai/artifact/MiUPpXaGC5aZsnUMrBcAfE. Source in the
session scratchpad `pill/vocette-pill.html`.

## Decisions asked (with my recommendation)

1. See-through look. **1 smoked glass** (dark tint about 58%, a fine inset edge, a soft shadow,
   a text glow) is recommended over 2 (clear glass, about 24%) and 3 (floating, no card).
   Light theme: a pale tint of about 66% with dark ink.
2. Polishing. **A**: an inverted ink badge with a sparkle, twinkling bars, a shimmer on the word
   and the running clock kept. B is a wand with a jagged line that smooths out. No new hue: the
   Graphite rule (red only while listening) holds.
3. The resting pill is **on by default**, with a Settings switch to hide it.

## Feasibility findings (why every option is a tint)

- CSS `backdrop-filter` in a transparent Electron window blurs only the page's own content, not
  the desktop or other apps. Behind the pill the page is empty, so there is nothing to blur.
- OS blur: Windows 11 `backgroundMaterial: 'acrylic'` and macOS `vibrancy` fill the whole window
  rectangle. They can't be masked to a pill that changes size, because Electron exposes no mask.
  The spring would then need animated window resizing, which is choppy on Windows.
- Unproven but likely: the DWM backdrop shows its inactive fallback on a window that never takes
  focus (ours is `focusable: false`).
- Windows 10 and Linux have no supported path.
- So: a tint, identical on all three platforms, which meets the "all platforms share
  animations" rule.

## Build order: four commits, one build, then a step-by-step hand test

1. **See-through pill.** `src/renderer/overlay.css`: card background, edge, shadow and text glow
   for dark and light.
2. **Polishing look.**
   - Add a stage field to `WorkflowStatus` (`src/shared/types.ts`), for example
     `stage?: 'transcribing' | 'polishing'`.
   - Set it in `src/main/dictation-controller.ts`: the Transcribing broadcasts at about lines 1067
     and 1089, Polishing at about line 1134.
   - The pill draws it in `overlay.ts`, `overlay.css` and `overlay.html`.
   - Don't key off the message text.
3. **Quiet success.**
   - The controller marks whether a success needs the user. "Copied — paste manually (…)" (about
     lines 917–962) does; "Pasted" (about line 1180) doesn't; nor does "Copied to clipboard" with
     auto-paste off.
   - A plain success folds back with a tick, and a needs-you success shows as now.
   - Check the paste-last flow (about lines 868–878) too.
4. **The resting pill.**
   - `src/main/index.ts`: the idle branch of `broadcastStatus` (OVERLAY_HIDE_MS and
     `overlayWindow.hide()`) keeps the window shown while the setting is on.
   - The overlay window is already `focusable: false`, `setIgnoreMouseEvents(true)` and on top at
     the `screen-saver` level.
   - `positionOverlay` runs on dictation start, as now.
   - Add the idle resting state and the open and close spring to `overlay.ts` and `overlay.css`.
     Open: width, height and a 6 px lift on `cubic-bezier(.2,1.35,.35,1)` over about 500 ms.
     Close: no bounce, about 300 ms.
   - Add the setting (`showRestingPill`, default on) to `settings-store.ts`, `types.ts` and the
     Settings page.
   - Full screen on Windows: koffi (already a dependency) calls shell32
     `SHQueryUserNotificationState`, polled about every 1 s while idle. Hide the window on
     QUNS_BUSY (2), QUNS_RUNNING_D3D_FULL_SCREEN (3) and QUNS_PRESENTATION_MODE (4).
   - Mac: no `setVisibleOnAllWorkspaces(…visibleOnFullScreen)`, so it should stay off full-screen
     Spaces. Unproven until the Mac test.
   - Linux: unproven, check on the owner's machine.

Not in this step: clicking the resting pill to start dictating (needs forwarded mouse events
and hover handling). Candidate for later.
