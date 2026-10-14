// S4 in the built app: a cloud user picks "On this PC" in Settings and presses
// Download. The engine is saved there and then, without Save settings, and an
// unsaved switch elsewhere on the page keeps its unsaved value. The download
// goes to an empty folder and is cancelled at once.
import { join } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { freshProfile, launchApp, sleep, WORK } from './harness.mjs'

const models = join(WORK, 'empty-models-s4')
rmSync(models, { recursive: true, force: true })
mkdirSync(models, { recursive: true })
const { app, main } = await launchApp({
  profileDir: freshProfile('engine-download'),
  extraArgs: ['--background'],
  env: { MURMUR_MODELS_DIR: models }
})
try {
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  await main.evaluate(() => window.murmur.saveSettings({ engine: 'cloud', playSounds: true }))
  // The window read its settings at start-up: reload it so it opens as a cloud user's would.
  await main.reload()
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  await main.evaluate(() => document.querySelector('[data-page="settings"]')?.click())
  await main.waitForSelector('#engine-local', { state: 'attached' })
  const before = await main.evaluate(() => window.murmur.getSettings())
  console.log('saved engine before:', before.engine)

  // An unsaved edit elsewhere on the page, then this PC, then Download.
  await main.evaluate(() => {
    const sounds = document.querySelector('#play-sounds')
    sounds.checked = false
    const local = document.querySelector('#engine-local')
    local.checked = true
    local.dispatchEvent(new Event('change'))
  })
  await main.waitForSelector('#model-row [data-model="download"]:not([hidden])', { state: 'attached' })
  // A click in the page: the window runs hidden (--background), so nothing is "visible".
  await main.evaluate(() => document.querySelector('#model-row [data-model="download"]').click())
  await sleep(1500)
  const after = await main.evaluate(() => window.murmur.getSettings())
  const page = await main.evaluate(() => ({
    localChecked: document.querySelector('#engine-local').checked,
    soundsChecked: document.querySelector('#play-sounds').checked,
    badge: document.querySelector('#model-row [data-model="badge"]')?.textContent
  }))
  console.log('saved engine after Download:', after.engine)
  console.log('saved playSounds (unsaved edit must not be saved):', after.playSounds)
  console.log('page:', JSON.stringify(page))
  await main.evaluate(() => window.murmur.cancelModelDownload())
  await sleep(500)
  const ok =
    before.engine === 'cloud' &&
    after.engine === 'local' &&
    after.playSounds === true &&
    page.localChecked &&
    page.soundsChecked === false
  console.log(ok ? 'PASS' : 'FAIL')
} finally {
  await app.close()
  rmSync(models, { recursive: true, force: true })
}
