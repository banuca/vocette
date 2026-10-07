# Brief 14 — An update check you switch on, see, and can refuse

Queue item 14 of `docs/launch-plan.md`. Free. One commit.

## Why

A paid desktop app you can never patch is a liability, but README, SECURITY.md and
CONTRIBUTING.md promise "no auto-update calls". Keep the promise's spirit: nothing happens
unless the user turns it on, the request is stated exactly, and nothing is downloaded or
installed automatically.

## What the user sees

About page, new section **Updates**:

- Toggle **Check for updates once a day** (default **off**). Under it: "Sends one request
  to GitHub (api.github.com) asking for the latest Murmur version. Nothing about you or
  your dictation is sent. Murmur never downloads or installs anything by itself."
- **Check now** button (works whether or not the toggle is on) and a result line: "You have
  the latest version (0.5.0)." / "Murmur 0.6.0 is available — Download" (opens the release
  page in the browser) / the error sentence.
- When a daily check finds a newer version: one line in the tray menu ("Update available:
  0.6.0 — open download page") and a small dot on the About nav item. No dialogs, no
  notifications.

## Design

- `src/main/update-check.ts`: injectable fetch (Electron `net.fetch`); `GET
  https://api.github.com/repos/<owner>/<repo>/releases/latest` with headers `Accept:
  application/vnd.github+json` and `User-Agent: Murmur/<version>`, 10 s timeout; read only
  `tag_name` and `html_url`; ignore drafts/prereleases (the endpoint already does). Compare
  with a small semver comparison (`v` prefix tolerated, pre-release tags sort lower).
  Repository coordinates come from `src/shared/product.ts` (`UPDATE_REPOSITORY =
  'banuca/murmur'`, owner to confirm after the rename). `html_url` must start with
  `https://github.com/<repo>/releases/` or it is ignored.
- Settings field `updateCheck: boolean` (default false, both paths, tests) and a stored
  `lastUpdateCheckAt` (not public).
- Scheduling: when on, check 60 s after startup if the last check is older than 24 h, then
  every 24 h while running. Never more than once per 24 h automatically.
- IPC: `update:check-now`, `update:status` (fromMain-guarded); broadcast `update:status`.
  Allow-list the release page opening via `app:open-external` target `'release'` that
  resolves to the last validated `html_url` only.
- Docs are changed in 16, not here — but add a `CHANGELOG.md` line.

## Tests

`tests/update-check.test.ts`: newer/equal/older comparisons incl. `v` prefix and
pre-release; invalid `html_url` ignored; network error sentence; no request when off except
Check now; 24 h throttle with fake timers.

## Done when

`npm run typecheck && npx vitest run && npm run lint` pass. Do not commit.
