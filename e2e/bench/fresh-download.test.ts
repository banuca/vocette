// Downloads the real on-device model from its real URL with the app's own ModelStore, into
// the bench's models folder (never the owner's): stops part-way, resumes, verifies.
//   npx vitest run --config e2e/bench/vitest.config.ts
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ModelStore } from '../../src/main/engine/model-store'
import { LOCAL_MODEL, RETIRED_MODEL_IDS } from '../../src/main/engine/models'

const root = join(process.env.LOCALAPPDATA ?? '', 'vocette-bench', 'app-models')

it('downloads, resumes and verifies the published model', async () => {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, RETIRED_MODEL_IDS[0]), { recursive: true })
  writeFileSync(join(root, RETIRED_MODEL_IDS[0], 'encoder.int8.onnx'), 'old')
  const store = new ModelStore({ root, fetch: (url, init) => fetch(url, init) })

  await store.removeRetired(RETIRED_MODEL_IDS)
  expect(existsSync(join(root, RETIRED_MODEL_IDS[0]))).toBe(false)

  const first = new AbortController()
  await expect(
    store.download(LOCAL_MODEL.id, (p) => {
      if (p.receivedBytes > 150_000_000) first.abort(new Error('stopped on purpose'))
    }, first.signal)
  ).rejects.toThrow()
  expect(store.state(LOCAL_MODEL.id)).toBe('partial')

  let resumedFrom = -1
  await store.download(LOCAL_MODEL.id, (p) => {
    if (resumedFrom < 0 && p.phase === 'downloading') resumedFrom = p.receivedBytes
  })
  expect(resumedFrom).toBeGreaterThan(100_000_000)
  expect(store.state(LOCAL_MODEL.id)).toBe('installed')
  const size = LOCAL_MODEL.files.reduce((sum, f) => sum + statSync(join(store.path(LOCAL_MODEL.id), f.name)).size, 0)
  expect(size).toBe(LOCAL_MODEL.totalBytes)
}, 900_000)
