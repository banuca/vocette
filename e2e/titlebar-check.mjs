import { freshProfile, launchApp, sleep } from './harness.mjs'
const { app, main } = await launchApp({ profileDir: freshProfile('titlebar'), extraArgs: ['--background'] })
try {
  await main.waitForSelector('.theme-switch', { timeout: 30000 })
  const read = () => app.evaluate(({ nativeTheme }) => `${nativeTheme.themeSource} (dark=${nativeTheme.shouldUseDarkColors})`)
  console.log('start:', await read())
  await main.click('.theme-switch button[data-mode="dark"]'); await sleep(500)
  console.log('after moon:', await read())
  await main.click('.theme-switch button[data-mode="light"]'); await sleep(500)
  console.log('after sun:', await read())
} finally { await app.close() }
