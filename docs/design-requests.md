# Additional design requests

Requests made by the product owner **after** the 0.4 milestone brief was
agreed. They are recorded here so an architect review can see that they were
asked for deliberately, and are not scope the implementer invented.

Raised: 11 September 2026.

---

## 1. Light theme, with a toggle at the foot of the sidebar

**Requested:** a control at the bottom of the sidebar that switches between the
current Modern Dark theme and a light theme modelled on the Visual Studio Code
light theme.

**Why it is a change of direction.** The 0.4 brief specified "Modern Dark
default across app and overlay" from centralized CSS tokens and said nothing
about a second theme. The token layer was built for exactly this kind of
change, so the cost is in the palette and the toggle, not in a rewrite.

**Constraints it inherits from the brief.** The overlay must follow the app.
Contrast has to stay readable, focus rings visible, reduced motion respected.
The choice is a user preference and therefore belongs in the settings file with
everything else — it must survive a restart, and must not be re-derived from
the OS on every launch once the user has chosen.

**Status:** built, 11 September 2026. `theme` is settings version 5, defaulting
to `dark`; `src/renderer/theme.ts` applies it and owns the switch; the light
palette is a token block in `styles.css` and `overlay.css`; the overlay is told
the theme on its own IPC channel. Covered by `tests/theme.test.ts` and the
settings-store migration cases, and captured in six screenshots.

## 3. A more modern visual identity

**Requested:** "the design can be more modern overall… get inspiration from
Wispr Flow", with the same light-weight qualifier as the icon request.

**What was done**, 11 September 2026, after the choice between a shape-only
refinement, a new identity and a full redesign was put to the product owner,
who chose the new identity:

- Warm near-black (`#19191D`) and warm off-white (`#FBFBFA`) in place of the
  cold editor greys, with an indigo accent (`#7C6CF0` dark, `#5B4FD6` light).
- Separation by surface step and a low shadow rather than by drawn 1px lines:
  the sidebar and topbar lost their borders entirely.
- Radii up (6/10/14px, plus a pill token), pill-shaped Record, Cancel, Save and
  secondary buttons, and a rounded accent pill for the active nav item.
- More air: page padding, card padding, metric gaps, and a longer transcript
  line height.
- The overlay follows, including a rounder card.

A first pass changed only the palette and the shapes, and the product owner's
verdict was "okay, to be honest" — correctly, because colour is not design.
Three layout directions were then rendered over the real built renderer and
compared as pictures, and the chosen answer was a mix of two of them:

- **History opens with the control, not with a log.** A large round record
  button, the phase as the heading beneath it, and one line saying how to start
  a dictation on *this* desktop. The same control element is moved into the top
  bar on other pages — moved, not duplicated, so there is one set of listeners
  and two controls can never disagree.
- **The statistics stopped being furniture**: four outlined cards became four
  hairline-separated figures.
- **The transcript list lost its card**: rows light up under the pointer
  instead of sitting in a ruled table.

Three defects were found by looking at the result, none of which any test
caught: the record button kept the idle colour while recording (a transition on
a value that comes from a custom property — the same trap the overlay badge
fell into), the heading said "Ready" while the hint underneath said the API key
was missing, and an empty history repeated the same guidance twice.

Nothing here costs anything at runtime — the same number of elements, one
stylesheet, and no new dependency, font or image. The two SVG icons in the
record button are inline.

## 4. A production-grade name

**Requested:** alongside the visual refresh — "we need to think of a name that
is production grade". Four candidates were put forward with their risks;
**Murmur** was chosen.

**Done**, 11 September 2026. The rename covers the product name, the window and
tray, the installer and application id, the Linux desktop entry, the exported
history filename and the preload bridge. Trademark availability has *not* been
checked — that has to happen before anything is published.

The one part that could lose data was put to the product owner as its own
decision: renaming moves the profile folder. The chosen answer was to migrate
on first run, which `src/main/legacy-profile.ts` does under three rules — never
overwrite an existing profile, never delete the original, never throw on the
way to a window. Seven unit tests cover it, and it was exercised against the
real application with a seeded legacy profile: settings and both transcripts
arrived, the originals stayed put.

## 2. A modern icon set

**Requested:** icons from the Figma community file *Symbols — File Icons*
(`figma.com/design/HYLMyRbIdSbIJQlqnd9pSN`, node `20521-84115`), to make the
app look more modern and sleek — with the explicit qualifier that
**performance and light-weightness are of utmost importance**.

**What was supplied.** `icons` in the repository root: a single 1.3 MB SVG,
2412 × 993, containing the whole sheet flattened. Figma's export carries no
per-icon names — only `mask0_20521_84115`-style ids — so individual icons have
to be identified by position, not by name.

**What the sheet actually contains.** It was rendered and looked at, which
settled the question before any licence or file-size argument was needed: it is
a **file-type icon set** — coloured folder variants and language logos (JS, TS,
C#, Go, Rust, Vue, Svelte and so on), the kind that decorates an editor's file
tree. It holds no microphone, gear, search, copy, trash, close, info or warning
— nothing an application interface needs. It is a good set for a different job.

**What was done instead**, with the product owner's agreement: a set of eleven
icons in `src/renderer/icons.ts`, drawn on Lucide's grid — 24×24, 2px stroke,
round caps, `currentColor` — and redrawn here rather than copied from any
package. Nothing is installed, nothing is fetched at runtime, there is no icon
font and no sprite sheet, and no third-party licence attaches to the artwork.
They replace the text glyphs the interface had been using (`⌁`, `⚙`, `◌`, `⌕`,
`×`), which were drawn by whichever font each operating system happened to
resolve and so arrived at a different size, weight and baseline on each one.

One was wrong on first rendering and caught by looking: a cog simplified enough
to survive 16px loses its notched rim and becomes a circle with eight spokes —
a sun, sitting in the sidebar directly above the theme switch, which really is
one. Settings uses sliders instead.

**Status:** built, 11 September 2026. The supplied `icons` sheet is unused.
