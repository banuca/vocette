# Ideas parked (Claude's notes)

Owner's thoughts, not decisions. Discuss after the 0.6.6/0.6.7 hand test; don't build yet.

## 15 Oct 2026

- **I1: Settings split into Basic and Advanced.** Basic shows what most people touch; Advanced
  holds the rest (engine, models, prompts, and so on). Needs a list of which setting goes where.
- **I2: First-run choice of a simple or developer layout.** Onboarding asks which kind of user
  they are (wording to be decided) and the app renders a simpler or fuller layout from that.
  Probably builds on I1: the choice sets whether Advanced is shown by default. Open questions:
  can they switch later (Settings), and what exactly differs besides Settings?
- **I3 (16 Oct): drop the words on the open pill, use icons.** Words today come from
  `dictation-controller.ts` ("Listening…", "Transcribing…", "Polishing…"); the pill's bars
  already animate differently per phase (`overlay.css`). Claude's view: icons only, but keep
  each word as the accessible name (screen readers) and as a hover tooltip; consider showing
  the words for the first few dictations, then icons. Error states keep words: an icon can't
  say what went wrong.
- Owner reports the app has been good in daily use since 14 Oct (engine: cloud, per
  settings.json on 15 Oct).
