// Brief 19 in the built app: the Pro page with stand-in checkout links (never
// clicked), once during the launch offer and once with its end moved into the
// past. Isolated profiles; screenshots in e2e/offer.
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { freshProfile, launchApp, sleep, WORK } from './harness.mjs'

const shots = join(WORK, 'offer')
mkdirSync(shots, { recursive: true })

async function look(name, extraEnv) {
  const { app, main } = await launchApp({
    profileDir: freshProfile(`offer-${name}`),
    extraArgs: ['--background'],
    env: {
      MURMUR_CHECKOUT_URL_MONTHLY: 'https://example.invalid/checkout/monthly',
      MURMUR_CHECKOUT_URL_YEARLY: 'https://example.invalid/checkout/yearly',
      ...extraEnv
    }
  })
  try {
    await main.waitForSelector('.app-shell', { timeout: 30_000 })
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
      win?.setContentSize(1060, 900)
      win?.showInactive()
    })
    await main.evaluate(() => document.querySelector('[data-page="pro"]')?.click())
    await sleep(800)
    const seen = await main.evaluate(() => ({
      offer: document.querySelector('#launch-offer')?.hidden ? '(hidden)' : document.querySelector('#launch-offer')?.textContent,
      yearly: document.querySelector('#subscribe-yearly')?.textContent,
      yearlyStruck: document.querySelector('#subscribe-yearly s')?.textContent ?? null,
      monthly: document.querySelector('#subscribe-monthly')?.textContent,
      monthlyStruck: document.querySelector('#subscribe-monthly s')?.textContent ?? null,
      note: document.querySelector('#plans-note')?.textContent,
      enabled: !document.querySelector('#subscribe-yearly')?.disabled && !document.querySelector('#subscribe-monthly')?.disabled
    }))
    console.log(name, JSON.stringify(seen, null, 1))
    await main.locator('.pro-page .settings-card').first().screenshot({ path: join(shots, `${name}.png`) })
  } finally {
    await app.close()
  }
}

await look('during-offer', {})
await look('after-offer', { MURMUR_LAUNCH_OFFER_ENDS_AT: '2026-10-01T00:00:00Z' })
await look('no-checkout', { MURMUR_CHECKOUT_URL_MONTHLY: '', MURMUR_CHECKOUT_URL_YEARLY: '' })
