// K2 in the built app: the History stats row at the window's widths, wide and
// narrow, and zoomed in. Screenshots of the top of History in e2e work
// `stats/`, and each card's row and column printed, so a ragged column shows.
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { freshProfile, launchApp, sleep, WORK } from './harness.mjs'

const shots = join(WORK, 'stats')
mkdirSync(shots, { recursive: true })
const { app, main } = await launchApp({ profileDir: freshProfile('stats') })
try {
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  const cases = [
    { width: 1060, zoom: 1 },
    { width: 941, zoom: 1 },
    { width: 900, zoom: 1 },
    { width: 860, zoom: 1 },
    { width: 860, zoom: 1.25 },
    { width: 860, zoom: 1.5 }
  ]
  for (const { width, zoom } of cases) {
    await app.evaluate(({ BrowserWindow }, { width, zoom }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
      win.setContentSize(width, 700)
      win.webContents.setZoomFactor(zoom)
    }, { width, zoom })
    await sleep(500)
    const layout = await main.evaluate(() => {
      const cards = [...document.querySelectorAll('.metric-card')]
      const rows = [...new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top)))]
      return {
        viewport: innerWidth,
        cards: cards.map((c) => {
          const r = c.getBoundingClientRect()
          const s = getComputedStyle(c)
          return `${c.querySelector('span').textContent}@row${rows.indexOf(Math.round(r.top))} x=${Math.round(r.left)} w=${Math.round(r.width)} pad=${s.paddingLeft} border=${s.borderLeftWidth}`
        })
      }
    })
    console.log(`\n${width}px at ${zoom * 100}% (CSS viewport ${layout.viewport}px)`)
    for (const line of layout.cards) console.log('  ' + line)
    // The window is shown: a hidden one never paints.
    // Captured by Electron: Playwright's own screenshot crops a zoomed page.
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
      return (await win.webContents.capturePage()).toPNG().toString('base64')
    })
    writeFileSync(join(shots, `stats-${width}-${zoom * 100}.png`), Buffer.from(png, 'base64'))
  }
} finally {
  await app.close()
}
