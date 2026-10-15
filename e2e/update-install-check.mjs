// K8 in a packaged build: "Download and install" against a local feed.
//
// Needs E2E_EXE (a packaged Vocette.exe) and a newer build's files in
// <work>/update-feed: latest.yml and the installer it names (build one with
// `npm version 0.6.99 --no-git-tag-version`, `node scripts/release-win.mjs
// --allow-dirty --out <work>/update-feed`, then restore package.json).
//
// It stops at "ready" and never installs: with MURMUR_UPDATE_FEED set the app
// does not install on quit either, so this PC's own Vocette is never touched.
// The downloaded installer is checked against latest.yml, then deleted.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { WORK, freshProfile, launchApp, sleep } from './harness.mjs'

if (!process.env.E2E_EXE) {
  console.error('Set E2E_EXE to a packaged Vocette.exe.')
  process.exit(1)
}
const feedDir = join(WORK, 'update-feed')
const latest = readFileSync(join(feedDir, 'latest.yml'), 'utf8')
const wantedSha = /^sha512: (.+)$/mu.exec(latest)?.[1]?.trim()
const wantedVersion = /^version: (.+)$/mu.exec(latest)?.[1]?.trim()

const requests = []
const server = createServer((req, res) => {
  const name = decodeURIComponent((req.url ?? '/').split('?')[0].replace(/^\//u, ''))
  requests.push(name)
  const file = join(feedDir, name)
  if (!name || name.includes('..') || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, { 'Content-Length': statSync(file).size })
  // About 20 MB/s, so a download lasts long enough for progress to show.
  const stream = createReadStream(file, { highWaterMark: 1 << 20 })
  stream.on('data', (chunk) => {
    stream.pause()
    res.write(chunk)
    setTimeout(() => stream.resume(), 50)
  })
  stream.on('end', () => res.end())
  res.on('close', () => stream.destroy())
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const feed = `http://127.0.0.1:${server.address().port}/`

const cache = join(process.env.LOCALAPPDATA ?? '', 'murmur-updater')
let ok = true
const expect = (label, actual, wanted) => {
  const pass = typeof wanted === 'function' ? wanted(actual) : actual === wanted
  if (!pass) ok = false
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
}

const { app, main } = await launchApp({
  profileDir: freshProfile('update-install'),
  extraArgs: ['--background'],
  env: { MURMUR_UPDATE_FEED: feed }
})
const logs = []
app.process().stderr?.on('data', (chunk) => logs.push(String(chunk)))
app.process().stdout?.on('data', (chunk) => logs.push(String(chunk)))
try {
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  const before = await main.evaluate(() => window.murmur.getUpdateInstall())
  expect('can install here', before.supported, true)
  expect('nothing fetched before asking', requests.length, 0)

  const states = []
  await main.exposeFunction('__install', (s) => states.push(s))
  await main.evaluate(() => window.murmur.onUpdateInstall((s) => window.__install(s)))
  await main.evaluate(() => window.murmur.downloadUpdate())
  for (let i = 0; i < 600 && states.at(-1)?.state !== 'ready' && states.at(-1)?.state !== 'error'; i += 1) await sleep(200)
  const last = states.at(-1)
  expect('ready', last?.state, 'ready')
  expect('version', last?.version, wantedVersion)
  expect('progress was shown', states.some((s) => s.state === 'downloading' && s.percent > 0 && s.percent < 100), true)
  console.log('  error, if any:', last?.error)
  console.log('  feed requests:', JSON.stringify([...new Set(requests)]))
  const updaterLog = logs.join('').split(/\r?\n/u).filter((line) => /update|updater/iu.test(line))
  if (updaterLog.length) console.log('  app log:\n    ' + updaterLog.slice(0, 12).join('\n    '))
} finally {
  await app.close()
  server.close()
}

// The installer electron-updater kept, against latest.yml's hash.
const pending = join(cache, 'pending')
const installer = existsSync(pending) ? readdirSync(pending).find((name) => name.endsWith('.exe')) : undefined
expect('installer downloaded', installer, (name) => typeof name === 'string')
if (installer) {
  const sha = await new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    createReadStream(join(pending, installer))
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')))
      .on('error', reject)
  })
  expect('installer matches latest.yml', sha, wantedSha)
}
rmSync(pending, { recursive: true, force: true })
console.log(ok ? 'PASS' : 'FAIL')
