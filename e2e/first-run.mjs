// What a brand-new user sees: the packaged Graphite build, an empty profile and
// no speech model. Screenshots of the first window and the pages it points to.
import { join } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { freshProfile, launchApp, sleep, WORK } from './harness.mjs'

const shots = join(WORK, 'first-run')
mkdirSync(shots, { recursive: true })
const models = join(WORK, 'empty-models')
rmSync(models, { recursive: true, force: true })
mkdirSync(models, { recursive: true })
const { app, main } = await launchApp({
  profileDir: freshProfile('first-run'),
  env: { MURMUR_MODELS_DIR: models }
})
try {
  await main.waitForSelector('.app-shell', { timeout: 30_000 })
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.setContentSize(1060, 760)
    win?.show()
  })
  await sleep(1200)
  await main.screenshot({ path: join(shots, '1-first-window.png') })
  const text = await main.evaluate(() => document.querySelector('.main-panel')?.innerText.slice(0, 900))
  console.log('first window says:\n' + text)
  const engine = await main.evaluate(() => window.murmur.getEngineStatus())
  console.log('engine:', JSON.stringify({ ready: engine.ready, reason: engine.notReadyReason, model: engine.model.state }))
  await main.evaluate(() => document.querySelector('[data-page="settings"]')?.click())
  await sleep(800)
  await main.screenshot({ path: join(shots, '2-settings.png') })
  await main.evaluate(() => document.querySelector('[data-page="pro"]')?.click())
  await sleep(800)
  await main.screenshot({ path: join(shots, '3-pro.png') })
} finally {
  await app.close()
}
