import { describe, expect, it } from 'vitest'
// @ts-expect-error The Worker is plain JavaScript with no type declarations.
import { handle, parseReport, utcDay } from '../server/counts/src/index.js'
import type { CountsReport } from '../src/shared/usage-counts'

const REPORT: CountsReport = {
  v: '0.8.0',
  os: 'windows',
  engine: 'local',
  plan: 'trial',
  week: 1,
  activeDays7: 5,
  dictations7: 42,
  limitHit: false
}

function fakeDb() {
  const rows: unknown[][] = []
  return {
    rows,
    DB: {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({
          run: async () => {
            expect(sql).toMatch(/^INSERT INTO reports/u)
            rows.push(values)
          }
        })
      })
    }
  }
}

const post = (body: string, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  new Request('https://counts.vocette.com/v1/report', { method: 'POST', body, headers })

describe('parseReport', () => {
  it('accepts exactly the report the app sends', () => {
    expect(parseReport(REPORT)).toEqual(REPORT)
  })

  it('refuses an extra field, a missing one, or a value out of range', () => {
    expect(parseReport({ ...REPORT, id: 'abc' })).toBeNull()
    const { limitHit: _dropped, ...missing } = REPORT
    expect(parseReport(missing)).toBeNull()
    expect(parseReport({ ...REPORT, week: 13 })).toBeNull()
    expect(parseReport({ ...REPORT, activeDays7: 8 })).toBeNull()
    expect(parseReport({ ...REPORT, dictations7: 1.5 })).toBeNull()
    expect(parseReport({ ...REPORT, os: 'amiga' })).toBeNull()
    expect(parseReport({ ...REPORT, v: 'Remind me to send the invoice' })).toBeNull()
    expect(parseReport({ ...REPORT, limitHit: 'no' })).toBeNull()
    expect(parseReport([REPORT])).toBeNull()
  })
})

describe('handle', () => {
  it('stores one row with the UTC day and nothing else', async () => {
    const db = fakeDb()
    const response = await handle(post(JSON.stringify(REPORT)), db, new Date('2026-10-19T23:30:00Z'))
    expect(response.status).toBe(204)
    expect(db.rows).toEqual([['2026-10-19', '0.8.0', 'windows', 'local', 'trial', 1, 5, 42, 0]])
  })

  it('refuses anything that is not a report, and stores nothing', async () => {
    const db = fakeDb()
    expect((await handle(post('not json'), db)).status).toBe(400)
    expect((await handle(post(JSON.stringify({ ...REPORT, words: 'hello' })), db)).status).toBe(400)
    expect((await handle(post(JSON.stringify(REPORT), { 'content-type': 'text/plain' }), db)).status).toBe(415)
    expect((await handle(post('x'.repeat(2000)), db)).status).toBe(413)
    expect((await handle(new Request('https://counts.vocette.com/v1/report'), db)).status).toBe(405)
    expect((await handle(new Request('https://counts.vocette.com/'), db)).status).toBe(404)
    expect(db.rows).toEqual([])
  })

  it('names the day in UTC', () => {
    expect(utcDay(new Date('2026-10-19T00:00:00Z'))).toBe('2026-10-19')
  })
})
