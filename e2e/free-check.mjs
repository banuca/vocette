// Vocette is free for everyone, in the built app. It opens a profile left by a
// version that sold subscriptions: a trial that ended 40 days ago and whose
// notice was never dismissed, a device tag, 12,000 words already counted this
// month (past the old limit of 10,000) and an activated licence key. Then:
//   - the window has History, Settings and About, and no Pro page;
//   - no page shows a price, a trial, Pro or a limit, and About says Vocette is
//     free and no longer actively developed;
//   - two takes in a row are transcribed and kept, where the old limit would
//     have refused the first;
//   - opt-in counts would say plan "free" and no limit hit;
//   - the licence key is gone from settings.json and its backup, and the
//     trial's start is kept as the first run;
//   - the built app holds no Polar address and asks nothing of Polar.
// Safe to run beside the owner's work: both global shortcuts are off in the
// profile before the first launch, automatic paste is off, and the takes start
// from the window, so nothing is typed anywhere. Screenshots in e2e/free.
import { join } from 'node:path'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { AUDIO, MODELS, REPO, WORK, freshProfile, launchApp, sleep } from './harness.mjs'

const shots = join(WORK, 'free')
mkdirSync(shots, { recursive: true })
const models = process.env.MURMUR_MODELS_DIR ?? MODELS

let ok = true
const expect = (label, actual, wanted) => {
  const pass = typeof wanted === 'function' ? wanted(actual) : JSON.stringify(actual) === JSON.stringify(wanted)
  if (!pass) ok = false
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
}

/** What only a paid plan would put on screen (tests/fixtures/plan-words.ts). */
const PLAN_WORDS =
  /\b(?:US|A|C|NZ)\$\s?\d|[€£]\s?\d|\b(?:a|per) (?:month|year)\b|\btrial\b|\bPro\b|\bSubscribe\b|\bsubscription\b|\bcheckout\b|licen[cs]e key|polar|free words|word limit|used up|\bupgrade\b/iu

// The built app first: nothing in it may name Polar or a licence channel.
const built = readdirSync(join(REPO, 'out'), { recursive: true, encoding: 'utf8' }).filter((file) =>
  /\.(?:js|mjs|cjs|html)$/u.test(file)
)
const naming = built.filter((file) =>
  /polar\.sh|licence:activate|licence:check-now/iu.test(readFileSync(join(REPO, 'out', file), 'utf8'))
)
expect('built files read', built.length > 3, true)
expect('no built file names Polar or a licence channel', naming, [])

// A profile from the version that sold subscriptions.
const profileDir = freshProfile('free')
const file = join(profileDir, 'settings.json')
const KEY = 'VOCETTE-E2E0E2E0-0000-4000-8000-00000000F2EE'
const now = new Date()
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const trialStartedAt = new Date(Date.now() - 40 * 86_400_000).toISOString()
const old = {
  version: 5,
  engine: 'local',
  // Off from the first launch: no global shortcut, no paste-last shortcut,
  // nothing typed, nothing resting on screen.
  hotkeyEnabled: false,
  pasteLastShortcut: false,
  autoPaste: false,
  restingPill: false,
  playSounds: false,
  launchAtLogin: false,
  welcomeAnswered: true,
  theme: 'light',
  trialStartedAt,
  trialEndNoticeDismissed: false,
  deviceTag: '7F3A',
  wordUsage: { month, words: 12_000 },
  licence: {
    encryptedKey: KEY,
    keyStorage: 'plain',
    activationId: 'e2e00000-0000-4000-8000-000000000001',
    benefitId: 'e2e00000-0000-4000-8000-000000000002',
    displayKey: '****-00F2EE',
    activatedAt: trialStartedAt,
    subscription: 'active',
    confirmedAt: trialStartedAt
  }
}
writeFileSync(file, JSON.stringify(old, null, 2))
writeFileSync(`${file}.bak`, JSON.stringify(old, null, 2))

