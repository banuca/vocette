# Brief 04 — Clipboard custody, honest delivery, and "paste last dictation"

Queue item 4 of `docs/launch-plan.md`. Free. One commit.

## Why

Every competitor overwrites the clipboard and leaves the transcript there; Wispr's own
troubleshooting page says so. Users lose whatever they had copied. Murmur already does the
hard half honestly (captures the target window at take start, re-checks focus and
elevation before pasting, falls back to "Copied — paste manually"). Finish it: borrow the
clipboard, then give it back. Because a restored clipboard no longer holds the transcript,
pair it with a recovery shortcut that pastes the last dictation again.

## What the user sees

1. After an automatic paste, whatever they had copied before is back on the clipboard
   about ¾ s later. When Murmur did **not** paste (clipboard-only delivery, focus moved,
   elevated target), the transcript stays on the clipboard exactly as today.
2. Settings → Recording, a new toggle row under "Paste automatically":
   **Put my clipboard back** — "After pasting, Murmur restores what you had copied. Turn
   off to keep each transcript on the clipboard." Default on. Disabled (with the same
   capability note) when auto-paste is unavailable.
3. A global shortcut **Alt + Shift + V — Paste last dictation**, pasting the newest history
   entry into the focused window (same focus/elevation honesty as a dictation; if the
   target is elevated or cannot be verified, it copies instead and the overlay says so).
   Settings → Recording, toggle row: **Paste last dictation with Alt + Shift + V** —
   "Handy when a paste went to the wrong place." Default on. If registration fails (another
   app owns the combination), the row says "Alt + Shift + V is in use by another app."
   Do not add a tray item for it: opening the tray menu moves focus away from the target.
4. Success status text: keep "Copied to clipboard" for clipboard-only delivery; the
   automatic-paste success message becomes **"Pasted"** (it was "Copied and pasted", which
   is no longer true once the clipboard is restored).

## Design

Main process, `src/main/index.ts`:

- Add a clipboard custody helper, new module `src/main/clipboard-custody.ts`, pure logic
  behind an injectable interface so it is unit-testable without Electron, and wire it into
  the controller's deps in `createDictationController()`:

```ts
export interface ClipboardLike {
  availableFormats(): string[]
  readText(): string; readHTML(): string; readRTF(): string
  readImage(): { isEmpty(): boolean }   // NativeImage in production
  write(data: { text?: string; html?: string; rtf?: string; image?: unknown }): void
  writeText(text: string): void
}
export interface ClipboardSnapshot { text: string; html: string; rtf: string; image: unknown | null; empty: boolean }
export function takeSnapshot(clipboard: ClipboardLike): ClipboardSnapshot
export function restoreSnapshot(clipboard: ClipboardLike, snapshot: ClipboardSnapshot, ours: string): boolean
```

  `restoreSnapshot` restores only if the clipboard **still holds our transcript**
  (`readText() === ours`) — if the user or the target app changed it meanwhile, leave it
  alone and return false. An empty snapshot restores to empty (`writeText('')`) — the user
  had nothing copied, so leaving the transcript there would be a change they did not make.
  Formats other than text/html/rtf/image cannot be round-tripped through Electron's API
  (e.g. a file list copied in Explorer); in that case still restore what can be restored
  and add a code comment stating the limitation. Do not read or restore anything when the
  snapshot is not needed (clipboard-only delivery).

- `DictationDeps` (in `src/main/dictation-controller.ts`): keep `writeClipboard(text)`;
  add `snapshotClipboard(): unknown` (an opaque token) and
  `restoreClipboard(token: unknown, ours: string): void`. The snapshot must be taken
  **before** `writeClipboard`, so it holds the user's data rather than the transcript, and
  only when an automatic paste is going to be attempted (autoPaste && pasteAvailable &&
  !clipboardOnly && the restoreClipboard setting). Restructure `processTake` /
  `pasteOrExplain` accordingly; the controller owns the whole sequence.
  After `paste()`, schedule the restore `CLIPBOARD_RESTORE_MS = 750` later (named
  constant beside `PASTE_DELAY_MS`, with a comment on the race: too early and the target
  pastes the old clipboard, too late and the user's own next Ctrl+V gets the transcript).
  If paste was refused (any manual-paste message), discard the snapshot — the transcript
  must stay available. A take cancelled after the paste was injected still restores (the
  paste already happened). `shutdown()` performs any pending restore immediately rather
  than dropping it.
- `WorkflowSettings` gains `restoreClipboard: boolean`.
- Settings five-place recipe for `restoreClipboard` (default `true`) and
  `pasteLastShortcut` (default `true`), both load and save paths, with tests.

"Paste last dictation":
- Registered with Electron `globalShortcut.register('Alt+Shift+V', …)` in main when the
  setting is on and the platform is Windows (other platforms: leave unregistered for now,
  and the Settings row is hidden unless `context.platform.platform === 'windows'`).
  Re-register/unregister when the setting changes (`settings:save` handler compares
  before/after like the other settings). Track registration success; expose it to the
  renderer through `PlatformStatus`? No — keep it simple: add `pasteLastRegistered: boolean`
  to the response of a new invoke channel `shortcut:paste-last-status`, guarded by
  `fromMain(event)`, and a preload wrapper `getPasteLastStatus()`.
- Handler: if the dictation controller is busy, ignore. Take the newest
  `historyStore.list()[0]`; if none, do nothing. Otherwise run the same delivery as a
  dictation: capture foreground now, check it (elevated or unknown → write clipboard, show
  overlay status "Copied — paste manually (…)"), else snapshot (if restore on), write,
  wait `PASTE_DELAY_MS`, suppress synthetic input, `platform.paste()`, schedule restore,
  broadcast a short success status "Pasted your last dictation". Implement this as a
  controller method `pasteLast(text: string)` so it reuses `pasteOrExplain`-style checks
  and the status/reset timers, and so it is unit-testable.
- Unregister in `before-quit` (already `globalShortcut.unregisterAll()` — confirm).

## Tests

- New `tests/clipboard-custody.test.ts` with a fake `ClipboardLike`: snapshot/restore of
  text+html+rtf+image; restore skipped when clipboard changed; empty snapshot restores to
  empty; restore returns false/true correctly.
- `tests/dictation-controller.test.ts`: (a) auto-paste success → snapshot taken before the
  transcript is written, restore called with the transcript after 750 ms (fake timers);
  (b) focus moved → no snapshot/restore, transcript stays; (c) `restoreClipboard: false` →
  no snapshot; (d) clipboard-only (ui source) → no snapshot; (e) success message is
  "Pasted"; (f) `pasteLast` elevated → copy only with the manual message; (g) `pasteLast`
  while busy → ignored; (h) shutdown with a pending restore restores immediately.
- `tests/settings-store.test.ts`: both booleans default true when absent, persist false.
- Update any test asserting "Copied and pasted".

## Done when

`npm run typecheck && npx vitest run && npm run lint` pass. Do not commit. Report any
Electron clipboard API behaviour you had to assume (e.g. `write` with image) so Claude
can verify it against the running app.
