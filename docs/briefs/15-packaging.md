# Brief 15 — A Windows release build that is proven to work

Queue item 15 of `docs/launch-plan.md`. One commit (config + scripts + docs of the
procedure). Claude runs the build and the checks.

## Why

The engine adds a native addon and DLLs that must survive packaging; the one packaging
defect class this repository has already shipped is a native module silently left inside
the asar. `docs/delivery-report.md` also records electron-builder failing with EBUSY/EPERM
when writing into the Desktop copy of the repository on this machine. A paid build must be
produced reproducibly, outside that folder, and proven by running the packaged app.

## Deliverables

1. `scripts/release-win.mjs` (Node, no new dependencies):
   - refuses to run with uncommitted changes (prints them) unless `--allow-dirty`;
   - runs `npm run typecheck`, `npx vitest run`, `npm run lint`, `npx electron-vite build`;
   - runs electron-builder for Windows x64 with `--config.directories.output=<OUT>` where
     `<OUT>` defaults to `%USERPROFILE%\murmur-release\<version>` (outside any synced
     folder; overridable with `--out`);
   - runs `scripts/check-native-packaging.mjs <OUT>`;
   - writes `<OUT>\SHA256SUMS.txt` for every artifact (`.exe`, `.zip`, `.blockmap` if any);
   - prints the artifact list with sizes.
   - Signing is opt-in: when `WIN_CSC_LINK`/`CSC_LINK` + `CSC_KEY_PASSWORD` (PFX) are set,
     electron-builder signs as it already supports; the script prints whether the build is
     signed. Document Azure Trusted Signing (`win.azureSignOptions`) as the preferred path
     in comments and in `docs/release.md`, without enabling it.
2. `package.json` script `release:win` → `node scripts/release-win.mjs`.
3. `electron-builder.yml`: confirm `asarUnpack` covers `sherpa-onnx-*`; set
   `win.requestedExecutionLevel: asInvoker`; NSIS `deleteAppDataOnUninstall: false` (keep
   user data unless asked — say so on the website FAQ); add `nsis.license` pointing at a
   plain-text EULA placeholder `resources/eula.txt` (the website brief writes the text;
   create the file with a short interim notice and the MIT licence reference).
4. `docs/release.md`: the exact procedure (one command), what the checks prove, how to sign
   when a certificate exists, how to publish a GitHub release (manual steps; nothing in the
   script publishes), and the smoke test below.

## Smoke test Claude runs after the build (recorded in the verification table)

- Launch `<OUT>\win-unpacked\Murmur.exe` with `MURMUR_PROFILE_DIR` and `MURMUR_MODELS_DIR`
  (pre-seeded model) and fake-microphone flags; dictate the test WAV from the Record
  button; confirm the transcript appears in the profile's `history.json` — this proves the
  addon, the DLLs and the utility-process worker all load from the packaged layout.
- Launch once with an **empty** models folder and confirm the download starts and
  progresses (cancel it after a few MB).
- Installer: run the NSIS installer silently into a scratch directory
  (`/S /D=<scratch>`), launch the installed exe with an isolated profile, then uninstall
  silently; confirm nothing was written to the real `%APPDATA%\Murmur`.

## Done when

The script exists and has been run successfully once by Claude, with sizes and hashes
recorded in `docs/launch-plan.md` §7.
