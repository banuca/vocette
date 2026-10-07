# Brief 16 — Documents that tell the truth about the product that now exists

Queue item 16 of `docs/launch-plan.md`. One commit. Written last, from the built product
and the verification record, never from the plan.

## Files

- `README.md` — rewrite the opening for the product: on-device by default (no key, no
  account, works with Wi-Fi off once the model is downloaded), own-key cloud optional; what
  is free forever vs Pro (from `src/shared/product.ts`, not retyped by hand where avoidable);
  install (unsigned-build warning stays until signing exists); first run (model download
  size); the settings table updated for every new setting; privacy section listing every
  network request the app can make (below); build from source; licence. Keep the honest
  platform matrix: only Windows verified.
- `SECURITY.md` — the complete network ledger, stated as facts:
  1. Model download, once, from `huggingface.co` (pinned commit, SHA-256 verified), when the
     user presses Download.
  2. Licence activation / release, only when the user presses the button, to `api.polar.sh`,
     carrying the key and a device label ("Murmur on Windows · 7F3A"); response personal data
     discarded.
  3. Update check, only if switched on or "Check now" is pressed, to `api.github.com`.
  4. Cloud transcription and AI polish, only if configured, to the endpoint the user chose,
     carrying audio (transcription) or text (polish) and the vocabulary.
  Nothing else: no telemetry, no analytics, no crash reporting. Where the licence key is
  stored (encrypted when OS storage allows, otherwise plain — it is an entitlement token,
  not a credential). Where the model is stored (`%LOCALAPPDATA%\Murmur\models`).
- `CONTRIBUTING.md` — add a Developer Certificate of Origin section (sign-off with
  `git commit -s`), replace any sentence promising "no update calls" with the opt-in rule.
- `docs/platform-support.md` — add the on-device engine row: Windows x64 verified; macOS and
  Linux have prebuilt addons but have never been run.
- `CHANGELOG.md` — turn `[Unreleased]` into `[0.5.0] — <date>` with a short summary line;
  bump `package.json` to 0.5.0.
- `LICENSE` — copyright line currently says "Voice Hotkey contributors" while the package
  says "Murmur contributors": align to "Murmur contributors" and flag the legal holder
  question to the owner (it may need to be the owner's name or company).
- `scripts/rename-product.mjs` — `node scripts/rename-product.mjs "<New Name>" <new-app-id>
  [--dry-run]`: replaces the display name in user-visible strings (src/**/*.ts, *.html,
  electron-builder.yml productName/shortcutName/desktop entry, package.json productName and
  description, README/SECURITY/site), leaves `window.murmur`, `MURMUR_*` env vars, internal
  identifiers and `app.setName('Murmur')` (the profile folder must not move; the existing
  legacy-profile migration already handles a future move) untouched, updates `appId`, prints
  every change, and refuses to run on a dirty tree. With a `--dry-run` test in `tests/`.
- `docs/owner-launch-checklist.md` — the owner's steps in order, each with the exact click
  path (merchant account, product, licence-key benefit with activation limit 3, checkout
  link, required checkbox custom field for the EU withdrawal acknowledgement, refund policy
  text, paste ids into `product.ts`, domain, GitHub Pages, signing certificate, IP
  confirmation).

## Done when

Every claim in README/SECURITY is backed by a row in the verification record or by code
Claude has read; `npm run typecheck && npx vitest run && npm run lint` pass.
