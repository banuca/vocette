import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  refreshJsonRecoveryBackupAsync,
  removeJsonRecoveryCopiesAsync,
  writeJsonAtomicAsync
} from '../src/main/atomic-json'
import { HistoryStore } from '../src/main/history-store'
import type { HistorySaveStatus } from '../src/shared/types'

/**
 * A failed transcript save used to be swallowed whole: History listed the
 * entry, `flush()` resolved, and nothing on disk had changed. These cover the
 * status that makes it visible, without letting storage break a dictation.
 */

let file: string

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/** A store whose writes fail while `failing` is true; nothing else changes. */
function makeStore(): {
  store: HistoryStore
  statuses: HistorySaveStatus[]
  setFailing: (value: boolean) => void
} {
  let failing = true
  const store = new HistoryStore(file, {
    writeJsonAtomicAsync: async (path, value) => {
      if (failing) throw new Error('injected write failure')
      await writeJsonAtomicAsync(path, value)
    },
    removeJsonRecoveryCopiesAsync,
    refreshJsonRecoveryBackupAsync
  })
  const statuses: HistorySaveStatus[] = []
  store.onSaveStatusChanged((status) => statuses.push(status))
  return {
    store,
    statuses,
    setFailing: (value: boolean) => {
      failing = value
    }
  }
}

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'vh-save-status-')), 'history.json')
})

