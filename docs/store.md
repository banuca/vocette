# The Microsoft Store build (MSIX)

Why: the unsigned NSIS installer shows "Windows protected your PC". Artifact (Trusted) Signing is
closed to an individual in Switzerland. The Store signs MSIX packages for free, and a Store install
shows no SmartScreen warning. Spike of 30 Oct 2026, branch `msix-spike`.

## Verdict

**Go, on one condition: the app has to be published from a Company account.** Technically the
package installs, starts, starts with Windows and transcribes inside the package (CI, below). Policy
allows our own checkout. But Store Policy 10.14 puts anyone selling "in relation to their trade" on a
Company account, which needs a D-U-N-S number or official business registration documents.

**Proved by CI** on Windows Server 2025 (build 26100), run
<https://github.com/banuca/vocette/actions/runs/41061473258>, job "Store package":
signed with a throwaway certificate and installed; started through its AUMID as the Start menu does,
running from `C:\Program Files\WindowsApps\…`; its settings written to the package's private AppData
and not the real one; startup finished; startup task switched on (State 2) and, with the setting
off, off (State 0) by the app itself; a second start handed over to the first; through the
`vocette` alias, running as the package, the full 935 MB model written to the package's private
AppData and both test recordings transcribed correctly; uninstalling removed the app, the alias and
all its data, model included.

## Policy (Microsoft Store Policies 7.20, effective 22 Oct 2026)

Source: <https://learn.microsoft.com/windows/apps/publish/store-policies>

