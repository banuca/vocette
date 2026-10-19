// M1 in the built app, against a local stand-in for counts.vocette.com:
// switched off, nothing is sent; switched on, exactly one report arrives,
// identical to what About's "Show what is sent" shows; a restart the same
// day sends nothing more; switched off again, the tally is gone.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { freshProfile, launchApp, sleep } from './harness.mjs'

const received = []
const server = createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => (body += chunk))
  request.on('end', () => {
    received.push({ method: request.method, url: request.url, headers: request.headers, body })
    response.writeHead(204).end()
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/v1/report`
const env = { MURMUR_COUNTS_URL: url, MURMUR_COUNTS_DELAY_MS: '1500' }
const profileDir = freshProfile('counts')

let ok = true
const expect = (label, actual, wanted) => {
  const pass = typeof wanted === 'function' ? wanted(actual) : JSON.stringify(actual) === JSON.stringify(wanted)
  if (!pass) ok = false
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
}

try {
  {
    const { app, main } = await launchApp({ profileDir, env })
    try {
      await main.waitForSelector('.app-shell', { timeout: 20_000 })
      await sleep(4000)
      expect('off: nothing sent', received.length, 0)
      const status = await main.evaluate(() => window.murmur.setUsageCounts(true))
      expect('switched on', status.enabled, true)
      await sleep(4000)
      expect('on: one report', received.length, 1)
      const shown = await main.evaluate(() => window.murmur.getCounts())
      const sent = received[0] ?? { headers: {}, body: '{}' }
      expect('POST to the path', `${sent.method} ${sent.url}`, 'POST /v1/report')
      expect('report equals what About shows', JSON.parse(sent.body), shown.report)
      expect('eight fields', Object.keys(JSON.parse(sent.body)).sort(), [
        'activeDays7', 'dictations7', 'engine', 'limitHit', 'os', 'plan', 'v', 'week'
      ])
      expect('no cookie', sent.headers.cookie, undefined)
      expect('plain User-Agent', sent.headers['user-agent'], 'Vocette')
    } finally {
      await app.close()
    }
  }
  {
    const { app, main } = await launchApp({ profileDir, env })
    try {
      await main.waitForSelector('.app-shell', { timeout: 20_000 })
      await sleep(4000)
      expect('restart same day: nothing more', received.length, 1)
      await main.evaluate(() => window.murmur.setUsageCounts(false))
    } finally {
      await app.close()
    }
  }
  const stored = JSON.parse(readFileSync(join(profileDir, 'settings.json'), 'utf8'))
  expect('off again: tally gone', { usageCounts: stored.usageCounts, usageDays: stored.usageDays }, {
    usageCounts: false,
    usageDays: null
  })
} finally {
  server.close()
}
console.log(ok ? 'PASS' : 'FAIL')
