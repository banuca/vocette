# Milestone 0.4 — cross-platform, Modern Dark

Working plan and decision record. Status is updated as each package lands.

Baseline: branch `fix/v0.3.2-safety`, HEAD `941a4d9`, 17 test files / 206 tests
passing, with the uncommitted safety, storage, save-warning and
foreground-pointer work in the tree. All of that is preserved.

## Constraints taken as given

- Electron + TypeScript + Vite + plain DOM/CSS. No UI framework, no backend.
- One dictation controller. No second microphone owner, no second pipeline.
- Native integrations load lazily; a missing library, permission or desktop
  service must never stop the app opening.
- A changed, unknown or elevated target must prevent automatic paste. Focus is
  never forcibly restored.
- No telemetry, accounts, sync, updates or AI rewriting.

## Work packages

| # | Package | Status |
|---|---|---|
| 1 | Platform boundary + capability reporting | done |
| 2 | Toggle mode, UI Record/Stop/Cancel, cancellation | done |
| 3 | Secure key storage policy + session-only keys | done |
| 4 | Modern Dark theme, first-run guidance, accessibility | done |
| 5 | macOS and Linux (X11/Wayland) integrations | done |
| 6 | Packaging and CI for three platforms | done |
| 7 | Documentation and verification matrix | done |
| 8 | Verification: automated, visual, packaging | done |
| 9 | Guided manual checks on Windows | outstanding — needs the user |
| 10 | macOS and Linux on real hardware | outstanding — needs those machines |

## 1. Platform boundary

New `src/main/platform/`:

- `types.ts` — `CapabilityId`, `Capability`, `CapabilityMap`, `PlatformAdapter`,
  `ShortcutBackend`, `TargetTracker`. Pure types, no native imports.
- `capabilities.ts` — pure capability assembly, fully unit-testable.
- `accelerator.ts` (in `src/shared/`) — chord (libuiohook scancodes) to an
  Electron accelerator string, for backends that can only take an accelerator.
- `hook-backend.ts` — the existing `ShortcutController`, wrapped as the
  hold-capable backend (Windows, macOS, Linux/X11).
- `accelerator-backend.ts` — `globalShortcut` backend for Wayland. Press only,
  so it drives toggle recording and **never** claims hold support.
- `windows.ts`, `macos.ts`, `linux.ts` — per-OS adapters.
- `index.ts` — lazy selection, with a null-safe fallback adapter.

Capabilities reported to the renderer over guarded, typed IPC:
`globalHold`, `globalToggle`, `targetVerification`, `autoPaste`,
`launchAtLogin`, `secureKeyStorage`, `microphone`. Each carries a state
(`available` / `unavailable` / `needs-permission`), a one-sentence reason and,
where one exists, an OS settings pane the user can open.

Paste is `platform.paste()`; echo suppression stays with the shortcut backend
via `suppressSyntheticInput(ms)`, so the two stay decoupled but correct.

## 2. Recording modes and controls

- New setting `recordingMode: 'hold' | 'toggle'`, stored separately from
  capability. When the platform cannot deliver hold events the **effective**
  mode is toggle, and the stored preference is untouched, so it comes back if
  the user later moves to a session that supports holding.
- `DictationController` gains `startDictation(source)`, `stopDictation()`,
  `cancelDictation()` and `toggleDictation(source)`. `source` is `'shortcut'`
  or `'ui'`.
- A take started from the UI captures no external target and is delivered to
  the clipboard only — the focused window is Murmur itself.
- Cancellation abandons the take before transcription, zeroes the buffer and
  reports "Dictation cancelled" without an error state.

## 3. Key storage

- `safeStorage.getSelectedStorageBackend()` decides whether persistence is
  safe. `basic_text` and unavailable encryption are treated as unsuitable.
- Where persistence is unsuitable, saving a key is refused with an explanation
  and the user may instead choose an explicitly labelled **session-only** key,
  held in main-process memory, never written to disk, dropped on quit.
- `apiKeySource: 'none' | 'stored' | 'session'` replaces the boolean in the
  public settings shape. Existing `encryptedApiKey` values are untouched, so
  Windows installs keep working.

## 4. Interface

- Modern Dark by default across window and overlay, driven by tokens in
  `:root`. Segoe UI-first system stack, 13-14px interface text, monospace only
  for keycaps and technical values.
- Compact recording control in the top bar, visible on every page.
- First-run guidance that lists only what is actually outstanding (key,
  microphone, platform permissions) and clears itself as each is satisfied.
- Empty, loading, error, disabled, recording and save-failure states covered.
- Reduced motion honoured, focus visible, contrast checked at 100% and 150%.

## 5. Platform specifics

**Windows** — unchanged behaviour. The corrected pointer/BOOL/output bindings,
handle cleanup, elevation refusal and both target checks are preserved exactly.

**macOS** — Accessibility (`AXIsProcessTrusted`) and Input Monitoring
(`CGPreflightListenEventAccess`) reported and openable. Command-based paste and
Command key labels. Target verification through the Objective-C runtime
(`NSWorkspace.frontmostApplication.processIdentifier`), plus
`IsSecureEventInputEnabled()` as the macOS analogue of the elevation refusal.
Verification is application-level, not window-level; that is stated in the UI
and the docs rather than papered over.

**Linux** — X11 and Wayland are separate capability sets. X11 verifies the
target with `XGetInputFocus` through libX11 and pastes with the hook. Wayland
gets toggle-only global shortcuts through Electron's portal registration with a
correct desktop identity, no target verification, and clipboard-only delivery
with the reason shown in the UI.

## 6. Packaging

Windows NSIS + ZIP, macOS DMG + ZIP (arm64 + x64), Linux AppImage + deb.
One pipeline; per-platform icons, entitlements and metadata; signing and
notarisation configured but never invented. CI runs verify on all three and
packages on all three.

## 7. Evidence rules

Automated, native, visual and manual evidence stay separate. A mocked test or a
configured CI job is never an OS pass. macOS and Linux are never called
verified from a Windows machine. Claims that a fixed number of successful
native calls proves the absence of a handle leak are corrected: repetition can
only fail to detect a leak, and the corrected wording says exactly that.