describe('HistoryStore save status', () => {
  it('reports nothing wrong before anything has been written', () => {
    expect(new HistoryStore(file).getSaveStatus()).toEqual({ saveFailed: false })
  })

  it('reports a failed background save while keeping the transcript listed', async () => {
    const { store, statuses } = makeStore()
    let unhandled: unknown
    const captureUnhandled = (reason: unknown): void => {
      unhandled = reason
    }
    process.on('unhandledRejection', captureUnhandled)

    try {
      const entry = store.add({ text: 'kept transcript', durationMs: 1250, model: 'gpt-transcribe' })
      expect(entry.text).toBe('kept transcript')
      // The queue drains whether or not the write worked, so this is exactly
      // the moment the old build called the save a success.
      await store.flush()
      await new Promise<void>((resolve) => setImmediate(resolve))
    } finally {
      process.off('unhandledRejection', captureUnhandled)
    }

    expect(store.getSaveStatus()).toEqual({ saveFailed: true })
    expect(statuses).toEqual([{ saveFailed: true }])
    // The text is still there to be copied, and nothing rejected at the caller.
    expect(store.list().map((item) => item.text)).toEqual(['kept transcript'])
    expect(unhandled).toBeUndefined()
  })

  it('reports a failed save when retention is enabled but has nothing to prune', async () => {
    const { store, statuses } = makeStore()

    store.add({ text: 'todays transcript', durationMs: 900, model: 'gpt-transcribe' })
    // Nothing is old enough to expire, so retention resolves without pruning
    // and must not be the thing that makes the failure visible.
    await expect(store.prune(30)).resolves.toBe(false)
    await store.flush()

    expect(store.getSaveStatus()).toEqual({ saveFailed: true })
    expect(statuses).toEqual([{ saveFailed: true }])
    expect(store.list()).toHaveLength(1)
  })

  it('clears the warning once a later write saves the retained entries', async () => {
    const { store, statuses, setFailing } = makeStore()

    store.add({ text: 'first', durationMs: 1, model: 'm' })
    await store.flush()
    expect(store.getSaveStatus()).toEqual({ saveFailed: true })

    setFailing(false)
    store.add({ text: 'second', durationMs: 1, model: 'm' })
    await store.flush()

    expect(store.getSaveStatus()).toEqual({ saveFailed: false })
    expect(statuses).toEqual([{ saveFailed: true }, { saveFailed: false }])
    // The entry that failed to save was carried into the successful snapshot.
    expect(new HistoryStore(file).list().map((item) => item.text)).toEqual(['second', 'first'])
  })

  it('keeps the warning until a successful write covers everything in memory', async () => {
    const secondWriteStarted = deferred<void>()
    const releaseSecondWrite = deferred<void>()
    const thirdWriteStarted = deferred<void>()
    const releaseThirdWrite = deferred<void>()
    const statuses: HistorySaveStatus[] = []
    let write = 0
    const store = new HistoryStore(file, {
      writeJsonAtomicAsync: async (path, value) => {
        write += 1
        if (write === 1) throw new Error('injected write failure')
        if (write === 2) {
          secondWriteStarted.resolve()
          await releaseSecondWrite.promise
        }
        if (write === 3) {
          thirdWriteStarted.resolve()
          await releaseThirdWrite.promise
        }
        await writeJsonAtomicAsync(path, value)
      },
      removeJsonRecoveryCopiesAsync,
      refreshJsonRecoveryBackupAsync
    })
    store.onSaveStatusChanged((status) => statuses.push(status))

    try {
      store.add({ text: 'first', durationMs: 1, model: 'm' })
      store.add({ text: 'second', durationMs: 1, model: 'm' })
      await secondWriteStarted.promise
      // Queued behind the snapshot now in flight, which was taken before this
      // entry existed and so can say nothing about it.
      store.add({ text: 'third', durationMs: 1, model: 'm' })
      releaseSecondWrite.resolve()

      // Writes are serialised, so the third one starting is proof that the
      // second finished and its status handling ran — no event-loop guesswork.
      await thirdWriteStarted.promise

      // A write succeeded, but not the one carrying the newest entry, so the
      // user must still be told history is at risk.
      expect(store.getSaveStatus()).toEqual({ saveFailed: true })
      expect(statuses).toEqual([{ saveFailed: true }])
    } finally {
      // Never leave the store wedged on a gate when an assertion throws.
      releaseSecondWrite.resolve()
      releaseThirdWrite.resolve()
    }

    await store.flush()

    expect(store.getSaveStatus()).toEqual({ saveFailed: false })
    expect(statuses).toEqual([{ saveFailed: true }, { saveFailed: false }])
    expect(
      JSON.parse(readFileSync(file, 'utf8')).map((item: { text: string }) => item.text)
    ).toEqual(['third', 'second', 'first'])
  })

  it('does not blame a save for a companion-cleanup failure', async () => {
    const statuses: HistorySaveStatus[] = []
    const store = new HistoryStore(file, {
      writeJsonAtomicAsync,
      removeJsonRecoveryCopiesAsync: () => Promise.reject(new Error('injected cleanup failure')),
      refreshJsonRecoveryBackupAsync
    })
    store.onSaveStatusChanged((status) => statuses.push(status))

    store.add({ text: 'saved fine', durationMs: 1, model: 'm' })
    await expect(store.clear()).rejects.toThrow('injected cleanup failure')

    // The snapshot reached disk; only the recovery-copy scrub did not. That is
    // a retention problem, reported by the rejection, not lost history.
    expect(store.getSaveStatus()).toEqual({ saveFailed: false })
    expect(statuses).toEqual([])
  })

  it('preserves write ordering and destructive-cleanup guarantees while failing', async () => {
    const snapshots: string[][] = []
    const cleanups: string[] = []
    let failing = true
    const store = new HistoryStore(file, {
      writeJsonAtomicAsync: async (path, value) => {
        const entries = Array.isArray(value) ? value : []
        snapshots.push(entries.map((entry) => (entry as { text: string }).text))
        if (failing) throw new Error('injected write failure')
        await writeJsonAtomicAsync(path, value)
      },
      removeJsonRecoveryCopiesAsync: async (path) => {
        cleanups.push('remove')
        await removeJsonRecoveryCopiesAsync(path)
      },
      refreshJsonRecoveryBackupAsync: async (path) => {
        cleanups.push('refresh')
        await refreshJsonRecoveryBackupAsync(path)
      }
    })

    const doomed = store.add({ text: 'delete me', durationMs: 1, model: 'm' })
    const deletion = store.delete(doomed.id)
    store.add({ text: 'later addition', durationMs: 1, model: 'm' })

    await expect(deletion).rejects.toThrow('injected write failure')
    // A failed destructive write must not have scrubbed anything.
    expect(cleanups).toEqual([])
    expect(store.getSaveStatus()).toEqual({ saveFailed: true })

    failing = false
    await store.clear()
    expect(store.getSaveStatus()).toEqual({ saveFailed: false })
    expect(snapshots).toEqual([['delete me'], [], ['later addition'], []])
    expect(cleanups).toEqual(['remove', 'refresh'])
    expect(new HistoryStore(file).list()).toEqual([])
  })

  it('stops notifying an unsubscribed listener', async () => {
    const { store, setFailing } = makeStore()
    const seen: HistorySaveStatus[] = []
    const unsubscribe = store.onSaveStatusChanged((status) => seen.push(status))

    store.add({ text: 'first', durationMs: 1, model: 'm' })
    await store.flush()
    unsubscribe()
    setFailing(false)
    store.add({ text: 'second', durationMs: 1, model: 'm' })
    await store.flush()

    expect(seen).toEqual([{ saveFailed: true }])
    expect(store.getSaveStatus()).toEqual({ saveFailed: false })
  })

  it('survives a listener that throws', async () => {
    const { store } = makeStore()
    store.onSaveStatusChanged(() => {
      throw new Error('listener blew up')
    })
    const after = vi.fn()
    store.onSaveStatusChanged(after)

    store.add({ text: 'first', durationMs: 1, model: 'm' })
    await store.flush()

    expect(after).toHaveBeenCalledWith({ saveFailed: true })
    expect(store.getSaveStatus()).toEqual({ saveFailed: true })
  })
})
