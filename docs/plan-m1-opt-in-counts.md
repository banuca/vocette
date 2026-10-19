# Plan: M1 opt-in counts (Claude's notes, 19 Oct 2026)

Decision M (owner, 16 Oct, `docs/research/mrr-gap-2026-10-16.md`): opt-in, counts only, asked on
the first-run card, default off, saying no sends nothing, copy says exactly what is sent.

## Design: no identifier at all

Each report is computed on the PC and carries no install ID, no IP stored, no words, no audio,
no app names. Retention is answered by fields the PC computes about itself, not by joining
reports on the server.

At most one POST a day, only if switched on:

| Field | Example | Answers |
|---|---|---|
| `v` | `0.8.0` | which version |
| `os` | `windows` / `macos` / `linux` | platform split |
| `engine` | `local` / `cloud` | which engine people keep |
| `plan` | `free` / `trial` / `pro` | conversion |
| `week` | 0–12, capped (`12` = 12+) | weeks since this install's first run |
| `activeDays7` | 0–7 | retention: days with ≥1 dictation in the last 7 |
| `dictations7` | 0–999, capped | usage depth |
| `limitHit` | true/false | reached the free monthly limit this month |

S3's pass ("dictates on ≥4 of 7 days in week 2") = reports with `week = 1` and
`activeDays7 ≥ 4`. Funnel: reports by `week`, `plan`, `limitHit`.

Locally kept (in settings, never sent as a list): first-run date, the last 7 days' dictation
counts, last report date. The report is built only from these.

## Steps (one commit each, tested; one hand test at the RC)

1. **Local tally.** `src/main/usage-counts.ts`: record a dictation (date only), roll the 7-day
   window, build the report. Settings: `usageCounts` (default false), `firstRunDay`,
   `recentDays`, `lastReportDay`. Unit tests.
2. **Sender.** Same shape as the update check (`update-check.ts`): first attempt 60 s after
   start, then due-check hourly, sends when a day has passed; 10 s timeout; failure just waits
   for the next day; Electron `net.fetch`; no cookies. Endpoint fixed in code. Dev builds send
   to `MURMUR_COUNTS_URL` only, never production.
3. **Ask.** First-run card: third row "Help improve Vocette", unticked. About page: the same
   switch, plus "Show what is sent", which displays the exact JSON of the next report.
   Existing installs (card already answered) are never asked; About only.
4. **Server.** `server/counts/`: a Cloudflare Worker that accepts that exact shape (rejects
   anything else), adds the UTC day, writes one row to a D1 table, stores no IP or headers.
   A read-only query script for the owner. Free tier covers it (100k requests/day).
5. **Copy.** README, SECURITY.md (network request list), About text, CHANGELOG. Site privacy
   page is the website session's: send it the wording.
6. **Check.** e2e: dev build with a local mock endpoint: off sends nothing (zero requests over
   a forced day change); on sends one report matching "Show what is sent". Worker tested with
   its own unit tests and one real POST after deploy.

## Owner's part

- Create a free Cloudflare account and run one sign-in command (`npx wrangler login`) when I
  get to step 4; I deploy with it. Or pick another host.
- Approve the wording of the card row and the About text (in the RC hand test).

## Choices for the owner (recommendations first)

- **No ID (recommended)** vs a random install ID: an ID allows exact cohorts but is a
  pseudonymous identifier and weakens "nothing about you".
- **Cloudflare Workers + D1 (recommended)**: free, no server to run. Alternatives: Supabase,
  a Polar-adjacent service (none fit), self-hosted.
- **URL:** `counts.vocette.com` needs vocette.com's DNS on Cloudflare; until then the
  `*.workers.dev` address. A URL baked into a release can't move later without an update, so
  prefer deciding the domain before 0.8.0 ships.

## Unproven after this

- Real numbers only arrive after the beta (S3); the opt-in rate decides how useful they are.
