import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  refreshJsonRecoveryBackupAsync,
  removeJsonRecoveryCopiesAsync,
  writeJsonAtomicAsync
} from '../src/main/atomic-json'
import { HistoryStore, isRestorableEntry } from '../src/main/history-store'
import {
  EMPTY_EDIT_REFUSAL,
  MAX_HISTORY_TEXT_CHARS,
  originalTextOf,
  type HistoryEntry
} from '../src/shared/types'

let file: string

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

    // The store's own flush, not a fixed wait: under a loaded disk an atomic
    // write can take longer than any fixed pause, and the test read stale data.
    await store.flush()
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

/** An entry as a build from before edits and heard text existed saved it. */
function savedEntry(id: string, createdAt: string): HistoryEntry {
  return { id, text: id, createdAt, durationMs: 1000, model: 'gpt-transcribe' }
}

/** The texts in the file on disk, newest first. */
function textsOnDisk(path = file): string[] {
  return (JSON.parse(readFileSync(path, 'utf8')) as HistoryEntry[]).map((entry) => entry.text)
}

describe('HistoryStore: what was heard, edits and undo', () => {
  it('loads entries saved before the optional fields existed, beside ones that have them', () => {
    const current: HistoryEntry = {
      id: 'current',
      text: 'Meet on Wednesday.',
      createdAt: '2026-09-28T10:00:00.000Z',
      durationMs: 900,
      model: 'm',
      heardText: 'um meet on tuesday',
      editedAt: '2026-09-28T10:05:00.000Z',
      uneditedText: 'Meet on Tuesday.'
    }
    const old = savedEntry('saved by an older build', '2026-09-01T10:00:00.000Z')
    writeFileSync(file, JSON.stringify([current, old]))

    // The load filter is all or nothing: had it demanded any new field, the
    // old entry would be gone here, silently.
    expect(new HistoryStore(file).list()).toEqual([current, old])
  })

  it('keeps how long the text took, on disk and across a reload', async () => {
    const store = new HistoryStore(file)
    store.add({ text: 'Quick one.', durationMs: 1200, model: 'm', waitMs: 412 })
    await store.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))[0]).toMatchObject({ waitMs: 412 })
    expect(new HistoryStore(file).list()[0]).toMatchObject({ text: 'Quick one.', waitMs: 412 })
  })

  it('keeps what was heard when a dictation arrives with it', async () => {
    const store = new HistoryStore(file)
    store.add({ text: 'Send it to ITU.', durationMs: 1, model: 'm', heardText: 'send it to itu' })
    await store.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))[0]).toMatchObject({
      text: 'Send it to ITU.',
      heardText: 'send it to itu'
    })
  })

  it('saves an edit to disk, marked as edited, with the date, duration, model and heard text untouched', async () => {
    const store = new HistoryStore(file)
    const entry = store.add({
      text: 'Meet on Tuesday.',
      durationMs: 1500,
      model: 'gpt-transcribe',
      heardText: 'um meet on tuesday'
    })
    await store.flush()

    const [edited] = await store.update(entry.id, 'Meet on Wednesday.')
    expect(edited).toMatchObject({
      id: entry.id,
      text: 'Meet on Wednesday.',
      createdAt: entry.createdAt,
      durationMs: 1500,
      model: 'gpt-transcribe',
      heardText: 'um meet on tuesday',
      uneditedText: 'Meet on Tuesday.'
    })
    expect(Number.isNaN(Date.parse(edited?.editedAt ?? ''))).toBe(false)
    // Written by the time the call resolves, not merely queued.
    expect(JSON.parse(readFileSync(file, 'utf8'))[0]).toEqual(edited)
  })

  it('refreshes the recovery copies after an edit, as a delete does', async () => {
    const store = new HistoryStore(file)
    const entry = store.add({ text: 'before the edit', durationMs: 1, model: 'm' })
    store.add({ text: 'another', durationMs: 1, model: 'm' })
    await store.flush()
    writeFileSync(`${file}.tmp`, 'stale temporary copy')
    writeFileSync(`${file}.corrupt`, 'stale corrupt copy')

    await store.update(entry.id, 'after the edit')
    // Otherwise the backup would still hold the version the edit replaced.
    expect(textsOnDisk(`${file}.bak`)).toEqual(['another', 'after the edit'])
    expect(existsSync(`${file}.tmp`)).toBe(false)
    expect(existsSync(`${file}.corrupt`)).toBe(false)
  })

  it('keeps the text from before the first edit across a second one', async () => {
    const store = new HistoryStore(file)
    const entry = store.add({ text: 'first draft', durationMs: 1, model: 'm' })

    const [once] = await store.update(entry.id, 'second draft')
    const [twice] = await store.update(entry.id, 'third draft')
    expect(once).toMatchObject({ text: 'second draft', uneditedText: 'first draft' })
    expect(twice).toMatchObject({ text: 'third draft', uneditedText: 'first draft' })
    expect(Date.parse(twice?.editedAt ?? '')).toBeGreaterThanOrEqual(Date.parse(once?.editedAt ?? ''))
  })

  it('refuses to edit an entry it does not have, and writes nothing', async () => {
    const store = new HistoryStore(file)
    store.add({ text: 'keep me', durationMs: 1, model: 'm' })
    await store.flush()
    const before = readFileSync(file, 'utf8')

    await expect(store.update('no-such-id', 'anything')).rejects.toThrow(
      'That dictation is no longer in your history.'
    )
    expect(store.list().map((entry) => entry.text)).toEqual(['keep me'])
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('refuses an edit that leaves nothing, or only whitespace', async () => {
    const store = new HistoryStore(file)
    const entry = store.add({ text: 'keep me', durationMs: 1, model: 'm' })

    await expect(store.update(entry.id, '')).rejects.toThrow(EMPTY_EDIT_REFUSAL)
    await expect(store.update(entry.id, ' \n\t ')).rejects.toThrow(EMPTY_EDIT_REFUSAL)
    expect(store.list()[0]).toMatchObject({ text: 'keep me' })
    expect(store.list()[0]).not.toHaveProperty('editedAt')
  })

  it('marks nothing as edited when the text is saved unchanged', async () => {
    const store = new HistoryStore(file)
    const entry = store.add({ text: 'as it was', durationMs: 1, model: 'm' })

    const [unchanged] = await store.update(entry.id, 'as it was')
    expect(unchanged).not.toHaveProperty('editedAt')
    expect(unchanged).not.toHaveProperty('uneditedText')
  })

  it('clamps an edit to the longest text History keeps', async () => {
    const store = new HistoryStore(file)
    const entry = store.add({ text: 'short', durationMs: 1, model: 'm' })

    const [edited] = await store.update(entry.id, 'x'.repeat(MAX_HISTORY_TEXT_CHARS + 10))
    expect(edited?.text).toHaveLength(MAX_HISTORY_TEXT_CHARS)
  })

  it('puts a deleted entry back where it was among the rest by date', async () => {
    writeFileSync(
      file,
      JSON.stringify([
        savedEntry('newest', '2026-09-28T12:00:00.000Z'),
        savedEntry('middle', '2026-09-27T12:00:00.000Z'),
        savedEntry('oldest', '2026-09-26T12:00:00.000Z')
      ])
    )
    const store = new HistoryStore(file)
    const [newest, middle, oldest] = store.list() as [HistoryEntry, HistoryEntry, HistoryEntry]

    await store.delete('middle')
    expect((await store.restore(middle)).map((entry) => entry.id)).toEqual([
      'newest',
      'middle',
      'oldest'
    ])

    // And at either end of the list.
    await store.delete('newest')
    await store.delete('oldest')
    await store.restore(oldest)
    expect((await store.restore(newest)).map((entry) => entry.id)).toEqual([
      'newest',
      'middle',
      'oldest'
    ])
    expect(textsOnDisk()).toEqual(['newest', 'middle', 'oldest'])
  })

  it('refuses to put back an entry that is still there', async () => {
    const store = new HistoryStore(file)
    const entry = store.add({ text: 'still here', durationMs: 1, model: 'm' })

    await expect(store.restore(entry)).rejects.toThrow('That dictation is already in your history.')
    expect(store.list()).toHaveLength(1)
  })

  it('puts back only the fields History knows, each text clamped like an edit', async () => {
    const store = new HistoryStore(file)
    const handedBack = {
      ...savedEntry('restored', '2026-09-28T12:00:00.000Z'),
      text: 't'.repeat(MAX_HISTORY_TEXT_CHARS + 1),
      heardText: 'h'.repeat(MAX_HISTORY_TEXT_CHARS + 1),
      editedAt: '2026-09-28T12:30:00.000Z',
      uneditedText: 'before the edit',
      waitMs: 380,
      somethingElse: 'not a history field'
    }

    const [restored] = await store.restore(handedBack)
    expect(restored).not.toHaveProperty('somethingElse')
    expect(restored?.text).toHaveLength(MAX_HISTORY_TEXT_CHARS)
    expect(restored?.heardText).toHaveLength(MAX_HISTORY_TEXT_CHARS)
    expect(restored).toMatchObject({
      editedAt: '2026-09-28T12:30:00.000Z',
      uneditedText: 'before the edit',
      waitMs: 380
    })
  })

  it('writes an undo like a new dictation, leaving the recovery copies alone', async () => {
    const removeCopies = vi.fn(removeJsonRecoveryCopiesAsync)
    const store = new HistoryStore(file, {
      writeJsonAtomicAsync,
      removeJsonRecoveryCopiesAsync: removeCopies,
      refreshJsonRecoveryBackupAsync
    })
    const entry = store.add({ text: 'deleted, then undone', durationMs: 1, model: 'm' })
    await store.delete(entry.id)
    expect(removeCopies).toHaveBeenCalledTimes(1)

    await store.restore(entry)
    expect(removeCopies).toHaveBeenCalledTimes(1)
    expect(textsOnDisk()).toEqual(['deleted, then undone'])
  })

  it('queues edits and undos behind an in-flight write, losing nothing added meanwhile', async () => {
    // Dated long ago, so the dictations added below are newer on any clock.
    writeFileSync(
      file,
      JSON.stringify([
        savedEntry('b', '2000-01-02T00:00:00.000Z'),
        savedEntry('a', '2000-01-01T00:00:00.000Z')
      ])
    )
    const firstWriteStarted = deferred<void>()
    const releaseFirstWrite = deferred<void>()
    const snapshots: string[][] = []
    let firstWrite = true
    const store = new HistoryStore(file, {
      writeJsonAtomicAsync: async (path, value) => {
        const entries = Array.isArray(value) ? (value as HistoryEntry[]) : []
        snapshots.push(entries.map((entry) => entry.text))
        if (firstWrite) {
          firstWrite = false
          firstWriteStarted.resolve()
          await releaseFirstWrite.promise
        }
        await writeJsonAtomicAsync(path, value)
      },
      removeJsonRecoveryCopiesAsync,
      refreshJsonRecoveryBackupAsync
    })
    const b = store.list().find((entry) => entry.id === 'b') as HistoryEntry

    store.add({ text: 'c', durationMs: 1, model: 'm' })
    await firstWriteStarted.promise
    const edit = store.update('a', 'a, edited')
    const removal = store.delete('b')
    const undo = store.restore(b)
    store.add({ text: 'd', durationMs: 1, model: 'm' })
    releaseFirstWrite.resolve()

    await Promise.all([edit, removal, undo])
    await store.flush()

    // One snapshot per change, in the order the changes were made.
    expect(snapshots).toEqual([
      ['c', 'b', 'a'],
      ['c', 'b', 'a, edited'],
      ['c', 'a, edited'],
      ['c', 'b', 'a, edited'],
      ['d', 'c', 'b', 'a, edited']
    ])
    expect(new HistoryStore(file).list().map((entry) => entry.text)).toEqual([
      'd',
      'c',
      'b',
      'a, edited'
    ])
  })
})

