// K10 step 3 in the built app: a success with nothing to say folds the pill
// with a tick. Automatic paste is off, so the take's "Copied to clipboard" is
// the user's own choice and quiet. Samples the fold and the sink; shots in e2e/pill.
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { findWindow, freshProfile, launchApp, sleep, WORK, MODELS } from './harness.mjs'

const shots = join(WORK, 'pill')
mkdirSync(shots, { recursive: true })
const audio = join(WORK, 'audio', 'a-itu-kirinde.wav').split('/').join('\\')
const { app, main } = await launchApp({
  profileDir: freshProfile('quiet'),
  audioFile: `${audio}%noloop`,
  extraArgs: ['--background'],
  env: { MURMUR_MODELS_DIR: MODELS }
})
try {
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  await main.evaluate(() =>
    window.murmur.saveSettings({ playSounds: false, engine: 'local', theme: 'dark', autoPaste: false })
  )
  const overlay = await findWindow(app, 'overlay.html')
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
      return {
        cls: el.className.replace('overlay ', ''),
        w: Math.round(r.width),
        h: Math.round(r.height),
        y: new DOMMatrix(s.transform).f.toFixed(1),
        op: Number(s.opacity).toFixed(2),
        content: Number(getComputedStyle(document.querySelector('#pill-content')).opacity).toFixed(2),
        tick: Number(getComputedStyle(document.querySelector('.tick')).opacity).toFixed(2),
        message: document.querySelector('#message').textContent
      }
    })
  await main.evaluate(() => window.murmur.startRecording())
  await sleep(4000)
  await main.evaluate(() => window.murmur.stopRecording())
  const fold = []
  let t0 = 0
  for (let i = 0; i < 400; i += 1) {
    const p = await pill()
    if (!t0 && p.cls.includes('success')) t0 = Date.now()
    if (t0) {
      fold.push(`${Date.now() - t0}ms ${p.cls} ${p.w}x${p.h} y=${p.y} op=${p.op} content=${p.content} tick=${p.tick}`)
      if (fold.length === 6) await overlay.screenshot({ path: join(shots, '15-landed-beat-dark.png') })
      if (fold.length === 34) await overlay.screenshot({ path: join(shots, '16-folded-tick-dark.png') })
      // Done once it has sunk away, or is back at rest on the resting pill.
      if (p.cls.includes('idle') && (Number(p.op) === 0 || Number(p.y) >= 4)) break
    }
    await sleep(t0 ? 60 : 40)
  }
  console.log(fold.join('\n'))
  console.log('message kept for screen readers:', JSON.stringify((await pill()).message))
} finally {
  await app.close()
}
