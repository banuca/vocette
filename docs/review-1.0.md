# End-to-end review for 1.0 (Claude's notes, 8 October 2026)

Branch `go-live` (main + 8 commits). The owner is on the Graphite build for a test day; their
evening notes join list 1. The visual version for the owner is published as an artifact.

## Evidence gathered

- tsc and lint are clean; 1,498 tests pass; `npm audit --omit=dev` finds 0 vulnerabilities;
  there are no TODO or FIXME comments in `src`.
- First run on a fresh profile with no model (packaged Graphite build): the History page opens
  on "Get started → Download the speech model (670 MB)", with a cloud alternative.
  Screenshot: e2e/first-run.
- GitHub: `banuca/murmur` is **public**, MIT. Its latest release is "Murmur 0.4.0" (11 Sep).
  Nothing named Vocette has been pushed: main is 51 commits ahead locally, and go-live is not
  pushed.
- Polar is set up and tested end to end in test mode (see owner-launch-checklist §2).

## List 1: known fixes (test day)

- K1. In dark, the Windows title bar stays light. **Built 40c27e5**: `applyNativeTheme()` sets
  `nativeTheme.themeSource` at start-up and on every theme change. Startup test added. Built app
  checked: system → dark (moon) → light (sun). **Pass** (owner, 0.6.0, 8 Oct): the title bar is dark with the moon (screenshot).
- K2. A narrow window (rail sidebar) breaks the stats row into a ragged indented column.
  Fix: let `.stats` wrap to two or three columns.
- K3. Ctrl + mouse wheel zoom, plus Ctrl+0 to reset. Use `webContents.setZoomLevel` or Electron's
  zoom roles, kept in steps and remembered.

- K4. Polish: show "Polishing" with its own timer, and skip polish for dictations under about
  8 words. Owner agreed on 8 Oct.
- K5. Motion **A, "Rise"**, in the shared overlay so that every platform animates the same.
  Owner chose it on 8 Oct. Only the tray or menu-bar icon may differ by platform.
- K6. The publisher in Windows' Apps list should be **"Vocette"**, not "Vocette contributors".
  It comes from package.json `author`, and the same text is in electron-builder `copyright`.
  Owner note, 8 Oct.
- K7. The Apps list title should be just **"Vocette"**, not "Vocette 0.5.0". That is NSIS's
  default `uninstallDisplayName` ("${productName} ${version}"); set it to "${productName}".
  Owner note, 8 Oct.
- K8. **Updates from inside the app**: check, then "update available", then install. Use
  electron-updater with the GitHub provider (latest.yml and blockmaps are published with each
  release). Honest limit: Windows (NSIS) and Linux (AppImage) can install themselves, but the
  Mac can't until it's signed (Squirrel.Mac requires a signature), so the unsigned Mac beta
  keeps a download link. The update check stays opt-in, or follows whatever S3 decides. Needs
  its own visual plan. Owner note, 8 Oct.

- K9. **Prettify the top dashboard** on History: the microphone hero and the stats row.
  Owner note, 8 Oct: "it looks beautiful… the top dashboard section can be prettified". Needs
  visual options, and K2 (the narrow-window stats) belongs in the same redesign.

## List 2: new findings

### Must, for 1.0: these block taking money, or block saying something true

- N1. **The free word limit (10,000 words a month) is not built.** The Free/Pro split depends on
  it. The Pro page's "What stays free, forever" list still says "any length, as often as you
  like" (`licence-text.ts` FREE_FOREVER). The product.ts header says the same.
- N2. **Terms**: "up to three computers" (now 10 devices). There is no launch-offer small print
  and no word limit. The seller is never named ("we"). Contact is support@example.com.
  Governing law is assumed to be Switzerland. **Privacy and refund** pages: the support
  placeholder.
- N3. **The installer's licence text** (`resources/eula.txt`) says it is interim, to be replaced
  "before the first paid release".
- N4. **The website** is the old purple design, with US$5/US$50, "up to 3 PCs", `#` download and
  checkout links and example.com addresses. It has no theme switch, is not deployed, and
  vocette.com DNS is not set.
- N5. **Version** is 0.5.0 and should be 1.0.0, with a changelog section. The About page says
  "for Windows, macOS and Linux", but only Windows ships.
- N6. **Release channel**: rename the repo `murmur` → `vocette`, change `UPDATE_REPOSITORY` to
  match (the update check accepts only that repository's release page), push, and publish
  v1.0.0 with the installer, zip and SHA256SUMS.
- N7. **Polar is still in test mode.** Owner tasks: Settings → country, website, support email;
  payouts and identity; the EU withdrawal checkbox (custom field) on both products; the refund
  sentence in the product descriptions.
- N8. **There is no support address.** Proposal: support@vocette.com, forwarded at the registrar.

### Should: these affect conversion or retention

- S1. **Unsigned installer**: SmartScreen blocks every first download ("Windows protected your
  PC"). This is the largest conversion leak. Start signing now, since validation takes days.
  Check Azure Trusted Signing eligibility from Switzerland, or an OV certificate.
- S2. **Launch at login is off by default.** A dictation tool that isn't running is not used.
  Proposal: on by default, said on the first-run card.
- S3. **The update check is off by default**, so users never hear of fixes or the Mac version.
  Proposal: ask once, on the first-run card. It is a privacy decision for the owner.
- S4. Choosing "On this PC" and pressing Download does not switch the engine until Save
  settings. This is the 0.5.0 hand-test step 2 finding. It affects switchers from cloud.
- S5. The tray shows "writing" while the microphone is starting; it should show listening.
  `setTrayState` maps `starting` to writing.
- S6. The default language is English. For non-English users of the 25 languages, Automatic
  may suit better. Decide.

### Later

- L1. Mac version: a DMG from vocette.com, built on GitHub Actions, tested by the brother.
- L2. Diagnostics for support: a "Copy diagnostics" button (version, platform, non-secret
  settings, last errors). Today there are no logs at all.
- L3. Friends link and code (ready; waits for the Mac version).

## List 3: observations

- O1. **Open source and Pro.** MIT and a public repo mean anyone can build without the Pro
  checks. Open source is what makes the privacy promise checkable. Recommendation: stay
  public, and treat Pro as what heavy users choose to pay for.
- O2. **Money per payment.** Prices include VAT for EU and Swiss buyers. For a Swiss card: US$3.74 monthly →
  VAT US$0.28, Polar US$0.63 (4% + 40¢ + 0.5% + 1.5% non-US) → about **US$2.84** to the owner;
  US$24.50 yearly → VAT US$1.84, Polar US$1.87 → about **US$20.79**. Payouts cost extra.
  "Polar Plans" (the dashboard banner) may lower the fee; check it once volume exists.
- O3. **Measuring.** Only GitHub download counts and Polar sales exist. Optional:
  privacy-friendly analytics on the website only.
- O4. **Timing.** The 30-day trial means natural conversions start about 30 days after launch;
  the launch offer is what brings sales earlier.
- O5. **Trade mark** not cleared: a risk before spending on the brand.
- O6. **AI polish** adds 2 to 8 s a take, which shows in "Typical wait". Say so on the toggle.

## Proposed 1.0 sequence

1. The owner's notes, K1–K3 and S2–S5, one at a time, each tested.
2. N1, the free word limit (plan → build → hand test).
3. N2/N3/N5 copy: terms, EULA, About, version 1.0.0, changelog.
4. N4, the website in Graphite.
5. N6, release 1.0: rename, push, publish, site live on vocette.com.

The owner in parallel: N7, N8, S1, and the legal name and address for the terms.
