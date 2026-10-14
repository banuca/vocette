// K3 in the built app: Ctrl + wheel and Ctrl + = / - / 0 zoom the main window
// in steps, the pill never zooms, and the size survives a restart.
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { findWindow, freshProfile, launchApp, sleep, WORK } from './harness.mjs'

const profile = freshProfile('zoom-check')
const zooms = (app) =>
  app.evaluate(({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows()
    const main = wins.find((w) => w.webContents.getURL().includes('index.html'))
    const overlay = wins.find((w) => w.webContents.getURL().includes('overlay.html'))
    return { main: main?.webContents.getZoomFactor(), pill: overlay?.webContents.getZoomFactor() }
  })

let { app, main } = await launchApp({ profileDir: profile })
try {
  await main.waitForSelector('.app-shell', { timeout: 30_000 })
  await findWindow(app, 'overlay.html')
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.setContentSize(1060, 760)
    win?.show()
    win?.focus()
  })
  await sleep(500)
  console.log('start:', JSON.stringify(await zooms(app)))
  await main.mouse.move(600, 400)
  await main.keyboard.down('Control')
  await main.mouse.wheel(0, -120)
  await sleep(300)
  await main.mouse.wheel(0, -120)
  await main.keyboard.up('Control')
  await sleep(400)
  console.log('after Ctrl + wheel up twice:', JSON.stringify(await zooms(app)))
  await main.keyboard.press('Control+-')
  await sleep(300)
  console.log('after Ctrl + minus:', JSON.stringify(await zooms(app)))
  await main.keyboard.press('Control+=')
  await sleep(300)
  console.log('after Ctrl + equals:', JSON.stringify(await zooms(app)))
  await main.screenshot({ path: join(WORK, 'graphite', 'zoom-125.png') })
} finally {
  await app.close()
}
console.log('saved uiZoom:', JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8')).uiZoom)
;({ app, main } = await launchApp({ profileDir: profile, extraArgs: ['--background'] }))
try {
  await main.waitForSelector('.app-shell', { timeout: 30_000 })
  await sleep(800)
  console.log('after restart:', JSON.stringify(await zooms(app)))
  await main.keyboard.press('Control+0')
  await sleep(300)
  console.log('after Ctrl + 0:', JSON.stringify(await zooms(app)))
} finally {
  await app.close()
}
