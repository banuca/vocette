// Full smoke of a packaged build (E2E_EXE): a real model download into an empty
// folder, then one dictation through the on-device engine from the Record
// button, which must reach the profile's history.json.
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { freshProfile, launchApp, sleep, AUDIO, MODELS } from './harness.mjs'

const models = MODELS
mkdirSync(models, { recursive: true })
const profile = freshProfile('smoke-full')
const audio = AUDIO
const { app, main } = await launchApp({
  profileDir: profile,
  audioFile: `${audio}%noloop`,
  extraArgs: ['--background'],
  env: { MURMUR_MODELS_DIR: models }
})
try {
  await main.waitForSelector('.app-shell', { timeout: 30_000 })
  const info = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, name: app.getName(), version: app.getVersion() }))
  console.log('running:', JSON.stringify(info), 'title:', await main.title())
  let engine = await main.evaluate(() => window.murmur.getEngineStatus())
  if (engine.model.state !== 'installed') {
    const started = Date.now()
    await main.evaluate(() => window.murmur.downloadModel())
    for (;;) {
      await sleep(1000)
      engine = await main.evaluate(() => window.murmur.getEngineStatus())
      if (engine.model.state === 'installed' || engine.model.state === 'failed' || Date.now() - started > 600_000) break
    }
    console.log('download:', engine.model.state, `${Math.round((Date.now() - started) / 1000)} s`, engine.model.error ?? '')
  } else {
    console.log('model already installed')
  }
  await main.evaluate(() => window.murmur.saveSettings({ playSounds: false, engine: 'local', vocabulary: 'Kirinde\nITU-T' }))
  await main.evaluate(() => {
    window.__s = []
    window.murmur.onWorkflowStatus((s) => window.__s.push(s))
  })
  await main.evaluate(() => window.murmur.startRecording())
  await sleep(6000)
  await main.evaluate(() => window.murmur.stopRecording())
  let final = null
  for (let i = 0; i < 600 && !final; i += 1) {
    await sleep(100)
    final = (await main.evaluate(() => window.__s)).findLast((s) => s.phase === 'success' || s.phase === 'error')
  }
  console.log('take:', final?.phase, JSON.stringify(final?.message), 'wait', final?.waitMs)
  await sleep(1500)
  const file = join(profile, 'history.json')
  const stored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
  console.log('history.json:', stored.length, JSON.stringify(stored[0]?.text), stored[0]?.model)
} finally {
  await app.close()
}
