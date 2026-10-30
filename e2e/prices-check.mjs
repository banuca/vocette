// The Pro page in the built app: both plans at their prices, the yearly saving,
// and no offer. The checkout links are the ones the app ships with; nothing is
// clicked. Isolated profile, still in its trial; a screenshot in e2e/prices.
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { freshProfile, launchApp, sleep, WORK } from './harness.mjs'

const shots = join(WORK, 'prices')
mkdirSync(shots, { recursive: true })
let ok = true
const expect = (label, actual, wanted) => {
  const pass = typeof wanted === 'function' ? wanted(actual) : actual === wanted
  if (!pass) ok = false
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
}

const { app, main } = await launchApp({ profileDir: freshProfile('prices'), extraArgs: ['--background'] })
try {
  await main.waitForSelector('.app-shell', { timeout: 30_000 })
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.setContentSize(1060, 900)
    win?.showInactive()
  })
  await main.evaluate(() => document.querySelector('[data-page="pro"]')?.click())
  await main.waitForSelector('#subscribe-yearly', { state: 'attached', timeout: 5_000 })
  await sleep(500)
  const seen = await main.evaluate(() => ({
    buyShown: !document.querySelector('#pro-buy')?.hidden,
    yearly: document.querySelector('#subscribe-yearly')?.textContent,
    monthly: document.querySelector('#subscribe-monthly')?.textContent,
    enabled:
      !document.querySelector('#subscribe-yearly')?.disabled &&
      !document.querySelector('#subscribe-monthly')?.disabled,
    struck: document.querySelectorAll('.pro-page s').length,
    offerLine: document.querySelector('#launch-offer') !== null,
    note: document.querySelector('#plans-note')?.textContent,
    offerWording:
      document.querySelector('.pro-page')?.textContent?.match(/launch offer|first 100|half price|% off/i)?.[0] ??
      null
  }))
  expect('plans shown', seen.buyShown, true)
  expect('yearly plan', seen.yearly, 'Yearly — US$99 a year · two months free')
  expect('monthly plan', seen.monthly, 'Monthly — US$9.99 a month')
  expect('both checkouts open', seen.enabled, true)
  expect('nothing struck through', seen.struck, 0)
  expect('no offer line', seen.offerLine, false)
  expect('no offer wording', seen.offerWording, null)
  expect(
    'plans note',
    seen.note,
    'One subscription covers up to 10 devices. Cancel any time; Pro stays on until the end of the period you have paid for.'
  )
  await main.locator('.pro-page .settings-card').first().screenshot({ path: join(shots, 'pro-plans.png') })
} finally {
  await app.close()
}
console.log(ok ? 'PASS' : 'FAIL')
