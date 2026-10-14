// E2E harness for Vocette: launches the BUILT app (out/, after `npm run build`)
// with an isolated profile and, optionally, a WAV file as the fake microphone.
// E2E_EXE runs a packaged Vocette.exe instead. See README.md.
import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = process.env.E2E_REPO ?? join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * Where the checks keep what is not in git: profiles, screenshots, the test
 * audio, a copy of the speech model, and the stand-in Polar certificate.
 */
export const WORK = process.env.E2E_WORK ?? join(process.env.LOCALAPPDATA ?? '.', 'vocette-e2e')
export const ELECTRON = join(REPO, 'node_modules/electron/dist/electron.exe')
/** The test recording, as a Windows path for Chromium's fake capture. */
export const AUDIO = join(WORK, 'audio', 'a-itu-kirinde.wav').split('/').join('\\')
export const MODELS = join(WORK, 'models')

export function freshProfile(name) {
  const dir = join(WORK, 'profiles', name)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

export async function launchApp({ profileDir, audioFile, extraArgs = [], env = {} } = {}) {
  // E2E_EXE runs a packaged Murmur.exe instead of the development build.
  const packaged = process.env.E2E_EXE
  const args = packaged ? [] : [REPO]
  if (audioFile) {
    args.push(
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${audioFile}`
    )
  }
  args.push(...extraArgs)
  // VS Code exports ELECTRON_RUN_AS_NODE to its children; with it set,
  // electron.exe runs as plain Node and the app never starts.
  const { ELECTRON_RUN_AS_NODE: _drop, ...inherited } = process.env
  const app = await electron.launch({
    executablePath: packaged ?? ELECTRON,
    args,
    env: { ...inherited, MURMUR_PROFILE_DIR: profileDir, ...env },
    timeout: 60_000
  })
  const main = await findWindow(app, 'index.html')
  // The app writes transcripts to the real system clipboard. Keep whatever the
  // machine's owner had copied and put it back when the run ends.
  await app.evaluate(({ clipboard, nativeImage }) => {
    const image = clipboard.readImage()
    globalThis.__savedClipboard = {
      text: clipboard.readText(),
      html: clipboard.readHTML(),
      rtf: clipboard.readRTF(),
      image: image.isEmpty() ? null : image.toPNG().toString('base64')
    }
    void nativeImage
  })
  const close = app.close.bind(app)
  app.close = async () => {
    try {
      await app.evaluate(({ clipboard, nativeImage }) => {
        const saved = globalThis.__savedClipboard
        if (!saved) return
        const data = { text: saved.text, html: saved.html, rtf: saved.rtf }
        if (saved.image) data.image = nativeImage.createFromBuffer(Buffer.from(saved.image, 'base64'))
        clipboard.write(data)
      })
    } catch {
      // The app may already be gone; nothing to restore through.
    }
    await close()
  }
  return { app, main }
}

export async function findWindow(app, fragment, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    for (const page of app.windows()) {
      if (page.url().includes(fragment)) return page
    }
    if (Date.now() > deadline) throw new Error(`window ${fragment} not found`)
    await new Promise((r) => setTimeout(r, 200))
  }
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
