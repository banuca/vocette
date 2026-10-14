// Feature 18 for real: the built app against a stand-in Polar over HTTPS on
// 127.0.0.1 (self-signed; the app is launched with --ignore-certificate-errors).
// Activate → Check now (active) → the subscription ends → resubscribe → the PC
// is released in the Polar account. Screenshots of each state in e2e/subscription.
import { createServer } from 'node:https'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { freshProfile, launchApp, sleep, WORK } from './harness.mjs'

const here = WORK
const shots = join(here, 'subscription')
mkdirSync(shots, { recursive: true })
const requests = []
let mode = 'granted'
const key = {
  id: 'key-1', organization_id: 'org-fake', benefit_id: 'benefit-fake', key: 'VOCETTE-TEST-KEY',
  display_key: '****-T3ST01', status: 'granted', expires_at: null, limit_activations: 3,
  customer: { email: 'buyer@example.com', name: 'Ada Buyer' }
}
const server = createServer(
  { key: readFileSync(join(here, 'fake-polar-key.pem')), cert: readFileSync(join(here, 'fake-polar-cert.pem')) },
  (req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null
      requests.push({ path: req.url, body, auth: req.headers.authorization ?? null })
      const send = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(payload === undefined ? '' : JSON.stringify(payload))
      }
      if (req.url.endsWith('/activate')) return send(200, { id: 'activation-1', license_key: key })
      if (req.url.endsWith('/deactivate')) return send(204)
      if (req.url.endsWith('/validate')) {
        if (mode === 'granted') return send(200, { ...key, activation: { id: 'activation-1' } })
        if (mode === 'ended') return send(404, { error: 'ResourceNotFound', detail: 'License key is no longer active.' })
        if (mode === 'released') return send(404, { error: 'ResourceNotFound', detail: 'Not found' })
      }
      send(404, { error: 'ResourceNotFound', detail: 'Not found' })
    })
  }
)
await new Promise((resolve) => server.listen(8443, '127.0.0.1', resolve))

const { app, main } = await launchApp({
  profileDir: freshProfile('subscription'),
  extraArgs: ['--background', '--ignore-certificate-errors'],
  env: {
    MURMUR_POLAR_API_BASE: 'https://127.0.0.1:8443',
    MURMUR_POLAR_ORG_ID: 'org-fake',
    MURMUR_POLAR_BENEFIT_ID: 'benefit-fake'
  }
})

const pageText = () =>
  main.evaluate(() => ({
    status: document.querySelector('#pro-status')?.textContent,
    line: document.querySelector('#licence-active-line')?.textContent,
    feedback: document.querySelector('#licence-feedback')?.textContent,
    buyShown: !document.querySelector('#pro-buy')?.hidden,
    keyFieldShown: !document.querySelector('#licence-entry')?.hidden
  }))
const shot = (name) => main.locator('.pro-page').screenshot({ path: join(shots, `${name}.png`) })
const checkNow = async () => {
  await main.evaluate(() => document.querySelector('#check-subscription')?.click())
  await sleep(1200)
}

try {
  await main.waitForSelector('.app-shell', { timeout: 20_000 })
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.setContentSize(1060, 900)
    win?.setPosition(40, 40)
    win?.showInactive()
  })
  await main.evaluate(() => document.querySelector('[data-page="pro"]')?.click())
  await sleep(700)
  console.log('trial:', JSON.stringify(await pageText()))
  await shot('1-trial')

  await main.fill('#licence-key', 'VOCETTE-TEST-KEY')
  await main.evaluate(() => document.querySelector('#activate-licence')?.click())
  await sleep(1500)
  console.log('activated:', JSON.stringify(await pageText()))

  await checkNow()
  console.log('check, active:', JSON.stringify(await pageText()))
  await shot('2-active')

  mode = 'ended'
  await checkNow()
  console.log('check, ended:', JSON.stringify(await pageText()))
  console.log('plan after end:', (await main.evaluate(() => window.murmur.getLicenceStatus())).plan)
  await shot('3-ended')

  mode = 'granted'
  await checkNow()
  console.log('check, subscribed again:', JSON.stringify(await pageText()))

  mode = 'released'
  await checkNow()
  console.log('check, released:', JSON.stringify(await pageText()))
  await shot('4-released')

  console.log(
    'requests:',
    JSON.stringify(requests.map((r) => ({ path: r.path, auth: r.auth, fields: r.body ? Object.keys(r.body) : [] })))
  )
} finally {
  await app.close()
  server.close()
}
