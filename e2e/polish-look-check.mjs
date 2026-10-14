// K10 step 2 in the built app: transcribing and polishing look different. A
// slow stand-in polish server keeps the pill polishing long enough to sample
// it and screenshot it in dark and light, over a stand-in white page.
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { findWindow, freshProfile, launchApp, sleep, WORK, MODELS } from './harness.mjs'
import { startFakeLlm } from './fake-llm.mjs'

const shots = join(WORK, 'pill')
mkdirSync(shots, { recursive: true })
const llm = await startFakeLlm()
llm.setDelay(3000)
const audio = join(WORK, 'audio', 'a-itu-kirinde.wav').split('/').join('\\')
const { app, main } = await launchApp({
  profileDir: freshProfile('polish-look'),
  audioFile: `${audio}%noloop`,
  extraArgs: ['--background'],
  env: { MURMUR_MODELS_DIR: MODELS }
})
try {
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  await main.evaluate(() =>
    window.murmur.saveSettings({
      playSounds: false,
      engine: 'local',
      theme: 'dark',
      polish: { enabled: true, style: 'professional', endpoint: 'http://127.0.0.1:18080/v1', model: 'stand-in' }
    })
  )
  await main.reload()
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  const overlay = await findWindow(app, 'overlay.html')
  await overlay.evaluate(() => {
    const back = document.createElement('div')
    back.style.cssText =
      'position:fixed;inset:0;z-index:-1;overflow:hidden;background:#fff;color:#2a2a31;font:12px/1.5 "Segoe UI";padding:4px 10px'
    back.textContent =
      "Agenda for Thursday's review: budget, hiring and the launch timeline. Please bring the latest figures and your notes from the client call so we can agree on next steps. Marta will share the revised forecast on Wednesday."
    document.body.prepend(back)
  })
  const look = () =>
    overlay.evaluate(() => {
      const el = document.querySelector('#overlay')
      const badge = getComputedStyle(document.querySelector('.state-badge'))
      const bar = getComputedStyle(document.querySelector('.waveform i'))
      const msg = getComputedStyle(document.querySelector('#message'))
      const opacity = (sel) => getComputedStyle(document.querySelector(sel)).opacity
      return {
        cls: el.className,
        message: document.querySelector('#message').textContent,
        timer: document.querySelector('#timer').textContent,
        badge: badge.backgroundColor,
        icon: badge.color,
        document: opacity('.icon-document'),
        sparkle: opacity('.icon-sparkle'),
        bars: bar.animationName,
        clip: msg.backgroundClip || msg.webkitBackgroundClip,
        shine: msg.animationName
      }
    })
  await main.evaluate(() => window.murmur.startRecording())
  await sleep(5000)
  await main.evaluate(() => window.murmur.stopRecording())
  let transcribing = false
  let polishing = 0
  for (let i = 0; i < 300; i += 1) {
    const l = await look()
    if (!transcribing && l.message === 'Transcribing…') {
      transcribing = true
      console.log('transcribing:', JSON.stringify(l))
    }
    if (l.message === 'Polishing…') {
      polishing += 1
      if (polishing === 1) await sleep(500)
      if (polishing === 1) {
        console.log('polishing (dark):', JSON.stringify(await look()))
        await overlay.screenshot({ path: join(shots, '8-polishing-dark-page.png') })
        await main.evaluate(() => window.murmur.saveSettings({ theme: 'light' }))
        await sleep(400)
        console.log('polishing (light):', JSON.stringify(await look()))
        await overlay.screenshot({ path: join(shots, '9-polishing-light-page.png') })
      }
    }
    if (l.cls.includes('success') || l.cls.includes('error')) {
      console.log('outcome:', JSON.stringify(l))
      break
    }
    await sleep(40)
  }
  console.log('requests to stand-in:', llm.requests.length)
} finally {
  await app.close()
  llm.close?.()
  process.exit(0)
}
