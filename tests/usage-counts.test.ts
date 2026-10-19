import { describe, expect, it } from 'vitest'
import {
  buildReport,
  dayKey,
  normaliseUsageDays,
  recordDictation,
  weeksSince
} from '../src/shared/usage-counts'

const at = (day: number, hour = 12): Date => new Date(2026, 9, day, hour)

describe('recordDictation', () => {
  it('counts dictations per local day', () => {
    let days = recordDictation(null, at(19, 9))
    days = recordDictation(days, at(19, 23))
    days = recordDictation(days, at(20, 0))
    expect(days).toEqual({ '2026-10-19': 2, '2026-10-20': 1 })
  })

  it('forgets days older than the last seven', () => {
    const days = recordDictation({ '2026-10-12': 4, '2026-10-13': 1 }, at(19))
    expect(days).toEqual({ '2026-10-13': 1, '2026-10-19': 1 })
  })
})

describe('normaliseUsageDays', () => {
  it('keeps day keys with whole positive counts and drops everything else', () => {
    expect(
      normaliseUsageDays({ '2026-10-19': 3.7, '2026-13-01': 2, nope: 1, '2026-10-18': -1, '2026-10-17': 'x' })
    ).toEqual({ '2026-10-19': 3 })
    expect(normaliseUsageDays(null)).toBeNull()
    expect(normaliseUsageDays([1, 2])).toBeNull()
  })
})

describe('weeksSince', () => {
  it('counts whole weeks from the first run, capped at 12', () => {
    expect(weeksSince('2026-10-12T12:00:00Z', new Date('2026-10-19T11:00:00Z'))).toBe(0)
    expect(weeksSince('2026-10-12T12:00:00Z', new Date('2026-10-19T13:00:00Z'))).toBe(1)
    expect(weeksSince('2025-01-01T00:00:00Z', new Date('2026-10-19T00:00:00Z'))).toBe(12)
  })

  it('is 0 when the first run is unknown or in the future', () => {
    expect(weeksSince(null, at(19))).toBe(0)
    expect(weeksSince('2027-01-01T00:00:00Z', at(19))).toBe(0)
  })
})

describe('buildReport', () => {
  it('holds exactly the agreed fields and nothing else', () => {
    const report = buildReport({
      version: '0.8.0',
      os: 'windows',
      engine: 'local',
      plan: 'trial',
      firstRunAt: '2026-10-10T08:00:00Z',
      days: { '2026-10-11': 9, '2026-10-14': 2, '2026-10-17': 3, '2026-10-19': 4 },
      limitHit: false,
      now: at(19)
    })
    expect(report).toEqual({
      v: '0.8.0',
      os: 'windows',
      engine: 'local',
      plan: 'trial',
      week: 1,
      activeDays7: 3,
      dictations7: 9,
      limitHit: false
    })
    expect(Object.keys(report)).toHaveLength(8)
  })

  it('caps dictations at 999', () => {
    const report = buildReport({
      version: '0.8.0',
      os: 'linux',
      engine: 'cloud',
      plan: 'pro',
      firstRunAt: null,
      days: { [dayKey(at(18))]: 999, [dayKey(at(19))]: 999 },
      limitHit: false,
      now: at(19)
    })
    expect(report.dictations7).toBe(999)
  })
})
