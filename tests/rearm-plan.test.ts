import { describe, expect, it } from 'vitest'
import { REARM_DEBOUNCE_MS, rearmPlan } from '../src/main/rearm-plan'

describe('putting the keyboard hook back after a sleep or a lock', () => {
  it('re-arms the first time, and whenever the last re-arm was a while ago', () => {
    expect(rearmPlan({ recording: false, lastRearmAt: null, now: 1_000 })).toBe('rearm')
    expect(
      rearmPlan({ recording: false, lastRearmAt: 1_000, now: 1_000 + REARM_DEBOUNCE_MS })
    ).toBe('rearm')
  })

  it('does it once when resume and unlock arrive together', () => {
    expect(rearmPlan({ recording: false, lastRearmAt: 1_000, now: 1_000 })).toBe('skip')
    expect(
      rearmPlan({ recording: true, lastRearmAt: 1_000, now: 1_000 + REARM_DEBOUNCE_MS - 1 })
    ).toBe('skip')
  })

  it('cancels a take still recording first', () => {
    expect(rearmPlan({ recording: true, lastRearmAt: null, now: 1_000 })).toBe('cancel-then-rearm')
    expect(rearmPlan({ recording: true, lastRearmAt: 1_000, now: 60_000 })).toBe(
      'cancel-then-rearm'
    )
  })

  it('is not stopped by a clock set back after the resume', () => {
    expect(rearmPlan({ recording: false, lastRearmAt: 90_000, now: 10_000 })).toBe('rearm')
  })
})