const { app, main } = await launchApp({
  profileDir,
  audioFile: `${AUDIO}%noloop`,
  extraArgs: ['--background'],
  env: { MURMUR_MODELS_DIR: models }
})
try {
  // Every request the app's network stack makes from here on.
  await app.evaluate(({ session }) => {
    globalThis.__requests = []
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      if (/^https?:/u.test(details.url)) globalThis.__requests.push(details.url)
      callback({})
    })
  })
  await main.waitForSelector('.app-shell', { timeout: 30_000 })
  const settings = await main.evaluate(() => window.murmur.getSettings())
  expect('global shortcut off', settings.hotkeyEnabled, false)
  expect('paste-last shortcut off', settings.pasteLastShortcut, false)
  expect('automatic paste off', settings.autoPaste, false)
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.setContentSize(1060, 900)
    win?.showInactive()
  })

  const pages = await main.evaluate(() =>
    [...document.querySelectorAll('.nav-item')].map((item) => item.dataset.page)
  )
  expect('pages in the sidebar', pages, ['history', 'settings', 'about'])
  expect('no licence call in the window', await main.evaluate(() => typeof window.murmur.getLicenceStatus), 'undefined')

  for (const page of ['history', 'settings', 'about']) {
    await main.evaluate((p) => document.querySelector(`[data-page="${p}"]`)?.click(), page)
    await sleep(800)
    const text = await main.evaluate(() => document.querySelector('.app-shell')?.innerText ?? '')
    expect(`${page}: no price, trial, Pro or limit`, text.match(PLAN_WORDS)?.[0] ?? null, null)
    await main.screenshot({ path: join(shots, `${page}.png`) })
  }
  const about = await main.evaluate(() => document.querySelector('.main-panel')?.innerText ?? '')
  expect('About says free and open source', about.includes('Vocette is free for everyone and open source, under the MIT licence.'), true)
  expect('About says no longer developed', about.includes('It is no longer actively developed'), true)

  const counts = await main.evaluate(() => window.murmur.getCounts())
  expect('counts: plan', counts.report.plan, 'free')
  expect('counts: limit hit', counts.report.limitHit, false)
  expect('counts: weeks since the first run', counts.report.week, 5)

  // Two takes in a row from the window, past the old monthly limit.
  const statuses = []
  await main.exposeFunction('__status', (status) => statuses.push(status))
  await main.evaluate(() => window.murmur.onWorkflowStatus((status) => window.__status(status)))
  for (const take of [1, 2]) {
    statuses.length = 0
    await main.evaluate(() => window.murmur.startRecording())
    await sleep(4000)
    await main.evaluate(() => window.murmur.stopRecording())
    for (let i = 0; i < 300 && !statuses.some((s) => s.phase === 'success' || s.phase === 'error'); i += 1) {
      await sleep(200)
    }
    const end = statuses.find((s) => s.phase === 'success' || s.phase === 'error')
    expect(`take ${take} delivered`, end?.phase, 'success')
    console.log(`  take ${take} says:`, end?.message, '|', end?.detail)
    expect(`take ${take} says nothing of a limit`, `${end?.message} ${end?.detail ?? ''}`.match(PLAN_WORDS)?.[0] ?? null, null)
    await sleep(3000)
  }
  expect('both takes in History', (await main.evaluate(() => window.murmur.getHistory())).length, 2)

  const requests = await app.evaluate(() => globalThis.__requests)
  expect('no request to Polar', requests.filter((url) => /polar/iu.test(url)), [])
  console.log('  requests made:', JSON.stringify(requests))
} finally {
  await app.close()
}

// The licence key is gone from the file and its backup; the trial's start stays as the first run.
for (const copy of [file, `${file}.bak`]) {
  const text = readFileSync(copy, 'utf8')
  const name = copy.endsWith('.bak') ? 'backup' : 'settings.json'
  expect(`${name}: no licence key`, text.includes(KEY), false)
  expect(
    `${name}: no plan fields`,
    ['licence', 'trialStartedAt', 'trialEndNoticeDismissed', 'deviceTag', 'wordUsage'].filter((field) =>
      text.includes(`"${field}"`)
    ),
    []
  )
}
expect('first run kept from the trial start', JSON.parse(readFileSync(file, 'utf8')).firstRunAt, trialStartedAt)
console.log(ok ? 'PASS' : 'FAIL')
process.exitCode = ok ? 0 : 1