| Question | Answer | Policy |
|---|---|---|
| Can a non-game PC app take payment through its own checkout (Polar)? | Yes, for in-app digital items and for subscriptions | 10.8.1, 10.8.6 |
| Conditions | Name the payment provider, authenticate the user and get their confirmation; PCI DSS for whoever takes the card (Polar's checkout, not re-checked here); a browser after install is fine; **say in Partner Center that a third-party purchase API is used** | 10.8.2 |
| Licence keys | Allowed: nothing restricts how a non-game unlocks what was bought outside | 10.8.1 |
| Listing must state | The kinds of purchase and the price range, and the trial's terms (our 30-day Pro trial) | 10.8.4 |
| Individual account | Free, ID + selfie. "Usually appropriate for a single developer working on their own"; meant for distribution "not in relation to their business, trade, or profession" | 10.14; [open-a-developer-account](https://learn.microsoft.com/windows/apps/publish/partner-center/open-a-developer-account) |
| Company account | Required for "any person acting in relation to their trade or profession", or when a publisher name reads as a business ("Vocette" does). Free; needs a D-U-N-S number **or** a business registration/registry record, plus a work email on the company's domain. Can't convert Individual → Company later | 10.14; same page, Company tab |
| API keys | "API secret keys" count as financial information, which an Individual account's app can't *require* for primary functionality. Ours is optional (on-device is the default), so this alone doesn't force a Company account | 10.8.3 |
| Privacy policy URL | Required for every Win32/Desktop Bridge app | 10.5.1 |
| `runFullTrust` | A restricted capability: explain its use on the submission's Submission options page | [capabilities](https://learn.microsoft.com/windows/apps/package-and-deploy/app-capability-declarations#restricted-capabilities) |

What Partner Center gives the package (Product management → Product identity): `Package/Identity/Name`,
`Package/Identity/Publisher` and `Package/Properties/PublisherDisplayName`
([view-app-identity-details](https://learn.microsoft.com/windows/apps/publish/view-app-identity-details)).
The display name must be a name reserved for the app.

**Version:** the Store refuses a first version number of 0 and reserves the fourth
([package requirements](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/app-package-requirements#package-version-numbering)).
electron-builder writes `0.8.0-beta.1` as `0.8.0.0`, so the first submittable build is 1.0.0. A
beta and its release share a number (`1.1.0-beta.1` and `1.1.0` are both `1.1.0.0`): only submit
releases.

## How each part fits

| Part | In the Store package | Proof |
|---|---|---|
| Keyboard hook (uiohook-napi), paste (SendInput), foreground checks (koffi) | Unchanged: `runFullTrust` runs at medium integrity, outside an app container, and Microsoft's packaging checklist lists no limit on hooks or input injection ([prepare to package](https://learn.microsoft.com/windows/msix/desktop/desktop-to-uwp-prepare)) | koffi works inside the package (CI: it drives the startup task); the hook and a real hold-to-talk with paste are **unproven** |
| Microphone | `<DeviceCapability Name="microphone"/>` lists Vocette in Settings → Privacy → Microphone from install | **Unproven**: the runner has no microphone |
| Start with Windows | The HKCU Run key would go to the package's private registry, which sign-in never reads. The manifest declares startup task `VocetteStartup` (off, `--background`), switched by the app through the StartupTask API (`src/main/platform/startup-task.ts`). If the user turns it off in Settings → Apps → Startup the app can't turn it back on, and the toggle says so | CI: on with the setting on, off with it off |
| Model download (935 MB) | `%LOCALAPPDATA%\Murmur\models` is redirected to `%LOCALAPPDATA%\Packages\<family>\LocalCache\Local\Murmur\models`, invisible to other apps and deleted on uninstall. Per Microsoft's docs, a model an installer copy already downloaded is read in place, not copied ([behind the scenes](https://learn.microsoft.com/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)) | CI: the full model, written inside the package, lands there, transcribes, and goes with the uninstall. The app's own download code was not run (the file copy stands in for it); reading an installer copy's model is **unproven** |
| Settings and history | Same redirection, under `LocalCache\Roaming\Murmur` | CI |
| Updates | electron-updater is never loaded and GitHub is never asked; About says "The Microsoft Store keeps Vocette up to date." | Unit tests; not looked at in the window |
| Opt-in counts | Unchanged: a full-trust app has the network | Not separately tested |
| Single instance | The lock is keyed on the profile path, which reads the same inside the package | CI: a second start hands over |

The runtime switch is `process.windowsStore`, which Electron sets for a process running from an MSIX
package (`src/main/distribution.ts`).

## Build it

```sh
npm run build          # typecheck, tests, electron-vite
npm run pack:store     # dist/Vocette-<version>-store-x64.appx, unsigned
```

The `appx` section of `electron-builder.yml` holds three **placeholders** (`REPLACE-ME…`) for the
Partner Center values, and `displayName: Vocette` must be a reserved name. Upload the unsigned
`.appx`; the Store signs it.

**Never install a self-signed certificate or turn on Developer Mode on your own PC to try the
package.** CI does that on a throwaway runner: `scripts/store-smoke.ps1` signs the package with a
certificate it makes there, installs it, starts it through its AUMID, checks the points above, runs
the engine through the package's `vocette` alias (the supported way to run a packaged executable
with arguments), then uninstalls. It refuses to run outside GitHub Actions.

## What the owner does

1. Get what a Company account verifies: a D-U-N-S number (issued by Dun & Bradstreet) or an
   official business document, such as a commercial-register extract, and an email address on the
   vocette.com domain. How a Swiss sole proprietor gets either is **not verified** here: ask a
   fiduciary or the cantonal commercial register.
2. At <https://storedeveloper.microsoft.com>: Get started → **Company account** → sign in → enter
   the D-U-N-S number or upload the document → contact details with the vocette.com address →
   accept the agreement → wait for verification (automatic, or 2–5 working days).
3. Partner Center → Apps and games → New product → MSIX or PWA app → reserve **Vocette**.
4. The app → Product management → Product identity: copy Package/Identity/Name,
   Package/Identity/Publisher and Package/Properties/PublisherDisplayName to the engineer, for the
   `appx` section of `electron-builder.yml`.
5. First submission, from version 1.0.0: Pricing and availability → Free; Properties → category
   Productivity and the privacy policy URL; Age ratings questionnaire; Packages → the `.appx` from
   `npm run pack:store`; Store listing → description saying Pro is US$4.99 a month or US$49 a year
   (or the new price) with a 30-day trial, plus screenshots; Submission options → why
   `runFullTrust` is needed (global shortcut, paste into the focused app, on-device speech engine),
   and in Notes for certification that purchases use a third-party provider (Polar) in the browser.
   Then Submit for certification.

## Not done or not known

- Store certification has not been tried; it needs the account and the real identity.
- A hand test on a real Windows 10/11 PC from a Store (or flighted) install: hold-to-talk, paste
  into another app, the microphone prompt, start at sign-in in the tray. CI ran on Windows Server.
- The About page and the first-run card still show the "check for updates" switch in the Store
  build; the switch does nothing there and the line under it says why. Hiding it is a UI change
  (mock-up first).
- Counts can't tell a Store install from an installer one; Partner Center's own acquisitions report
  covers the Store.
- Proper Store artwork (tiles are the app icon, centred; the listing needs screenshots and a logo).
