import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { HistoryStore } from '../src/main/history-store'

let file: string

/** Writes are async (open → write → fsync → backup → rename); give them a tick. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60))

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

  it('deletes by id', () => {
    const store = new HistoryStore(file)
    const entry = store.add({ text: 'delete me', durationMs: 1, model: 'm' })
    store.add({ text: 'keep me', durationMs: 1, model: 'm' })
    expect(store.delete(entry.id).map((item) => item.text)).toEqual(['keep me'])
  })

  it('clears everything', () => {
    const store = new HistoryStore(file)
    store.add({ text: 'a', durationMs: 1, model: 'm' })
    store.clear()
    expect(store.list()).toEqual([])
  })

  it('prunes only past the retention window and reports whether it changed anything', () => {
    const store = new HistoryStore(file)
    store.add({ text: 'recent', durationMs: 1, model: 'm' })
    expect(store.prune(0)).toBe(false)
    expect(store.prune(30)).toBe(false)

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
    expect(reloaded.prune(30)).toBe(true)
    expect(reloaded.list()).toEqual([])
  })

  it('coalesces rapid writes and ends with the newest state', async () => {
    const store = new HistoryStore(file)
    for (let index = 0; index < 25; index += 1) {
      store.add({ text: `entry ${index}`, durationMs: 1, model: 'm' })
    }
    await new Promise((resolve) => setTimeout(resolve, 60))
    store.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(25)
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
