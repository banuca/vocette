import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LICENCE_MESSAGES, type CheckResult } from '../src/main/licence'
import type { LicenceRecord } from '../src/main/settings-store'
import {
  CHECK_INTERVAL_MS,
  DUE_TICK_MS,
  FIRST_CHECK_DELAY_MS,
  RETRY_INTERVAL_MS,
  SubscriptionChecker
} from '../src/main/subscription-check'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-10-05T10:00:00.000Z')

function record(patch: Partial<LicenceRecord> = {}): LicenceRecord {
  return {
    activationId: 'b6724bc8-7ad9-4ca0-b143-7c896fcbb6fe',
    benefitId: '32a8eda4-56cf-4a94-8228-792d324a519e',
    displayKey: '****-E304DA',
    activatedAt: '2026-09-25T13:48:13.251Z',
    subscription: 'active',
    confirmedAt: new Date(NOW - 25 * HOUR).toISOString(),
    ...patch
  }
}

function harness(options: { licence?: LicenceRecord | null; answer?: () => Promise<CheckResult> } = {}) {
  let licence: LicenceRecord | null = options.licence === undefined ? record() : options.licence
  let busy = false
  const check = vi.fn(options.answer ?? (async (): Promise<CheckResult> => ({ outcome: 'active' })))
  const recordCheck = vi.fn((result: 'active' | 'ended', at: string) => {
    if (!licence) return
    licence = result === 'active' ? { ...licence, subscription: 'active', confirmedAt: at } : { ...licence, subscription: 'ended' }
  })
  const release = vi.fn(() => {
    licence = null
  })
  const onChange = vi.fn()
  const key = vi.fn(() => 'VOCETTE-KEY')
  const checker = new SubscriptionChecker({
    licence: () => licence,
    key,
    check,
    record: recordCheck,
    release,
    busy: () => busy,
    onChange
  })
  return {
    checker,
    check,
    recordCheck,
    release,
    onChange,
    key,
    licence: () => licence,
    setLicence: (next: LicenceRecord | null) => {
      licence = next
    },
    setBusy: (next: boolean) => {
      busy = next
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the daily subscription check', () => {
  it('asks nothing at startup, then checks a minute later when the last confirmation is a day old', async () => {
    const h = harness()
    h.checker.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1)
    expect(h.check).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.check).toHaveBeenCalledTimes(1)
    expect(h.check).toHaveBeenCalledWith('VOCETTE-KEY', expect.objectContaining({ activationId: record().activationId }))
    expect(h.recordCheck).toHaveBeenCalledWith('active', new Date(NOW + FIRST_CHECK_DELAY_MS).toISOString())
    h.checker.stop()
  })

  it('then asks no more than once a day while the subscription is confirmed', async () => {
    const h = harness()
    h.checker.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS)
    expect(h.check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - DUE_TICK_MS)
    expect(h.check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(DUE_TICK_MS)
    expect(h.check).toHaveBeenCalledTimes(2)
    h.checker.stop()
  })

  it('does not ask when the last confirmation is recent', async () => {
    const h = harness({ licence: record({ confirmedAt: new Date(NOW - 2 * HOUR).toISOString() }) })
    h.checker.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 12 * HOUR)
    expect(h.check).not.toHaveBeenCalled()
    h.checker.stop()
  })

  it('sends nothing at all without a licence on this PC', async () => {
    const h = harness({ licence: null })
    h.checker.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + 3 * CHECK_INTERVAL_MS)
    expect(h.check).not.toHaveBeenCalled()
    await h.checker.checkNow()
    expect(h.check).not.toHaveBeenCalled()
    h.checker.stop()
  })

  it('retries hourly after a check that learnt nothing, changing nothing meanwhile', async () => {
    const h = harness({
      answer: async () => ({ outcome: 'unknown', error: LICENCE_MESSAGES.checkUnreachable })
    })
    h.checker.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS)
    expect(h.check).toHaveBeenCalledTimes(1)
    expect(h.recordCheck).not.toHaveBeenCalled()
    expect(h.checker.lastMessage()).toBe(LICENCE_MESSAGES.checkUnreachable)
    await vi.advanceTimersByTimeAsync(RETRY_INTERVAL_MS - DUE_TICK_MS)
    expect(h.check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(DUE_TICK_MS)
    expect(h.check).toHaveBeenCalledTimes(2)
    h.checker.stop()
  })

  it('keeps an ended subscription, and asks again daily so a new one is noticed', async () => {
    const h = harness({ answer: async () => ({ outcome: 'ended' }) })
    h.checker.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS)
    expect(h.recordCheck).toHaveBeenCalledWith('ended', expect.any(String))
    expect(h.licence()?.subscription).toBe('ended')
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - DUE_TICK_MS)
    expect(h.check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(DUE_TICK_MS)
    expect(h.check).toHaveBeenCalledTimes(2)
    h.checker.stop()
  })

  it('forgets the licence here when Polar no longer knows this PC, and says why', async () => {
    const h = harness({ answer: async () => ({ outcome: 'released' }) })
    await h.checker.checkNow()
    expect(h.release).toHaveBeenCalledTimes(1)
    expect(h.licence()).toBeNull()
    expect(h.checker.lastMessage()).toBe(LICENCE_MESSAGES.released)
  })
})

describe('Check now', () => {
  it('checks at once, however recent the last confirmation, and says when it is out', async () => {
    let finish: (result: CheckResult) => void = () => undefined
    const h = harness({
      licence: record({ confirmedAt: new Date(NOW).toISOString() }),
      answer: () =>
        new Promise<CheckResult>((resolve) => {
          finish = resolve
        })
    })
    const first = h.checker.checkNow()
    const second = h.checker.checkNow()
    expect(h.checker.isChecking()).toBe(true)
    expect(h.check).toHaveBeenCalledTimes(1)
    finish({ outcome: 'active' })
    await Promise.all([first, second])
    expect(h.checker.isChecking()).toBe(false)
    // Once when it went out, once when it came back.
    expect(h.onChange).toHaveBeenCalledTimes(2)
  })

  it('waits while activation or release is talking to Polar', async () => {
    const h = harness()
    h.setBusy(true)
    await h.checker.checkNow()
    expect(h.check).not.toHaveBeenCalled()
  })

  it('drops an answer about a licence that was replaced while it was out', async () => {
    let finish: (result: CheckResult) => void = () => undefined
    const h = harness({
      answer: () =>
        new Promise<CheckResult>((resolve) => {
          finish = resolve
        })
    })
    const pending = h.checker.checkNow()
    h.setLicence(record({ activationId: 'a-new-activation' }))
    finish({ outcome: 'released' })
    await pending
    expect(h.release).not.toHaveBeenCalled()
    expect(h.recordCheck).not.toHaveBeenCalled()
  })

  it('says so when the stored key cannot be read, and sends nothing', async () => {
    const h = harness()
    h.key.mockImplementation(() => {
      throw new Error('The saved licence key could not be read.')
    })
    await h.checker.checkNow()
    expect(h.check).not.toHaveBeenCalled()
    expect(h.checker.lastMessage()).toBe('The saved licence key could not be read.')
  })
})
