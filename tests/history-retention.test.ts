import { describe, expect, it, vi } from 'vitest'
import { recordHistoryWithRetention } from '../src/main/history-retention'

describe('recordHistoryWithRetention', () => {
  it('reports a rejected background prune without an unhandled rejection', async () => {
    const failure = new Error('injected retention storage failure')
    const historyStore = {
      add: vi.fn(),
      prune: vi.fn(() => Promise.reject(failure))
    }
    const onRetentionFailure = vi.fn()
    const onHistoryChanged = vi.fn()
    let unhandled: unknown
    const captureUnhandled = (reason: unknown): void => {
      unhandled = reason
    }
    process.on('unhandledRejection', captureUnhandled)

    try {
      recordHistoryWithRetention(
        {
          historyStore,
          retentionDays: () => 30,
          onHistoryChanged,
          onRetentionFailure
        },
        { text: 'kept transcript', durationMs: 1250, model: 'gpt-transcribe' }
      )
      await new Promise<void>((resolve) => setImmediate(resolve))
    } finally {
      process.off('unhandledRejection', captureUnhandled)
    }

    expect(historyStore.add).toHaveBeenCalledWith({
      text: 'kept transcript',
      durationMs: 1250,
      model: 'gpt-transcribe'
    })
    expect(historyStore.prune).toHaveBeenCalledWith(30)
    expect(onHistoryChanged).toHaveBeenCalledOnce()
    expect(onRetentionFailure).toHaveBeenCalledWith(failure)
    expect(unhandled).toBeUndefined()
  })
})
