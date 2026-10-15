// S2 and S3 in the built app: on a fresh profile the first-run card asks
// once — Start Vocette with Windows (ticked, already on) and Tell me when
// there's a new version (ticked). Untick the update check, press Done: both
// are saved, the card goes, and it does not come back after a restart.
// The profile is isolated, so the real start-up entry is never touched.
import { join } from 'node:path'
import { mkdirSync, readFileSync } from 'node:fs'
import { WORK, freshProfile, launchApp, sleep } from './harness.mjs'

const shots = join(WORK, 'welcome')
mkdirSync(shots, { recursive: true })
const profileDir = freshProfile('welcome')
let ok = true
const expect = (label, actual, wanted) => {
  const pass = typeof wanted === 'function' ? wanted(actual) : actual === wanted
  if (!pass) ok = false
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
}

{
  const { app, main } = await launchApp({ profileDir })
  try {
    await main.waitForSelector('.app-shell', { timeout: 20_000 })
    await main.waitForSelector('.welcome-card', { state: 'attached', timeout: 5_000 })
    const card = await main.evaluate(() => ({
      heading: document.querySelector('#welcome-heading')?.textContent,
      rows: [...document.querySelectorAll('.welcome-card .toggle-row strong')].map((e) => e.textContent),
      launch: document.querySelector('#welcome-launch')?.checked,
      updates: document.querySelector('#welcome-updates')?.checked
    }))
    expect('heading', card.heading, 'Before you start')
    expect('rows', card.rows, (r) => r[0] === 'Start Vocette with Windows' && r[1] === "Tell me when there's a new version")
    expect('start with Windows ticked', card.launch, true)
    expect('updates ticked', card.updates, true)
    await main.screenshot({ path: join(shots, 'welcome-card.png') })

    await main.evaluate(() => {
      document.querySelector('#welcome-updates').checked = false
      document.querySelector('.welcome-card .primary-button').click()
    })
    await sleep(800)
    expect('card gone', await main.$('.welcome-card'), null)
    const settings = await main.evaluate(() => window.murmur.getSettings())
    expect('answered', settings.welcomeAnswered, true)
    expect('start with Windows kept', settings.launchAtLogin, true)
    const update = await main.evaluate(() => window.murmur.getUpdateStatus())
    expect('update check off as chosen', update.enabled, false)
  } finally {
    await app.close()
  }
}
const stored = JSON.parse(readFileSync(join(profileDir, 'settings.json'), 'utf8'))
expect('stored', { welcomeAnswered: stored.welcomeAnswered, updateCheck: stored.updateCheck }, (s) => s.welcomeAnswered === true && s.updateCheck === false)
{
  const { app, main } = await launchApp({ profileDir })
  try {
    await main.waitForSelector('.app-shell', { timeout: 20_000 })
    await sleep(800)
    expect('card stays gone after a restart', await main.$('.welcome-card'), null)
  } finally {
    await app.close()
  }
}
console.log(ok ? 'PASS' : 'FAIL')
