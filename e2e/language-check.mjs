// S6 in the built app: a fresh profile starts in the system's language when
// the on-device model hears it, English otherwise. Prints what this PC says.
import { freshProfile, launchApp } from './harness.mjs'

const { app, main } = await launchApp({ profileDir: freshProfile('language'), extraArgs: ['--background'] })
try {
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  const system = await app.evaluate(({ app: electronApp }) => electronApp.getPreferredSystemLanguages())
  const settings = await main.evaluate(() => window.murmur.getSettings())
  console.log('system languages:', JSON.stringify(system))
  console.log('new profile language:', settings.language)
} finally {
  await app.close()
}
