/**
 * Vocette's opt-in counts endpoint (decision M). A Cloudflare Worker that
 * accepts exactly the report the app sends (src/shared/usage-counts.ts) and
 * writes it as one row, with the UTC day added. It stores nothing else: no IP,
 * no headers, no time of day. Anything that is not exactly a report is
 * refused, so the table can only ever hold these numbers.
 *
 *   POST /v1/report  {"v":"0.8.0","os":"windows",...}  → 204
 */

const MAX_BODY_BYTES = 1024
const OS = new Set(['windows', 'macos', 'linux', 'other'])
const ENGINE = new Set(['local', 'cloud'])
const PLAN = new Set(['free', 'trial', 'pro'])
const KEYS = ['v', 'os', 'engine', 'plan', 'week', 'activeDays7', 'dictations7', 'limitHit']

const whole = (value, min, max) => Number.isInteger(value) && value >= min && value <= max

/** The report if `body` is exactly one, otherwise null. */
export function parseReport(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const keys = Object.keys(body)
  if (keys.length !== KEYS.length || !KEYS.every((key) => keys.includes(key))) return null
  const { v, os, engine, plan, week, activeDays7, dictations7, limitHit } = body
  if (typeof v !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)) return null
  if (!OS.has(os) || !ENGINE.has(engine) || !PLAN.has(plan)) return null
  if (!whole(week, 0, 12) || !whole(activeDays7, 0, 7) || !whole(dictations7, 0, 999)) return null
  if (typeof limitHit !== 'boolean') return null
  return { v, os, engine, plan, week, activeDays7, dictations7, limitHit }
}

/** "2026-10-19", UTC. */
export function utcDay(now) {
  return now.toISOString().slice(0, 10)
}

const empty = (status) => new Response(null, { status })

export async function handle(request, env, now = new Date()) {
  const url = new URL(request.url)
  if (url.pathname !== '/v1/report') return empty(404)
  if (request.method !== 'POST') return empty(405)
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return empty(415)
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return empty(413)
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return empty(413)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return empty(400)
  }
  const report = parseReport(body)
  if (!report) return empty(400)
  await env.DB.prepare(
    'INSERT INTO reports (day, v, os, engine, plan, week, active_days7, dictations7, limit_hit) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      utcDay(now),
      report.v,
      report.os,
      report.engine,
      report.plan,
      report.week,
      report.activeDays7,
      report.dictations7,
      report.limitHit ? 1 : 0
    )
    .run()
  return empty(204)
}

export default {
  fetch: (request, env) => handle(request, env)
}
