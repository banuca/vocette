# Releasing Vocette

One command builds the release and proves the native parts survived packaging:

```
npm run release:win
```

Run it on Windows x64 from a clean checkout of the commit you mean to release.

## What it does

1. **Refuses uncommitted changes** to tracked files and prints them. Untracked files are
   not part of the build and are ignored. `--allow-dirty` builds anyway; never release
   such a build.
2. **The gates**: `npm run typecheck`, `npx vitest run`, `npm run lint`,
   `npx electron-vite build`. The first failure stops everything.
3. **Packages** with electron-builder for Windows x64 into
   `%LOCALAPPDATA%\vocette-release\<version>` (or `--out <folder>`). Not the repository:
   inside the synced Desktop electron-builder fails with `EBUSY`/`EPERM`, and on the
   development machine it also fails renaming its fresh extraction under `%USERPROFILE%`.
4. **Checks the native packaging** (`scripts/check-native-packaging.mjs`): koffi,
   uiohook-napi, the speech engine addon and its ONNX Runtime DLLs must be outside
   `app.asar`. Each has shipped, or nearly shipped, packed inside the archive, where the
   app starts but silently loses the shortcut, the paste checks or on-device dictation.
5. **Writes `SHA256SUMS.txt`** for the installer, the zip and the blockmap, and lists the
   artifacts with their sizes.

Output: `Vocette-<version>-win-x64.exe` (NSIS installer, per user, no administrator
rights), `Vocette-<version>-win-x64.zip` (portable) and `win-unpacked\`.

## Signing

Unsigned builds work, but Windows SmartScreen warns on download until the file has earned
reputation. Two ways to sign:

- **Azure Trusted Signing** (recommended for a new publisher: no hardware token, and the
  certificate is renewed for you). Uncomment `win.azureSignOptions` in
  `electron-builder.yml`, fill in the account and profile names, and set
  `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` for an app registration
  allowed to sign with that profile.
- **A PFX certificate**: set `WIN_CSC_LINK` (or `CSC_LINK`) to the `.pfx` file and
  `CSC_KEY_PASSWORD` to its password. electron-builder signs the installer, the
  uninstaller and `Vocette.exe`.

The script prints whether the build it made is signed. Check afterwards with
`Get-AuthenticodeSignature <file>` in PowerShell.

## Publishing (from a tag; a person publishes)

1. Bump `version` in `package.json` (`npm version <version> --no-git-tag-version`), move
   the `Unreleased` changelog section under the new version and date, and commit.
2. Tag that commit `v<version>` and push the tag. CI builds Windows, macOS (Apple silicon)
   and Linux, runs the packaging, signature and engine checks, and the `release` job puts
   every file plus `SHA256SUMS.txt` into a **draft** release, with the changelog section as
   its notes. A draft is invisible to the public and to the updater.
3. Check the draft: every platform's files are there, the `.yml` files name the right
   version, and the hashes match the CI log. Run the smoke test below on the Windows build.
4. Publish the draft. A version with a hyphen (`0.8.0-beta.1`) is published as a
   pre-release.

What the updater reads (electron-updater, GitHub provider):

- The `.yml` files and `.blockmap`s in the release. Without them no installed copy can
  update; v0.4.0 was published without them.
- A stable version reads `/releases/latest`, which is never a pre-release or a draft.
- A `-beta.N` version is offered the newest beta or stable release. Do not use `-rc.N`:
  electron-updater treats `rc` as a custom channel and would never offer the stable release.
- Tags that are not versions (`model-parakeet-v3-q8-2`) are ignored.
- macOS: no self-update until the app has a Developer ID; testers download the new DMG.

`npm run release:win` still builds a Windows release locally with the same gates, for
checking a build before tagging.

## Smoke test after every build

Run with an isolated profile, so nothing touches your own settings or startup entries:

- **Packaged app**: launch `win-unpacked\Vocette.exe` with `MURMUR_PROFILE_DIR` set to a
  scratch folder, `MURMUR_MODELS_DIR` set to a folder holding the downloaded model, and the
  fake-microphone flags (`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream
  --use-file-for-fake-audio-capture=<wav>`). Record from the window. The transcript must
  reach the profile's `history.json`: that proves the addon, the DLLs and the engine's
  utility process all load from the packaged layout.
- **First run**: launch once with an empty `MURMUR_MODELS_DIR`, press **Download**, see it
  progress, cancel after a few megabytes.
- **Installer**: back up `%APPDATA%\Murmur`, install silently into a scratch folder
  (`Vocette-<version>-win-x64.exe /S /D=<scratch>`), launch the installed `Vocette.exe` with
  an isolated profile, uninstall silently (`"<scratch>\Uninstall Vocette.exe" /S`), and
  confirm `%APPDATA%\Murmur` is unchanged. Uninstalling keeps user data by design
  (`deleteAppDataOnUninstall: false`).
