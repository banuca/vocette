// The sun and moon switch in the built app, on a fresh profile: it opens
// following the system, a press saves the choice, and the sidebar shows it.
import { join } from 'node:path'
import { mkdirSync, readFileSync } from 'node:fs'
import { freshProfile, launchApp, sleep, WORK } from './harness.mjs'

const shots = join(WORK, 'graphite')
mkdirSync(shots, { recursive: true })
const profile = freshProfile('switch')
const { app, main } = await launchApp({ profileDir: profile, extraArgs: ['--background'] })
try {
  await main.waitForSelector('.theme-switch', { timeout: 30_000 })
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.setContentSize(1060, 760)
    win?.showInactive()
  })
  const read = () => main.evaluate(() => ({
    applied: document.documentElement.dataset.theme,
    pressed: [...document.querySelectorAll('.theme-switch button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.mode),
    title: document.querySelector('.theme-switch button')?.title
  }))
  const system = await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)
  console.log('system dark:', system, 'at start:', JSON.stringify(await read()), 'saved:', (await main.evaluate(() => window.murmur.getSettings())).theme)
  await main.locator('.sidebar').screenshot({ path: join(shots, 'switch-start.png') })
  const other = system ? 'light' : 'dark'
  await main.click(`.theme-switch button[data-mode="${other}"]`)
  await sleep(600)
  console.log('after pressing', other, JSON.stringify(await read()))
  await main.locator('.sidebar').screenshot({ path: join(shots, `switch-${other}.png`) })
  const file = JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'))
  console.log('settings.json theme:', file.theme)
} finally {
  await app.close()
}
