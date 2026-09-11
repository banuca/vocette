import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  refreshJsonRecoveryBackupAsync,
  removeJsonRecoveryCopiesAsync,
  writeJsonAtomicAsync
} from '../src/main/atomic-json'
import { HistoryStore } from '../src/main/history-store'

let file: string

/** Writes are async (open → write → fsync → backup → rename); give them a tick. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'vh-history-')), 'history.json')
})

describe('HistoryStore', () => {
  it('starts empty', () => {
    expect(new HistoryStore(file).list()).toEqual([])
  })

  it('adds newest first and assigns an id and timestamp', async () => {
    const store = new HistoryStore(file)
    store.add({ text: 'first', durationMs: 1000, model: 'gpt-transcribe' })
    const second = store.add({ text: 'second', durationMs: 2000, model: 'gpt-transcribe' })

    const list = store.list()
    expect(list.map((entry) => entry.text)).toEqual(['second', 'first'])
    expect(second.id).toMatch(/^[0-9a-f-]{36}$/u)
    expect(Number.isNaN(Date.parse(second.createdAt))).toBe(false)

    await flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(2)
  })

  it('reads the pretty-printed file written by v0.1.0', () => {
    writeFileSync(
      file,
      JSON.stringify(
        [
          {
            id: 'a',
            text: 'old entry',
            createdAt: '2026-08-04T13:22:18.012Z',
            durationMs: 5000,
            model: 'gpt-transcribe'
          }
        ],
        null,
        2
      )
    )
    expect(new HistoryStore(file).list()).toHaveLength(1)
  })

  it('drops malformed entries rather than failing to load', () => {
    writeFileSync(file, JSON.stringify([{ text: 'no id' }, 42, null]))
    expect(new HistoryStore(file).list()).toEqual([])
  })

  it('deletes by id', async () => {
    const store = new HistoryStore(file)
    const entry = store.add({ text: 'delete me', durationMs: 1, model: 'm' })
    store.add({ text: 'keep me', durationMs: 1, model: 'm' })
    expect((await store.delete(entry.id)).map((item) => item.text)).toEqual(['keep me'])
  })

  it('does not restore a deleted entry from a backup after the primary becomes unreadable', async () => {
    const store = new HistoryStore(file)
    const deleted = store.add({ text: 'delete me', durationMs: 1, model: 'm' })
    store.add({ text: 'keep me', durationMs: 1, model: 'm' })
    await store.flush()
    writeFileSync(`${file}.tmp`, 'stale temporary copy')
    writeFileSync(`${file}.corrupt`, 'stale corrupt copy')

    await store.delete(deleted.id)
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).map((entry: { text: string }) => entry.text)).toEqual([
      'keep me'
    ])
    expect(existsSync(`${file}.tmp`)).toBe(false)
    expect(existsSync(`${file}.corrupt`)).toBe(false)

    writeFileSync(file, 'not valid json')
    expect(new HistoryStore(file).list().map((entry) => entry.text)).toEqual(['keep me'])
  })

  it('clears everything', async () => {
    const store = new HistoryStore(file)
    store.add({ text: 'a', durationMs: 1, model: 'm' })
    await store.clear()
    expect(store.list()).toEqual([])
  })

  it('does not restore cleared history from a backup after the primary becomes unreadable', async () => {
    const store = new HistoryStore(file)
    store.add({ text: 'remove all', durationMs: 1, model: 'm' })
    store.add({ text: 'remove this too', durationMs: 1, model: 'm' })
    await store.flush()

    await store.clear()
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8'))).toEqual([])

    writeFileSync(file, 'not valid json')
    expect(new HistoryStore(file).list()).toEqual([])
  })

  it('prunes only past the retention window and reports whether it changed anything', async () => {
    const store = new HistoryStore(file)
    store.add({ text: 'recent', durationMs: 1, model: 'm' })
    await store.flush()
    expect(await store.prune(0)).toBe(false)
    expect(await store.prune(30)).toBe(false)

    writeFileSync(
      file,
      JSON.stringify([
        {
          id: 'old',
          text: 'ancient',
          createdAt: new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString(),
          durationMs: 1,
          model: 'm'
        }
      ])
    )
    const reloaded = new HistoryStore(file)
    expect(await reloaded.prune(30)).toBe(true)
    expect(reloaded.list()).toEqual([])
  })

  it('does not restore retention-pruned entries from a backup', async () => {
    writeFileSync(
      file,
      JSON.stringify([
        {
          id: 'old',
          text: 'expired',
          createdAt: new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString(),
          durationMs: 1,
          model: 'm'
        },
        {
          id: 'recent',
          text: 'keep',
          createdAt: new Date().toISOString(),
          durationMs: 1,
          model: 'm'
        }
      ])
    )
    const store = new HistoryStore(file)

    expect(await store.prune(30)).toBe(true)
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).map((entry: { text: string }) => entry.text)).toEqual([
      'keep'
    ])

    writeFileSync(file, 'not valid json')
    expect(new HistoryStore(file).list().map((entry) => entry.text)).toEqual(['keep'])
  })

  it('retries a failed retention write without losing later additions', async () => {
    const expiredAt = new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString()
    writeFileSync(
      file,
      JSON.stringify([
        { id: 'expired', text: 'expired', createdAt: expiredAt, durationMs: 1, model: 'm' },
        { id: 'current', text: 'keep', createdAt: new Date().toISOString(), durationMs: 1, model: 'm' }
      ])
    )
    writeFileSync(`${file}.tmp`, 'stale temporary copy')
    writeFileSync(`${file}.corrupt`, 'stale corrupt copy')
    let writeFails = true
    const store = new HistoryStore(file, {
      writeJsonAtomicAsync: async (path, value) => {
        if (writeFails) throw new Error('injected prune write failure')
        await writeJsonAtomicAsync(path, value)
      },
      removeJsonRecoveryCopiesAsync,
      refreshJsonRecoveryBackupAsync
    })

    await expect(store.prune(30)).rejects.toThrow('injected prune write failure')
    expect(store.list().map((entry) => entry.text)).toEqual(['keep'])

    writeFails = false
    store.add({ text: 'later addition', durationMs: 1, model: 'm' })
    await store.flush()

    await expect(store.prune(30)).resolves.toBe(true)
    expect(new HistoryStore(file).list().map((entry) => entry.text)).toEqual(['later addition', 'keep'])
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).map((entry: { text: string }) => entry.text)).toEqual([
      'later addition',
      'keep'
    ])
    expect(existsSync(`${file}.tmp`)).toBe(false)
    expect(existsSync(`${file}.corrupt`)).toBe(false)
  })

  it('repairs recovery copies after a prune cleanup failure and reload', async () => {
    const expiredAt = new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString()
    writeFileSync(
      file,
      JSON.stringify([
        { id: 'expired', text: 'expired', createdAt: expiredAt, durationMs: 1, model: 'm' },
        { id: 'current', text: 'keep', createdAt: new Date().toISOString(), durationMs: 1, model: 'm' }
      ])
    )
    writeFileSync(`${file}.tmp`, 'stale temporary copy')
    writeFileSync(`${file}.corrupt`, 'stale corrupt copy')
    const store = new HistoryStore(file, {
      writeJsonAtomicAsync,
      removeJsonRecoveryCopiesAsync: async () => {
        throw new Error('injected prune cleanup failure')
      },
      refreshJsonRecoveryBackupAsync
    })

    await expect(store.prune(30)).rejects.toThrow('injected prune cleanup failure')
    expect(JSON.parse(readFileSync(file, 'utf8')).map((entry: { text: string }) => entry.text)).toEqual(['keep'])
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).map((entry: { text: string }) => entry.text)).toEqual([
      'expired',
      'keep'
    ])

    const reloaded = new HistoryStore(file)
    expect(reloaded.list().map((entry) => entry.text)).toEqual(['keep'])
    await expect(reloaded.prune(30)).resolves.toBe(false)
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).map((entry: { text: string }) => entry.text)).toEqual([
      'keep'
    ])
    expect(existsSync(`${file}.tmp`)).toBe(false)
    expect(existsSync(`${file}.corrupt`)).toBe(false)
  })

  it('keeps the preserved damaged file when a startup retention pass finds nothing expired', async () => {
    // A truncated primary with one recent transcript and no usable backup: the
    // exact shape a crash mid-write leaves behind.
    const intact = JSON.stringify([
      {
        id: 'recent',
        text: 'synthetic transcript from the damaged file',
        createdAt: new Date().toISOString(),
        durationMs: 1200,
        model: 'gpt-transcribe'
      }
    ])
    const truncated = intact.slice(0, Math.floor(intact.length * 0.7))
    writeFileSync(file, truncated)
    expect(existsSync(`${file}.bak`)).toBe(false)

    const store = new HistoryStore(file)
    expect(store.list()).toEqual([])
    expect(existsSync(`${file}.corrupt`)).toBe(true)
    expect(readFileSync(`${file}.corrupt`, 'utf8')).toBe(truncated)

    // A startup retention pass has nothing expired in memory to remove, so it
    // must not scrub the only surviving copy of the damaged data.
    await expect(store.prune(30)).resolves.toBe(false)
    expect(existsSync(`${file}.corrupt`)).toBe(true)
    expect(readFileSync(`${file}.corrupt`, 'utf8')).toBe(truncated)

    const warning = store.takeWarning()
    expect(warning).toContain(`${file}.corrupt`)
    expect(warning).toMatch(/retention/iu)
  })

  it('keeps a later addition, then clears the damaged copy on the next restart', async () => {
    const intact = JSON.stringify([
      {
        id: 'recent',
        text: 'synthetic transcript from the damaged file',
        createdAt: new Date().toISOString(),
        durationMs: 1200,
        model: 'gpt-transcribe'
      }
    ])
    writeFileSync(file, intact.slice(0, Math.floor(intact.length * 0.7)))
    const store = new HistoryStore(file)
    await expect(store.prune(30)).resolves.toBe(false)
    expect(existsSync(`${file}.corrupt`)).toBe(true)

    // The warning must offer the copy as temporary, not as the user's to keep.
    const warning = store.takeWarning()
    expect(warning).toContain(`${file}.corrupt`)
    expect(warning).toContain('kept for now')
    expect(warning).toContain('deletes the whole file')
    expect(warning).toContain('next startup')
    expect(warning).toContain('Copy it somewhere else')
    expect(warning).not.toMatch(/delete that file yourself|only you can/iu)

    store.add({ text: 'dictated after recovery', durationMs: 1, model: 'm' })
    await store.flush()
    expect(existsSync(`${file}.corrupt`)).toBe(true)

    // Restart: the primary now parses, so the pass that completes an
    // interrupted cleanup runs and takes the damaged copy with it.
    const restarted = new HistoryStore(file)
    expect(restarted.list().map((entry) => entry.text)).toEqual(['dictated after recovery'])
    await expect(restarted.prune(30)).resolves.toBe(false)

    expect(existsSync(`${file}.corrupt`)).toBe(false)
    expect(JSON.parse(readFileSync(file, 'utf8')).map((entry: { text: string }) => entry.text)).toEqual([
      'dictated after recovery'
    ])
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).map((entry: { text: string }) => entry.text)).toEqual([
      'dictated after recovery'
    ])
  })

  it('still scrubs the preserved damaged file when retention does remove expired entries', async () => {
    // Recovery from a usable backup whose contents are partly expired: the
    // prune is a real deletion, so it must reach every recovery copy and the
    // warning must stop pointing at a file it just removed.
    writeFileSync(
      `${file}.bak`,
      JSON.stringify([
        {
          id: 'expired',
          text: 'expired',
          createdAt: new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString(),
          durationMs: 1,
          model: 'm'
        },
        { id: 'current', text: 'keep', createdAt: new Date().toISOString(), durationMs: 1, model: 'm' }
      ])
    )
    writeFileSync(file, 'truncated primary')
    const store = new HistoryStore(file)
    expect(store.list().map((entry) => entry.text)).toEqual(['expired', 'keep'])
    expect(existsSync(`${file}.corrupt`)).toBe(true)

    await expect(store.prune(30)).resolves.toBe(true)

    expect(existsSync(`${file}.corrupt`)).toBe(false)
    expect(JSON.parse(readFileSync(file, 'utf8')).map((entry: { text: string }) => entry.text)).toEqual(['keep'])
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).map((entry: { text: string }) => entry.text)).toEqual([
      'keep'
    ])
    expect(store.takeWarning()).not.toMatch(/retention/iu)
  })

  it('coalesces rapid writes and ends with the newest state', async () => {
    const store = new HistoryStore(file)
    for (let index = 0; index < 25; index += 1) {
      store.add({ text: `entry ${index}`, durationMs: 1, model: 'm' })
    }
    await new Promise((resolve) => setTimeout(resolve, 60))
    await store.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(25)
  })

  it('waits for an in-flight write when flushed immediately', async () => {
    const store = new HistoryStore(file)
    store.add({ text: 'just dictated', durationMs: 1, model: 'm' })
    // flush() must not return until the async write has landed, or quitting
    // here would lose the entry.
    await store.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1)
  })

  it('serialises a deletion behind an in-flight write and keeps a later addition', async () => {
    const firstWriteStarted = deferred<void>()
    const releaseFirstWrite = deferred<void>()
    const snapshots: string[][] = []
    let firstWrite = true
    const controlledWrite = vi.fn(async (path: string, value: unknown) => {
      const entries = Array.isArray(value) ? value : []
      snapshots.push(entries.map((entry) => (entry as { text: string }).text))
      if (firstWrite) {
        firstWrite = false
        firstWriteStarted.resolve()
        await releaseFirstWrite.promise
      }
      await writeJsonAtomicAsync(path, value)
    })
    const store = new HistoryStore(file, {
      writeJsonAtomicAsync: controlledWrite,
      removeJsonRecoveryCopiesAsync,
      refreshJsonRecoveryBackupAsync
    })

    const deleted = store.add({ text: 'delete me', durationMs: 1, model: 'm' })
    await firstWriteStarted.promise
    const deletion = store.delete(deleted.id)
    store.add({ text: 'later addition', durationMs: 1, model: 'm' })
    releaseFirstWrite.resolve()

    await deletion
    await store.flush()

    expect(snapshots).toEqual([['delete me'], [], ['later addition']])
    expect(new HistoryStore(file).list().map((entry) => entry.text)).toEqual(['later addition'])
  })

  it('rejects destructive write and cleanup failures, then permits retries', async () => {
    let writeFails = true
    const writeFailure = new HistoryStore(file, {
      writeJsonAtomicAsync: async (path, value) => {
        if (writeFails) throw new Error('injected write failure')
        await writeJsonAtomicAsync(path, value)
      },
      removeJsonRecoveryCopiesAsync,
      refreshJsonRecoveryBackupAsync
    })

    await expect(writeFailure.clear()).rejects.toThrow('injected write failure')
    writeFails = false
    await expect(writeFailure.clear()).resolves.toBeUndefined()

    let cleanupFails = true
    const cleanupFailure = new HistoryStore(file, {
      writeJsonAtomicAsync,
      removeJsonRecoveryCopiesAsync: async (path) => {
        if (cleanupFails) throw new Error('injected cleanup failure')
        await removeJsonRecoveryCopiesAsync(path)
      },
      refreshJsonRecoveryBackupAsync
    })
    cleanupFailure.add({ text: 'needs deletion', durationMs: 1, model: 'm' })
    await cleanupFailure.flush()

    await expect(cleanupFailure.clear()).rejects.toThrow('injected cleanup failure')
    cleanupFails = false
    await expect(cleanupFailure.clear()).resolves.toBeUndefined()
    expect(new HistoryStore(file).list()).toEqual([])
  })

  it('returns copies, so callers cannot mutate the store', () => {
    const store = new HistoryStore(file)
    store.add({ text: 'original', durationMs: 1, model: 'm' })
    const list = store.list()
    const first = list[0]
    if (first) first.text = 'tampered'
    expect(store.list()[0]?.text).toBe('original')
  })
})
