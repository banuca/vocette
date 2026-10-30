// The on-device engine's self-check in the built app (CTO review, 30 Oct:
// gap 2). After a model load the engine reads a known recording before any
// dictation, and is used only if the words come back.
//
//   node e2e/engine-self-check.mjs
//
// 1. A good load: the shipped recording passes, the dictation is delivered,
//    the status says "passed", and the diagnostics log records nothing.
// 2. A bad one, staged: a development build is handed another recording
//    (MURMUR_SELF_CHECK_CLIP, the test dictation), whose words are not the
//    expected ones. The take fails with the plain sentence, the next one is
//    refused, the status says "failed", and the log names the processor.
//
// With E2E_EXE (a packaged build) only the first part runs: it proves the
// installer's copy of the recording is found and passes.
//
// The shortcut is off, no window shows and the app's clipboard is kept in
// memory, so nothing reaches the work of whoever is using the PC. Uses the
// bench's copy of the model, so nothing is downloaded.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AUDIO, freshProfile, launchApp, sleep } from './harness.mjs'

const FAILED_REASON =
  "On-device transcription isn't working correctly on this PC. To keep dictating, choose Cloud in Settings."
const models = join(process.env.LOCALAPPDATA, 'vocette-bench', 'app-models')

let ok = true
const expect = (label, actual, wanted) => {
  const pass = typeof wanted === 'function' ? wanted(actual) : actual === wanted
  if (!pass) ok = false
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
}

async function start(name, env = {}) {
  const profileDir = freshProfile(name)
  writeFileSync(
    join(profileDir, 'settings.json'),
    JSON.stringify({
      engine: 'local',
      hotkeyEnabled: false,
      autoPaste: false,
      playSounds: false,
      restingPill: false,
      launchAtLogin: false,
      welcomeAnswered: true
    })
  )
  const { app, main } = await launchApp({
    profileDir,
    audioFile: `${AUDIO}%noloop`,
    extraArgs: ['--background'],
    env: { MURMUR_MODELS_DIR: models, ...env }
  })
  // A refused take opens Settings, and every take shows the pill: neither may
  // appear over the owner's work, so no window of this copy ever shows.
  await app.evaluate(({ BrowserWindow, Tray, clipboard }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.hide()
      window.show = () => undefined
      window.showInactive = () => undefined
      window.focus = () => undefined
    }
    Tray.prototype.setImage = () => undefined
    let text = ''
    Object.assign(clipboard, {
      availableFormats: () => (text ? ['text/plain'] : []),
      readText: () => text,
      readHTML: () => '',
      readRTF: () => '',
      readImage: () => ({ isEmpty: () => true }),
      write: (data) => {
        text = typeof data?.text === 'string' ? data.text : ''
      },
      writeText: (value) => {
        text = String(value)
      }
    })
  })
  await main.waitForSelector('.app-shell', { timeout: 30_000 })
  await main.evaluate(() => {
    window.__s = []
    window.murmur.onWorkflowStatus((s) => window.__s.push(s))
  })
  return { app, main, profileDir }
}

/** Records for `seconds` from the window, and returns how the take ended. */
async function dictate(main, seconds) {
  await main.evaluate(() => {
    window.__s = []
  })
  await main.evaluate(() => window.murmur.startRecording())
  await sleep(seconds * 1000)
  await main.evaluate(() => window.murmur.stopRecording())
  for (let i = 0; i < 600; i += 1) {
    const last = (await main.evaluate(() => window.__s)).findLast((s) =>
      ['success', 'error', 'cancelled'].includes(s.phase)
    )
    if (last) return last
    await sleep(100)
  }
  return null
}

const checks = (profileDir) => {
  const file = join(profileDir, 'diagnostics.json')
  const events = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
  return events.filter((event) => event.kind === 'engine-check')
}

console.log('1. A good load')
{
  const { app, main, profileDir } = await start('self-check-good')
  try {
    const before = await main.evaluate(() => window.murmur.getEngineStatus())
    expect('model installed', before.model.state, 'installed')
    expect('no verdict before the first load', before.selfCheck, undefined)
    const done = await dictate(main, 4)
    expect('dictation delivered', done?.phase, 'success')
    expect('with words', done?.detail, (detail) => typeof detail === 'string' && detail.length > 0)
    const after = await main.evaluate(() => window.murmur.getEngineStatus())
    expect('the check passed', after.selfCheck, 'passed')
    expect('still ready', after.ready, true)
  } finally {
    await app.close()
  }
  await sleep(1500)
  expect('nothing logged for a pass', checks(profileDir), (list) => list.length === 0)
}

console.log('2. A load that reads its recording wrongly (staged)')
if (process.env.E2E_EXE) {
  console.log('     skipped: a packaged build ignores MURMUR_SELF_CHECK_CLIP')
} else {
  const { app, main, profileDir } = await start('self-check-bad', { MURMUR_SELF_CHECK_CLIP: AUDIO })
  try {
    const failed = await dictate(main, 4)
    expect('the take fails', failed?.phase, 'error')
    expect('in plain words', failed?.detail, FAILED_REASON)
    const status = await main.evaluate(() => window.murmur.getEngineStatus())
    expect('the check failed', status.selfCheck, 'failed')
    expect('not ready', status.ready, false)
    expect('the reason offers cloud', status.notReadyReason, FAILED_REASON)
    await main.evaluate(() => {
      window.__s = []
    })
    await main.evaluate(() => window.murmur.startRecording())
    await sleep(1000)
    const refused = (await main.evaluate(() => window.__s)).find((s) => s.phase === 'error')
    expect('the next take is refused, with the same words', refused?.detail, FAILED_REASON)
    const recorded = (await main.evaluate(() => window.__s)).some((s) => s.phase === 'recording')
    expect('and records nothing', !recorded, true)
    const running = await app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().some((m) => m.name === 'Vocette speech engine')
    )
    expect('the engine process has gone', !running, true)
  } finally {
    await app.close()
  }
  await sleep(1500)
  const logged = checks(profileDir)
  expect('one failed check logged', logged.map((event) => event.outcome), (list) => list.length === 1 && list[0] === 'failed')
  expect('with the processor', logged[0]?.cpu, (cpu) => typeof cpu === 'string' && cpu.length > 3 && cpu !== 'unknown')
  expect('and what the engine heard', logged[0]?.heard, (heard) => typeof heard === 'string' && heard.length > 0)
  expect('and no audio', Object.keys(logged[0] ?? {}).sort().join(','), 'at,cpu,heard,kind,outcome')
}

console.log(ok ? 'PASS' : 'FAIL')
process.exitCode = ok ? 0 : 1
