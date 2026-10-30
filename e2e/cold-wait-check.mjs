// How much longer the first dictation waits once the on-device engine has
// unloaded after its idle time (CTO review, 30 Oct: gap 2). In the built app,
// with the fake microphone, it times the wait from Stop (the same moment as
// letting go of the shortcut) to the text, with a warm engine and with one
// that has just unloaded, after a short (2 s) and a normal (7 s) take. The
// number reported is the app's own, History's `waitMs`; the script's clock is
// printed beside it. It also reports the app's memory, loaded and unloaded.
//
//   node e2e/cold-wait-check.mjs [rounds=2]
//
// Each cold take follows a real idle unload, the engine's own timer ending
// its process. The development build is told to unload after E2E_IDLE_MS
// (MURMUR_ENGINE_IDLE_MS; default 20 s, against 30 minutes in use), and the
// script checks the process has gone before the take. Set E2E_IDLE_MS to
// 1800000 to wait out the real timer. Uses the bench's copy of the model, so
// nothing is downloaded.
//
// It runs for a long time on a PC someone may be using, so the app's shortcut
// is off from the first moment (a dictation in the owner's own Vocette must
// not start a take here and paste the test recording into their work), the
// resting pill stays hidden, and the app's clipboard is kept in memory: the
// real one is never written.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AUDIO, freshProfile, launchApp, sleep } from './harness.mjs'

const rounds = Number(process.argv[2] ?? 2)
if (!(rounds >= 1)) {
  console.error('usage: node e2e/cold-wait-check.mjs [rounds]')
  process.exit(2)
}
const idleMs = Number(process.env.E2E_IDLE_MS) || 20_000

const profileDir = freshProfile('cold-wait')
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
const models = join(process.env.LOCALAPPDATA, 'vocette-bench', 'app-models')
const { app, main } = await launchApp({
  profileDir,
  audioFile: `${AUDIO}%noloop`,
  extraArgs: ['--background'],
  env: { MURMUR_MODELS_DIR: models, MURMUR_ENGINE_IDLE_MS: String(idleMs) }
})
app.process().stderr?.on('data', (data) => {
  if (/error|fatal/iu.test(String(data))) process.stdout.write(`     [app] ${data}`)
})
app.process().on('exit', (code) => console.log(`     [app exited with ${code}]`))

// Nothing of this copy of the app on screen while it runs: no pill over the
// owner's work, and a tray icon that does not animate.
await app.evaluate(({ BrowserWindow, Tray }) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.getURL().includes('overlay.html')) continue
    window.hide()
    window.show = () => undefined
    window.showInactive = () => undefined
  }
  Tray.prototype.setImage = () => undefined
})

const isolated = await app.evaluate(({ clipboard }) => {
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
  clipboard.writeText('isolated')
  return clipboard.readText() === 'isolated'
})
if (!isolated) throw new Error('Could not keep the app off the real clipboard')

/** The engine's utility process, with its memory; null when there is none. */
const engineProcess = () =>
  app.evaluate(({ app: electronApp }) => {
    const found = electronApp
      .getAppMetrics()
      .find((m) => m.type === 'Utility' && /speech engine/iu.test(`${m.name ?? ''} ${m.serviceName ?? ''}`))
    return found ? { pid: found.pid, workingSetMb: Math.round(found.memory.workingSetSize / 1024) } : null
  })

/** Every Vocette process: working set and private bytes, in MB. */
const appMemory = () =>
  app.evaluate(({ app: electronApp }) => {
    const all = electronApp.getAppMetrics()
    const mb = (kb) => Math.round(kb / 1024)
    return {
      workingSetMb: mb(all.reduce((sum, m) => sum + m.memory.workingSetSize, 0)),
      privateMb: mb(all.reduce((sum, m) => sum + (m.memory.privateBytes ?? 0), 0))
    }
  })
const memoryLine = async () => {
  const memory = await appMemory()
  return `working set ${memory.workingSetMb} MB, private ${memory.privateMb} MB`
}

const statuses = () => main.evaluate(() => window.__s)

async function waitForUnload() {
  if (!(await engineProcess())) throw new Error('No engine process to wait for')
  process.stdout.write(`     waiting ${(idleMs / 60_000).toFixed(1)} min for the idle unload… `)
  await sleep(idleMs + 5_000)
  for (let i = 0; i < 100 && (await engineProcess()); i += 1) await sleep(100)
  if (await engineProcess()) throw new Error('The engine is still loaded after its idle time')
  console.log('unloaded')
}

