// K5 "Rise" in the built app: the card's position as it rises in and sinks
// out, the waveform following the live voice while listening, and the light
// passing along it while writing. Screenshots in e2e/rise.
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { findWindow, freshProfile, launchApp, sleep, WORK, MODELS } from './harness.mjs'

const shots = join(WORK, 'rise')
mkdirSync(shots, { recursive: true })
const audio = join(WORK, 'audio', 'a-itu-kirinde.wav').split('/').join('\\')
const { app, main } = await launchApp({
  profileDir: freshProfile('rise'),
  audioFile: `${audio}%noloop`,
  extraArgs: ['--background'],
  env: { MURMUR_MODELS_DIR: MODELS }
})
try {
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  await main.evaluate(() => window.murmur.saveSettings({ playSounds: false, engine: 'local' }))
  const overlay = await findWindow(app, 'overlay.html')
  const card = () =>
    overlay.evaluate(() => {
      const el = document.querySelector('#overlay')
      const m = new DOMMatrix(getComputedStyle(el).transform)
      const bars = [...document.querySelectorAll('.waveform i')].map((b) => new DOMMatrix(getComputedStyle(b).transform).d.toFixed(2))
      return { phase: el.className.replace('overlay ', ''), y: m.f.toFixed(1), opacity: Number(getComputedStyle(el).opacity).toFixed(2), bars: bars.join(' ') }
    })
  await main.evaluate(() => window.murmur.startRecording())
  const rise = []
  const t0 = Date.now()
  for (let i = 0; i < 12; i += 1) {
    const c = await card()
    rise.push(`${Date.now() - t0}ms y=${c.y} op=${c.opacity}`)
    if (i === 2) await overlay.screenshot({ path: join(shots, '1-rising.png') })
    await sleep(35)
  }
  console.log('rise:', rise.join(' | '))
  await sleep(1500)
  for (let i = 0; i < 4; i += 1) {
    const c = await card()
    console.log('listening bars:', c.phase, c.bars)
    await sleep(160)
  }
  await overlay.screenshot({ path: join(shots, '2-listening.png') })
  await sleep(2000)
  await main.evaluate(() => window.murmur.stopRecording())
  for (let i = 0; i < 40; i += 1) {
    const c = await card()
    if (c.phase.includes('processing')) {
      console.log('writing bars:', c.bars)
      await overlay.screenshot({ path: join(shots, '3-writing.png') })
      break
    }
    await sleep(40)
  }
  let sink = []
  let sawSuccess = false
  for (let i = 0; i < 200; i += 1) {
    const c = await card()
    if (c.phase.includes('success')) {
      if (!sawSuccess) await overlay.screenshot({ path: join(shots, '4-pasted.png') })
      sawSuccess = true
    }
    if (sawSuccess && c.phase.includes('idle')) {
      const s0 = Date.now()
      for (let k = 0; k < 8; k += 1) {
        const d = await card()
        sink.push(`${Date.now() - s0}ms y=${d.y} op=${d.opacity}`)
        await sleep(30)
      }
      break
    }
    await sleep(50)
  }
  console.log('sink:', sink.join(' | '))
} finally {
  await app.close()
}
