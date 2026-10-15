// N1 in the built app: Free's 10,000 words a month. A profile whose trial
// ended 10 days ago, with 9,995 words already counted this month:
//   - History shows the month so far;
//   - a take is delivered in full and says it reached the limit;
//   - the next take does not start, and the pill shows a pause with the date.
// Automatic paste is off, so nothing is typed anywhere.
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { AUDIO, MODELS, WORK, findWindow, freshProfile, launchApp, sleep } from './harness.mjs'

const shots = join(WORK, 'word-limit')
mkdirSync(shots, { recursive: true })
const profileDir = freshProfile('word-limit')
const launch = () =>
  launchApp({
    profileDir,
    audioFile: `${AUDIO}%noloop`,
    extraArgs: ['--background'],
    env: { MURMUR_MODELS_DIR: MODELS }
  })

// First run writes the settings file; then the trial is moved back and the month filled.
{
  const { app, main } = await launch()
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  await main.evaluate(() =>
    window.murmur.saveSettings({ playSounds: false, engine: 'local', autoPaste: false, restingPill: true })
  )
  await app.close()
}
const file = join(profileDir, 'settings.json')
const stored = JSON.parse(readFileSync(file, 'utf8'))
const now = new Date()
stored.trialStartedAt = new Date(Date.now() - 40 * 86_400_000).toISOString()
stored.trialEndNoticeDismissed = true
stored.wordUsage = { month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, words: 9_995 }
writeFileSync(file, JSON.stringify(stored, null, 2))

const { app, main } = await launch()
let ok = true
const expect = (label, actual, wanted) => {
  const pass = typeof wanted === 'function' ? wanted(actual) : actual === wanted
  if (!pass) ok = false
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
}
try {
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  const licence = await main.evaluate(() => window.murmur.getLicenceStatus())
  expect('plan', licence.plan, 'free')
  expect('words used', licence.words?.used, 9_995)
  await main.waitForSelector('.allowance-note', { state: 'attached', timeout: 5_000 })
  expect('History line', await main.textContent('.allowance-note p'), (t) => t.startsWith('9,995 of 10,000 free words this month.'))

  const overlay = await findWindow(app, 'overlay.html')
  const statuses = []
  await main.exposeFunction('__status', (s) => statuses.push(s))
  await main.evaluate(() => window.murmur.onWorkflowStatus((s) => window.__status(s)))

  // A take with words to spare: delivered, and it says it reached the limit.
  await main.evaluate(() => window.murmur.startRecording())
  await sleep(4000)
  await main.evaluate(() => window.murmur.stopRecording())
  for (let i = 0; i < 100 && !statuses.some((s) => s.phase === 'success' || s.phase === 'error'); i += 1) await sleep(200)
  const success = statuses.find((s) => s.phase === 'success')
  expect('crossing take delivered', success?.message, (m) => typeof m === 'string' && m.length > 0)
  expect('crossing take says so', success?.detail, (d) => typeof d === 'string' && d.startsWith("That's your 10,000 free words for"))
  await sleep(4000)

  const after = await main.evaluate(() => window.murmur.getLicenceStatus())
  expect('words after the take', after.words?.used, (n) => n > 10_000)
  await sleep(300)
  expect('History line at the limit', await main.textContent('.allowance-note p'), (t) => t.startsWith("You have used this month's 10,000 free words."))

  // The next take does not start.
  statuses.length = 0
  await main.evaluate(() => window.murmur.startRecording())
  await sleep(600)
  expect('next take refused', statuses.at(-1), (s) => s?.phase === 'error' && s.limit === true && /^Free words used up for /.test(s.message))
  expect('no recording', statuses.some((s) => s.phase === 'recording' || s.phase === 'starting'), false)
  const pill = await overlay.evaluate(() => ({
    cls: document.querySelector('#overlay').className,
    pause: Number(getComputedStyle(document.querySelector('.icon-pause')).opacity),
    error: Number(getComputedStyle(document.querySelector('.icon-error')).opacity),
    message: document.querySelector('#message').textContent,
    detail: document.querySelector('#detail').textContent
  }))
  expect('pill shows a pause, not the error mark', pill, (p) => p.cls.includes('limit') && p.pause > 0.9 && p.error < 0.1)
  console.log('  pill says:', pill.message, '|', pill.detail)
  await overlay.screenshot({ path: join(shots, 'limit-pill.png') })

  await main.evaluate(() => document.querySelector('[data-page="pro"]')?.click())
  await sleep(500)
  expect('Pro adds', await main.textContent('#pro-adds li'), 'Unlimited dictation, instead of 10,000 words a month')
  console.log(ok ? 'PASS' : 'FAIL')
} finally {
  await app.close()
}
