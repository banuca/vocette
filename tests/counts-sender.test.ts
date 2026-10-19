import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COUNTS_URL,
  CountsSender,
  FIRST_SEND_DELAY_MS,
  SEND_INTERVAL_MS,
  countsUrl,
  type CountsFetch
} from '../src/main/counts-sender'
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

function sender(options: { enabled?: boolean; url?: string | null; lastSentAt?: string | null; fail?: boolean } = {}) {
  let enabled = options.enabled ?? true
  let last = options.lastSentAt ?? null
  const requests: Array<{ url: string; init: RequestInit }> = []
  const fetch: CountsFetch = async (url, init) => {
    requests.push({ url, init })
    if (options.fail) throw new Error('offline')
    return new Response(null, { status: 204 })
  }
  const instance = new CountsSender({
    fetch,
    url: options.url === undefined ? 'https://counts.test/v1/report' : options.url,
    enabled: () => enabled,
    report: () => REPORT,
    lastSentAt: () => last,
    saveLastSentAt: (iso) => {
      last = iso
    },
    now: () => Date.now()
  })
  return {
    instance,
    requests,
    last: () => last,
    setEnabled: (value: boolean) => {
      enabled = value
    }
  }
}

describe('countsUrl', () => {
  it('sends a packaged app to the real counter', () => {
    expect(countsUrl({ MURMUR_COUNTS_URL: 'http://localhost:9' }, true)).toBe(COUNTS_URL)
  })

  it('sends a development build only where it is told, and otherwise nowhere', () => {
    expect(countsUrl({}, false)).toBeNull()
    expect(countsUrl({ MURMUR_COUNTS_URL: ' http://localhost:8787/v1/report ' }, false)).toBe(
      'http://localhost:8787/v1/report'
    )
  })
})

describe('CountsSender', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('sends nothing while switched off', async () => {
    const s = sender({ enabled: false })
    await s.instance.sendIfDue()
    s.instance.start()
    await vi.advanceTimersByTimeAsync(3 * SEND_INTERVAL_MS)
    expect(s.requests).toEqual([])
    expect(s.last()).toBeNull()
  })

  it('sends nothing with nowhere to send', async () => {
    const s = sender({ url: null })
    await s.instance.sendIfDue()
    expect(s.requests).toEqual([])
  })

  it('posts the report itself, with no cookies and a plain User-Agent', async () => {
    const s = sender()
    await s.instance.sendIfDue()
    expect(s.requests).toHaveLength(1)
    const { url, init } = s.requests[0]!
    expect(url).toBe('https://counts.test/v1/report')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('omit')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'User-Agent': 'Vocette' })
    expect(JSON.parse(init.body as string)).toEqual(REPORT)
  })

  it('sends at most once a day, also across restarts', async () => {
    const s = sender()
    await s.instance.sendIfDue()
    await s.instance.sendIfDue()
    vi.setSystemTime(new Date('2026-10-20T11:59:00Z'))
    await s.instance.sendIfDue()
    expect(s.requests).toHaveLength(1)
    vi.setSystemTime(new Date('2026-10-20T12:00:01Z'))
    await s.instance.sendIfDue()
    expect(s.requests).toHaveLength(2)
  })

  it('waits a day after a failure instead of retrying', async () => {
    const s = sender({ fail: true })
    await s.instance.sendIfDue()
    await s.instance.sendIfDue()
    expect(s.requests).toHaveLength(1)
    expect(s.last()).toBe('2026-10-19T12:00:00.000Z')
  })

  it('waits a minute after startup, and a minute after being switched on', async () => {
    const s = sender({ enabled: false })
    s.instance.start()
    s.setEnabled(true)
    s.instance.enabledChanged()
    await vi.advanceTimersByTimeAsync(FIRST_SEND_DELAY_MS - 1)
    expect(s.requests).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(s.requests).toHaveLength(1)
    s.instance.stop()
  })

  it('treats a clock set back as no recent report', async () => {
    const s = sender({ lastSentAt: '2026-12-01T00:00:00Z' })
    await s.instance.sendIfDue()
    expect(s.requests).toHaveLength(1)
  })
})
