// S1 in the built app: one real on-device dictation (fake microphone), then a
// take that fails (cloud with no key). The copied report names both, and the
// diagnostics file holds no word of what was dictated.
// Uses the bench's copy of the current model, so nothing is downloaded.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AUDIO, freshProfile, launchApp, sleep } from './harness.mjs'

const models = join(process.env.LOCALAPPDATA, 'vocette-bench', 'app-models')
const profileDir = freshProfile('diagnostics')
let ok = true
const expect = (label, actual, wanted) => {
  const pass = typeof wanted === 'function' ? wanted(actual) : actual === wanted
  if (!pass) ok = false
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
}

const finalStatus = async (main) => {
  for (let i = 0; i < 600; i += 1) {
    await sleep(100)
    const last = (await main.evaluate(() => window.__s)).findLast((s) => ['success', 'error'].includes(s.phase))
    if (last) return last
  }
  return null
}

const { app, main } = await launchApp({
  profileDir,
  audioFile: `${AUDIO}%noloop`,
  extraArgs: ['--background'],
  env: { MURMUR_MODELS_DIR: models }
})
let report = ''
try {
  await main.waitForSelector('.app-shell', { timeout: 30_000 })
  const engine = await main.evaluate(() => window.murmur.getEngineStatus())
  expect('model installed', engine.model.state, 'installed')
  await main.evaluate(() => window.murmur.saveSettings({ playSounds: false, engine: 'local', welcomeAnswered: true }))
  await main.evaluate(() => {
    window.__s = []
    window.murmur.onWorkflowStatus((s) => window.__s.push(s))
  })
  await main.evaluate(() => window.murmur.startRecording())
  await sleep(6000)
  await main.evaluate(() => window.murmur.stopRecording())
  const done = await finalStatus(main)
  expect('dictation delivered', done?.phase, 'success')

  await main.evaluate(() => {
    window.__s = []
    return window.murmur.saveSettings({ engine: 'cloud' })
  })
  await main.evaluate(() => window.murmur.startRecording())
  const failed = await finalStatus(main)
  expect('cloud with no key fails', failed?.phase, 'error')

  report = await main.evaluate(() => window.murmur.getDiagnostics())
  console.log(report.split('\n').map((line) => `     | ${line}`).join('\n'))
  expect('report opens with the version', report.split('\n')[0], (line) => /^Vocette \d+\.\d+\.\d+ · /u.test(line))
  expect('report has the startup', report.includes('startup      ready in'), true)
  expect('report has the delivered take', /take {9}(copied|pasted) · local · .* words/u.test(report), true)
  expect('report has the failed take', /take {9}failed · cloud · "/u.test(report), true)
} finally {
  await app.close()
}

await sleep(1500)
const history = JSON.parse(readFileSync(join(profileDir, 'history.json'), 'utf8'))
const said = String(history[0]?.text ?? '')
expect('something was dictated', said.length > 0, true)
const file = join(profileDir, 'diagnostics.json')
// Vocette's own error sentences are allowed to share an ordinary word with a
// dictation ("before"), so they are taken out before looking.
const events = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
const stored = JSON.stringify(events.map(({ message: _own, ...rest }) => rest)).toLowerCase()
const shown = report.replace(/"[^"]*"/gu, '').toLowerCase()
expect('log file exists with events', events.length >= 3, true)
const words = [...new Set(said.toLowerCase().match(/\p{L}{5,}/gu) ?? [])]
const leaked = words.filter((word) => stored.includes(word) || shown.includes(word))
expect(`no dictated word in the log or report (checked ${words.length})`, leaked, (list) => list.length === 0)
console.log(ok ? 'PASS' : 'FAIL')
