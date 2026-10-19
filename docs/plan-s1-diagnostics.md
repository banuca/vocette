# Plan: S1 diagnostics (Claude's notes, 19 Oct 2026)

Today: no log at all (2 console.error calls in main), no main-process crash handlers, paste
refusals only shown on the pill for 4.5 s, recorder error names thrown away, worker exit codes
ignored (Explore report, 19 Oct). Beta users (S3) can't report what they can't see, and Q3's
"first take after launch doesn't paste" can't be diagnosed.

## Design

- **Local only.** A small event log on this PC; nothing is ever sent. The user copies a report
  and pastes it into an email themselves.
- **Never in the log:** dictated text, audio, vocabulary, replacements, window titles or app
  names, API keys, licence keys, endpoints, microphone names. Events are typed records with
  fixed fields; free text is only the app's own error sentences, cut to 200 characters.
- **File:** `diagnostics.log` in the profile folder, JSON lines, last 500 events (older ones
  dropped), written in the background.

Events:
| Event | Fields |
|---|---|
| `take` | outcome (pasted / copied / failed / cancelled / empty), engine, record ms, transcribe ms, words count, paste decision + reason |
| `paste-declined` | reason: focus not verified / focus moved / elevated app / keys held |
| `mic-error` | the browser's error name (NotAllowedError, NotFoundError, …) |
| `engine-exit` | exit code, signal, while busy or idle |
| `crash` | where (main / window / worker / GPU), reason |
| `startup` | version, time to ready |

## Steps (one commit each)

1. `src/main/diagnostics-log.ts`: append, cap, read back; redaction by construction (typed
   events only). Unit tests, including a test that a take's text can't reach the log.
2. Hook the events: dictation controller outcomes and paste decisions, recorder error names,
   engine worker exits, main-process crash handlers (uncaughtException, unhandledRejection,
   render-process-gone, child-process-gone).
3. About page "Diagnostics" card: **Show diagnostics** (preview) and **Copy diagnostics**. The
   report: version, OS and build, CPU arch, memory, platform capabilities, engine and model
   state, non-personal settings (shortcut, mode, auto-paste, instant capture, language), plan,
   and the last 50 events.
4. Docs: README privacy list, SECURITY (local file, never sent), CHANGELOG.
5. Check: e2e in the built app: a failed take and a declined paste appear in the report; after a
   real take the log contains no word of its text.

## Unproven after this

- Whether it explains the intermittent first-take paste failure; that needs the owner or a beta
  user to hit it and send the report.
