// K10 step 1 in the built app: the smoked-glass pill. A stand-in backdrop is
// drawn under the pill inside the overlay page itself (white page, photo, dark
// app), so a screenshot shows the tint over something. Checks the rise, that the
// pill hugs its words, and each phase's look in dark and light. Shots in e2e/pill.
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { findWindow, freshProfile, launchApp, sleep, WORK, MODELS } from './harness.mjs'

const shots = join(WORK, 'pill')
mkdirSync(shots, { recursive: true })
const audio = join(WORK, 'audio', 'a-itu-kirinde.wav').split('/').join('\\')
const { app, main } = await launchApp({
  profileDir: freshProfile('pill'),
  audioFile: `${audio}%noloop`,
  extraArgs: ['--background'],
  env: { MURMUR_MODELS_DIR: MODELS }
})

const BACKDROPS = {
  page: 'background:#fff;color:#2a2a31;font:12px/1.5 "Segoe UI";padding:4px 10px',
  photo:
    'background:radial-gradient(40% 90% at 20% 80%,#ffd166,transparent 70%),radial-gradient(40% 90% at 55% 60%,#ef476f,transparent 70%),radial-gradient(45% 90% at 85% 50%,#06d6a0,transparent 70%),linear-gradient(160deg,#073b4c,#3d1d4f);color:transparent',
  dark: 'background:#1e1f24;color:#c9ccd6;font:11.5px/1.6 Consolas;padding:4px 10px'
}
const TEXT =
  "Agenda for Thursday's review: budget, hiring and the launch timeline. Please bring the latest figures and your notes from the client call so we can agree on next steps. Marta will share the revised forecast on Wednesday."

try {
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  await main.evaluate(() => window.murmur.saveSettings({ playSounds: false, engine: 'local', theme: 'dark' }))
  const overlay = await findWindow(app, 'overlay.html')
  const backdrop = (kind) =>
    overlay.evaluate(
      ({ css, text }) => {
        let back = document.querySelector('#e2e-backdrop')
        if (!back) {
          back = document.createElement('div')
          back.id = 'e2e-backdrop'
          document.body.prepend(back)
        }
        back.style.cssText = `position:fixed;inset:0;z-index:-1;overflow:hidden;${css}`
        back.textContent = text
      },
      { css: BACKDROPS[kind], text: TEXT }
    )
  const pill = () =>
    overlay.evaluate(() => {
      const el = document.querySelector('#overlay')
      const content = document.querySelector('#pill-content')
      const m = new DOMMatrix(getComputedStyle(el).transform)
      return {
        phase: el.className.replace('overlay ', ''),
        width: Math.round(el.getBoundingClientRect().width),
        content: Math.round(content.getBoundingClientRect().width),
        y: m.f.toFixed(1),
        opacity: Number(getComputedStyle(el).opacity).toFixed(2),
        message: document.querySelector('#message').textContent,
        timer: document.querySelector('#timer').textContent
      }
    })
  const shot = (name) => overlay.screenshot({ path: join(shots, `${name}.png`) })

  await backdrop('page')
  await main.evaluate(() => window.murmur.startRecording())
  const rise = []
  const t0 = Date.now()
  for (let i = 0; i < 14; i += 1) {
    const p = await pill()
    rise.push(`${Date.now() - t0}ms ${p.phase} w=${p.width} y=${p.y} op=${p.opacity}`)
    await sleep(30)
  }
  console.log('rise:', rise.join(' | '))
  await sleep(900)
  console.log('listening:', JSON.stringify(await pill()))
  await shot('1-listening-dark-page')
  await backdrop('photo')
  await shot('2-listening-dark-photo')
  await backdrop('dark')
  await shot('3-listening-dark-app')
  await main.evaluate(() => window.murmur.saveSettings({ theme: 'light' }))
  await sleep(150)
  await backdrop('page')
  await shot('4-listening-light-page')
  await backdrop('photo')
  await shot('5-listening-light-photo')
  await backdrop('page')
  await sleep(1500)
  await main.evaluate(() => window.murmur.stopRecording())
  for (let i = 0; i < 60; i += 1) {
    const p = await pill()
    if (p.phase.includes('processing')) {
      await sleep(250)
      console.log('processing:', JSON.stringify(await pill()))
      await shot('6-transcribing-light-page')
      break
    }
    await sleep(30)
  }
  let sawSuccess = false
  const sink = []
  for (let i = 0; i < 300; i += 1) {
    const p = await pill()
    if (!sawSuccess && p.phase.includes('success')) {
      sawSuccess = true
      await sleep(450)
      console.log('success:', JSON.stringify(await pill()))
      await shot('7-success-light-page')
    }
    if (sawSuccess && p.phase.includes('idle')) {
      const s0 = Date.now()
      for (let k = 0; k < 8; k += 1) {
        const d = await pill()
        sink.push(`${Date.now() - s0}ms w=${d.width} y=${d.y} op=${d.opacity}`)
        await sleep(30)
      }
      break
    }
    await sleep(40)
  }
  console.log('sink:', sink.join(' | '))
} finally {
  await app.close()
}
