// K4 in the built app: a nine-word dictation shows "Polishing…" with a running
// clock while a slow stand-in server works, then pastes the polished text. The
// overlay is sampled while it polishes, and screenshotted.
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { freshProfile, launchApp, findWindow, sleep, WORK, MODELS } from './harness.mjs'
import { startFakeLlm } from './fake-llm.mjs'

const shots = join(WORK, 'polish')
mkdirSync(shots, { recursive: true })
const llm = await startFakeLlm()
llm.setDelay(1500)
const audio = join(WORK, 'audio', 'a-itu-kirinde.wav').split('/').join('\\')
const { app, main } = await launchApp({
  profileDir: freshProfile('polishing'),
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
      vocabulary: 'Kirinde\nITU-T',
      polish: { enabled: true, style: 'professional', endpoint: 'http://127.0.0.1:18080/v1', model: 'stand-in' }
    })
  )
  await main.reload()
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  await main.evaluate(() => {
    window.__statuses = []
    window.murmur.onWorkflowStatus((s) => window.__statuses.push(s))
  })
  const overlay = await findWindow(app, 'overlay.html')
  await main.evaluate(() => window.murmur.startRecording())
  await sleep(5000)
  await main.evaluate(() => window.murmur.stopRecording())
  const samples = []
  let shot = false
  for (let i = 0; i < 200; i += 1) {
    const seen = await overlay.evaluate(() => ({
      message: document.querySelector('#message')?.textContent,
      detail: document.querySelector('#detail')?.textContent,
      timer: document.querySelector('#timer')?.textContent
    }))
    if (seen.message === 'Polishing…') {
      samples.push(seen.timer)
      if (!shot && samples.length > 6) {
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('overlay.html'))?.showInactive())
        await overlay.screenshot({ path: join(shots, 'polishing.png') })
        shot = true
      }
    }
    const done = await main.evaluate(() => window.__statuses.findLast((s) => s.phase === 'success' || s.phase === 'error'))
    if (done) {
      console.log('final:', done.phase, JSON.stringify(done.message), 'wait', done.waitMs)
      break
    }
    await sleep(50)
  }
  console.log('polishing timer samples:', samples.filter((v, i, a) => a.indexOf(v) === i).join(' → '))
  const statuses = await main.evaluate(() => window.__statuses.map((s) => `${s.phase}:${s.message}${s.startedAt ? '(clock)' : ''}`))
  console.log('statuses:', statuses.join(' | '))
  const history = await main.evaluate(() => window.murmur.getHistory())
  console.log('pasted text:', JSON.stringify(history[0]?.text), 'requests to stand-in:', llm.requests.length)
} finally {
  await app.close()
  llm.close?.()
  process.exit(0)
}
