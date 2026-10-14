// The Graphite re-skin, looked at: every page in light and dark, and the
// overlay pill in each phase, on an isolated profile. Screenshots in e2e/graphite.
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { findWindow, freshProfile, launchApp, sleep, WORK } from './harness.mjs'

const shots = join(WORK, 'graphite')
mkdirSync(shots, { recursive: true })
const { app, main } = await launchApp({ profileDir: freshProfile('graphite'), extraArgs: ['--background'] })
try {
  await main.waitForSelector('.app-shell', { timeout: 30_000 })
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.setContentSize(1060, 760)
    win?.showInactive()
  })
  for (const theme of ['light', 'dark']) {
    await main.evaluate((t) => window.murmur.saveSettings({ theme: t }), theme)
    await main.evaluate((t) => { document.documentElement.dataset.theme = t }, theme)
    for (const page of ['history', 'settings', 'pro', 'about']) {
      await main.evaluate((p) => document.querySelector(`[data-page="${p}"]`)?.click(), page)
      await sleep(600)
      await main.screenshot({ path: join(shots, `${theme}-${page}.png`) })
    }
  }
  const overlay = await findWindow(app, 'overlay.html')
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('overlay.html'))
    win?.showInactive()
  })
  for (const theme of ['light', 'dark']) {
    for (const phase of ['recording', 'processing', 'success']) {
      await overlay.evaluate(({ t, p }) => {
        document.documentElement.dataset.theme = t
        const card = document.querySelector('.overlay')
        if (card) card.className = `overlay ${p}`
        const message = document.querySelector('#message')
        if (message) message.textContent = p === 'recording' ? 'Listening…' : p === 'processing' ? 'Writing…' : 'Pasted'
      }, { t: theme, p: phase })
      await sleep(500)
      await overlay.screenshot({ path: join(shots, `overlay-${theme}-${phase}.png`) })
    }
  }
  console.log('shots in', shots)
} finally {
  await app.close()
}
