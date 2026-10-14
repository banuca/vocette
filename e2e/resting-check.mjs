// K10 step 4 in the built app: the resting pill. On from start-up; springs open
// for a take and folds back to rest; a quiet success leaves a tick, then the
// bars; the Settings switch takes it away and brings it back. Shots in e2e/pill.
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { findWindow, freshProfile, launchApp, sleep, WORK, MODELS } from './harness.mjs'

const shots = join(WORK, 'pill')
mkdirSync(shots, { recursive: true })
const audio = join(WORK, 'audio', 'a-itu-kirinde.wav').split('/').join('\\')
const { app, main } = await launchApp({
  profileDir: freshProfile('resting'),
  audioFile: `${audio}%noloop`,
  extraArgs: ['--background'],
  env: { MURMUR_MODELS_DIR: MODELS }
})
const visible = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('overlay.html'))
      ?.isVisible()
  )
try {
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  await main.evaluate(() => window.murmur.saveSettings({ playSounds: false, engine: 'local', theme: 'dark' }))
  const overlay = await findWindow(app, 'overlay.html')
  await sleep(600)
  await overlay.evaluate(() => {
    const back = document.createElement('div')
    back.style.cssText =
      'position:fixed;inset:0;z-index:-1;overflow:hidden;background:#fff;color:#2a2a31;font:12px/1.5 "Segoe UI";padding:4px 10px'
    back.textContent =
      "Agenda for Thursday's review: budget, hiring and the launch timeline. Please bring the latest figures and your notes from the client call so we can agree on next steps. Marta will share the revised forecast on Wednesday."
    document.body.prepend(back)
  })
  const pill = () =>
    overlay.evaluate(() => {
      const el = document.querySelector('#overlay')
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      const o = (sel) => Number(getComputedStyle(document.querySelector(sel)).opacity).toFixed(2)
      return {
        resting: document.documentElement.classList.contains('resting'),
        cls: el.className.replace('overlay ', ''),
        size: `${Math.round(r.width)}x${Math.round(r.height)}`,
        y: new DOMMatrix(s.transform).f.toFixed(1),
        op: Number(s.opacity).toFixed(2),
        bars: o('.rest-mark'),
        tick: o('.tick'),
        content: o('#pill-content')
      }
    })

  console.log('start-up: window visible =', await visible(), JSON.stringify(await pill()))
  await overlay.screenshot({ path: join(shots, '11-resting-dark.png') })

  // A take from rest: the pill springs open.
  await main.evaluate(() => window.murmur.startRecording())
  const open = []
  const t0 = Date.now()
  for (let i = 0; i < 12; i += 1) {
    const p = await pill()
    open.push(`${Date.now() - t0}ms ${p.cls} ${p.size} y=${p.y} op=${p.op}`)
    await sleep(35)
  }
  console.log('opens:', open.join(' | '))
  await sleep(2500)
  await main.evaluate(() => window.murmur.stopRecording())
  // Copied from the app's own window: said, not quiet, then back to rest.
  for (let i = 0; i < 300; i += 1) {
    const p = await pill()
    if (p.cls.startsWith('idle')) break
    await sleep(50)
  }
  await sleep(600)
  console.log('after a said success: window visible =', await visible(), JSON.stringify(await pill()))

  // A quiet one: automatic paste off.
  await main.evaluate(() => window.murmur.saveSettings({ autoPaste: false }))
  await main.evaluate(() => window.murmur.startRecording())
  await sleep(3000)
  await main.evaluate(() => window.murmur.stopRecording())
  for (let i = 0; i < 300; i += 1) {
    const p = await pill()
    if (p.cls.includes('quiet')) {
      await sleep(500)
      console.log('quiet:', JSON.stringify(await pill()))
      await overlay.screenshot({ path: join(shots, '12-quiet-on-rest-dark.png') })
      break
    }
    await sleep(40)
  }
  for (let i = 0; i < 100; i += 1) {
    const p = await pill()
    if (p.cls.startsWith('idle')) break
    await sleep(50)
  }
  await sleep(600)
  console.log('back to rest: window visible =', await visible(), JSON.stringify(await pill()))

  // The switch.
  await main.evaluate(() => window.murmur.saveSettings({ restingPill: false }))
  await sleep(500)
  console.log('switched off: window visible =', await visible(), JSON.stringify(await pill()))
  await main.evaluate(() => window.murmur.saveSettings({ restingPill: true }))
  await sleep(600)
  console.log('switched on: window visible =', await visible(), JSON.stringify(await pill()))
  await main.evaluate(() => window.murmur.saveSettings({ theme: 'light' }))
  await sleep(400)
  await overlay.screenshot({ path: join(shots, '13-resting-light.png') })
} finally {
  await app.close()
}
