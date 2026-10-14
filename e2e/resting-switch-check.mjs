// K10 step 4, the Settings switch in the built app: drawn, on by default, and
// switching it off then Save takes the pill away; on then Save brings it back.
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { freshProfile, launchApp, sleep, WORK } from './harness.mjs'

const shots = join(WORK, 'pill')
mkdirSync(shots, { recursive: true })
const { app, main } = await launchApp({ profileDir: freshProfile('resting-switch') })
const visible = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('overlay.html'))
      ?.isVisible()
  )
try {
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  await main.click('[data-page="settings"]')
  const row = main.locator('label.toggle-row', { has: main.locator('#resting-pill') })
  await row.waitFor({ timeout: 10_000 })
  await row.scrollIntoViewIfNeeded()
  console.log('row text:', JSON.stringify(await row.innerText()))
  console.log('checked by default:', await main.isChecked('#resting-pill'), '| pill visible:', await visible())
  await row.screenshot({ path: join(shots, '14-settings-switch.png') })
  await row.click()
  await main.click('#save-settings')
  await sleep(600)
  console.log('after off + Save: checked', await main.isChecked('#resting-pill'), '| pill visible:', await visible(),
    '| stored:', await main.evaluate(async () => (await window.murmur.getSettings()).restingPill))
  await row.click()
  await main.click('#save-settings')
  await sleep(600)
  console.log('after on + Save: checked', await main.isChecked('#resting-pill'), '| pill visible:', await visible(),
    '| stored:', await main.evaluate(async () => (await window.murmur.getSettings()).restingPill))
} finally {
  await app.close()
}
