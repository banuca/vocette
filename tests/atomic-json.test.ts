import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  readJsonWithBackup,
  writeJsonAtomic,
  writeJsonAtomicAsync
} from '../src/main/atomic-json'

let file: string

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'vh-atomic-')), 'data.json')
})

describe('round trip', () => {
  it('returns null for a file that does not exist', () => {
    expect(readJsonWithBackup(file)).toEqual({ value: null })
  })

  it('writes and reads back', () => {
    writeJsonAtomic(file, { hello: 'world' })
    expect(readJsonWithBackup<{ hello: string }>(file).value).toEqual({ hello: 'world' })
  })

  it('leaves no temp file behind', () => {
    writeJsonAtomic(file, [1, 2, 3])
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('keeps the previous version as a backup on the second write', () => {
    writeJsonAtomic(file, { generation: 1 })
    expect(existsSync(`${file}.bak`)).toBe(false)
    writeJsonAtomic(file, { generation: 2 })
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8'))).toEqual({ generation: 1 })
    expect(readJsonWithBackup<{ generation: number }>(file).value).toEqual({ generation: 2 })
  })

  it('works the same asynchronously', async () => {
    await writeJsonAtomicAsync(file, { mode: 'async' })
    expect(readJsonWithBackup<{ mode: string }>(file).value).toEqual({ mode: 'async' })
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })
})

describe('corruption', () => {
  it('recovers from the backup when the primary is truncated', () => {
    writeJsonAtomic(file, { entries: ['keep me'] })
    writeJsonAtomic(file, { entries: ['keep me', 'and me'] })

    // Simulate a crash part-way through a write.
    writeFileSync(file, '{"entries":["keep me","and m')

    const result = readJsonWithBackup<{ entries: string[] }>(file)
    expect(result.value).toEqual({ entries: ['keep me'] })
    expect(result.problem).toContain('recovered')
  })

  it('preserves a damaged file instead of overwriting it', () => {
    writeFileSync(file, 'totally not json')
    const result = readJsonWithBackup(file)
    expect(result.value).toBeNull()
    expect(result.problem).toContain('damaged file was kept')
    expect(readFileSync(`${file}.corrupt`, 'utf8')).toBe('totally not json')
  })

  it('treats an empty file as missing data, not as valid JSON', () => {
    writeFileSync(file, '')
    expect(readJsonWithBackup(file).value).toBeNull()
  })

  it('reads the backup when the primary is gone entirely', () => {
    writeJsonAtomic(file, { generation: 1 })
    writeJsonAtomic(file, { generation: 2 })
    writeFileSync(file, '')

    expect(readJsonWithBackup<{ generation: number }>(file).value).toEqual({ generation: 1 })
  })
})
