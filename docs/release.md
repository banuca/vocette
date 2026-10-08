# Releasing Vocette for Windows

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

## Publishing (manual; nothing here publishes)

1. Bump `version` in `package.json`, move the `Unreleased` changelog section under the new
   version and date, commit, and tag it: `git tag v<version>`.
2. `npm run release:win` on that commit.
3. Run the smoke test below on the result.
4. On GitHub, draft a release for the tag (`https://github.com/banuca/vocette/releases/new`),
   attach the `.exe`, the `.zip` and `SHA256SUMS.txt`, paste the changelog section, and
   publish. The update check in the app reads this repository's latest published release:
   the tag must be the version (`v0.5.0`), and drafts and pre-releases are not offered.

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