async function take(seconds) {
  const before = new Set((await main.evaluate(() => window.murmur.getHistory())).map((e) => e.id))
  await main.evaluate(() => {
    window.__s = []
  })
  await main.evaluate(() => window.murmur.startRecording())
  for (let i = 0; i < 200; i += 1) {
    const phases = (await statuses()).map((s) => s.phase)
    if (phases.includes('recording')) break
    if (phases.includes('error')) throw new Error('The take failed to start')
    await sleep(25)
  }
  // Timed from the moment the microphone is live, which is also when the
  // engine starts loading.
  await sleep(seconds * 1000)
  const stoppedAt = Date.now()
  await main.evaluate(() => window.murmur.stopRecording())
  let final = null
  for (let i = 0; i < 2400 && !final; i += 1) {
    final = (await statuses()).findLast((s) => ['success', 'error', 'cancelled'].includes(s.phase))
    if (!final) await sleep(25)
  }
  const scriptMs = Date.now() - stoppedAt
  const entry = (await main.evaluate(() => window.murmur.getHistory())).find((e) => !before.has(e.id))
  // Long enough for the status to settle before anything else happens.
  await sleep(2500)
  return {
    phase: final?.phase ?? 'timeout',
    message: `${final?.message ?? ''} ${final?.detail ?? ''}`.trim(),
    waitMs: entry?.waitMs ?? null,
    scriptMs,
    words: entry ? entry.text.split(/\s+/u).filter(Boolean).length : 0
  }
}

const results = []
const note = (kind, seconds, round, outcome) => {
  results.push({ kind, seconds, round, ...outcome })
  const wait = outcome.waitMs === null ? '    ?' : String(outcome.waitMs).padStart(5)
  console.log(
    `${kind.padEnd(6)} ${seconds} s  round ${round}: wait ${wait} ms (script ${String(outcome.scriptMs).padStart(5)} ms) ` +
      `${outcome.phase} · ${outcome.words} words${outcome.phase === 'success' ? '' : ` · ${outcome.message}`}`
  )
}

try {
  await main.waitForSelector('.app-shell', { timeout: 30_000 })
  const engine = await main.evaluate(() => window.murmur.getEngineStatus())
  if (engine.model.state !== 'installed') throw new Error(`model ${engine.model.state}, not installed`)
  const settings = await main.evaluate(() => window.murmur.getSettings())
  if (settings.hotkeyEnabled || settings.autoPaste || settings.engine !== 'local') {
    throw new Error('The seeded settings were not applied')
  }
  await main.evaluate(() => {
    window.__s = []
    window.murmur.onWorkflowStatus((s) => window.__s.push(s))
  })
  console.log(`${rounds} round(s); idle unload after ${(idleMs / 60_000).toFixed(1)} min`)
  console.log(`memory before any take: ${await memoryLine()}`)

  // The first take after launch is cold too, and may load from a cold disk
  // cache; it is reported on its own.
  note('launch', 7, 0, await take(7))
  console.log(`memory with the engine loaded: ${await memoryLine()} (engine ${(await engineProcess())?.workingSetMb} MB)`)

  for (let round = 1; round <= rounds; round += 1) {
    for (const seconds of [2, 7]) {
      await waitForUnload()
      if (round === 1 && seconds === 2) console.log(`memory once unloaded: ${await memoryLine()}`)
      note('cold', seconds, round, await take(seconds))
      note('warm', seconds, round, await take(seconds))
    }
  }

  const median = (list) => {
    const sorted = [...list].sort((a, b) => a - b)
    return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null
  }
  console.log('\nmedian wait (History waitMs), successful takes only:')
  for (const seconds of [2, 7]) {
    const of = (kind) =>
      results.filter((r) => r.kind === kind && r.seconds === seconds && r.phase === 'success').map((r) => r.waitMs)
    const warm = median(of('warm'))
    const cold = median(of('cold'))
    console.log(
      `  ${seconds} s take: warm ${warm} ms [${of('warm').join(', ')}], cold ${cold} ms [${of('cold').join(', ')}], ` +
        `cold costs ${cold !== null && warm !== null ? cold - warm : '?'} ms more`
    )
  }
  const failed = results.filter((r) => r.phase !== 'success')
  console.log(failed.length ? `FAIL: ${failed.length} take(s) did not deliver` : 'PASS: every take delivered')
} finally {
  await app.close()
}