describe('isRestorableEntry', () => {
  const entry = savedEntry('a', '2026-09-28T10:00:00.000Z')

  it('accepts an entry with or without the optional fields', () => {
    expect(isRestorableEntry(entry)).toBe(true)
    expect(
      isRestorableEntry({ ...entry, heardText: 'h', editedAt: '2026-09-28T11:00:00.000Z', uneditedText: 'u' })
    ).toBe(true)
    expect(isRestorableEntry({ ...entry, waitMs: 0 })).toBe(true)
    expect(isRestorableEntry({ ...entry, waitMs: 640 })).toBe(true)
  })

  it('refuses anything short of an entry, or with an optional field of the wrong type', () => {
    const { text: _text, ...withoutText } = entry
    for (const value of [
      null,
      'an entry',
      withoutText,
      { ...entry, durationMs: '1000' },
      { ...entry, heardText: 42 },
      { ...entry, editedAt: {} },
      { ...entry, uneditedText: null },
      { ...entry, waitMs: '640' },
      { ...entry, waitMs: -1 },
      { ...entry, waitMs: Number.NaN },
      { ...entry, waitMs: Number.POSITIVE_INFINITY }
    ]) {
      expect(isRestorableEntry(value)).toBe(false)
    }
  })
})

describe('originalTextOf', () => {
  it('offers what was heard first, then the text from before the first edit', () => {
    expect(
      originalTextOf({ text: 'Delivered.', heardText: 'delivered', uneditedText: 'Before.' })
    ).toBe('delivered')
    expect(originalTextOf({ text: 'Edited.', uneditedText: 'Delivered.' })).toBe('Delivered.')
  })

  it('offers nothing when there is nothing different to show', () => {
    expect(originalTextOf({ text: 'Same.' })).toBeNull()
    expect(originalTextOf({ text: 'Same.', uneditedText: 'Same.' })).toBeNull()
    // Edited back to exactly what was heard.
    expect(
      originalTextOf({ text: 'as heard', heardText: 'as heard', uneditedText: 'Delivered.' })
    ).toBeNull()
  })
})
