import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ALREADY_DOWNLOADING,
  DISK_FULL,
  DOWNLOAD_DAMAGED,
  DOWNLOAD_UNREACHABLE,
  MARKER_FILE,
  ModelStore,
  ModelStoreError,
  httpFailure,
  modelsRoot,
  type DownloadProgress,
  type ModelFetch,
  type ModelStoreOptions
} from '../src/main/engine/model-store'
import { PARAKEET_V3, type ModelManifest } from '../src/main/engine/models'

/**
 * The model is 640 MB, so the store is tested against a small stand-in
 * manifest, a temporary folder and a fake server — every path the real
 * download can take, none of the waiting.
 */

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

function bytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) out[index] = (index * 31 + seed * 17) % 251
  return out
}

const ALPHA = bytes(3000, 1)
const BETA = bytes(500, 2)
const ALPHA_URL = 'https://models.test/alpha.onnx'
const BETA_URL = 'https://models.test/beta.txt'

const MANIFEST: ModelManifest = {
  ...PARAKEET_V3,
  files: [
    { name: 'alpha.onnx', url: ALPHA_URL, bytes: ALPHA.length, sha256: sha256(ALPHA) },
    { name: 'beta.txt', url: BETA_URL, bytes: BETA.length, sha256: sha256(BETA) }
  ],
  totalBytes: ALPHA.length + BETA.length
}
const ID = MANIFEST.id

interface Served {
  body: Uint8Array
  /** Answer 200 with the whole file whatever range was asked for. */
  ignoreRange?: boolean
  /** Answer with this status and no body. */
  status?: number
  /** Claim this first byte in Content-Range, whatever was sent. */
  claimStart?: number
}

interface ServerOptions {
  chunkSize?: number
  /** Called before each chunk of each response; may hold it back. */
  beforeChunk?: (url: string, index: number) => Promise<void> | void
}

/** A stand-in for the model host, honouring `Range` and the abort signal like a real fetch. */
function fakeServer(files: Record<string, Served>, options: ServerOptions = {}) {
  const requests: Array<{ url: string; range: string | null }> = []
  const chunkSize = options.chunkSize ?? 700

  const fetch: ModelFetch = async (url, init) => {
    requests.push({ url, range: init.headers.Range ?? null })
    const served = files[url]
    if (!served) return new Response(null, { status: 404 })
    if (served.status) return new Response(null, { status: served.status })

    const asked = /^bytes=(\d+)-$/u.exec(init.headers.Range ?? '')
    const start = asked && !served.ignoreRange ? Number(asked[1]) : 0
    const body = served.body.subarray(start)
    let offset = 0
    let index = 0
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        init.signal.addEventListener('abort', () => controller.error(init.signal.reason), {
          once: true
        })
      },
      async pull(controller) {
        await options.beforeChunk?.(url, index)
        if (offset >= body.length) {
          controller.close()
          return
        }
        const end = Math.min(body.length, offset + chunkSize)
        controller.enqueue(body.slice(offset, end))
        offset = end
        index += 1
      }
    })
    const partial = start > 0
    const claimed = served.claimStart ?? start
    return new Response(stream, {
      status: partial ? 206 : 200,
      headers: partial
        ? { 'content-range': `bytes ${claimed}-${served.body.length - 1}/${served.body.length}` }
        : {}
    })
  }
  return { fetch, requests }
}

const bothFiles = (): Record<string, Served> => ({
  [ALPHA_URL]: { body: ALPHA },
  [BETA_URL]: { body: BETA }
})

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'murmur-models-'))
})

function store(fetch: ModelFetch, extra: Partial<ModelStoreOptions> = {}): ModelStore {
  return new ModelStore({ root, fetch, manifests: [MANIFEST], ...extra })
}

const folder = (): string => join(root, ID)
const file = (name: string): string => join(folder(), name)

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    return error as Error
  }
  throw new Error('Expected the promise to reject.')
}

describe('ModelStore.download', () => {
  it('downloads every file, verifies it, and writes the marker', async () => {
    const server = fakeServer(bothFiles())
    const models = store(server.fetch)
    expect(models.state(ID)).toBe('missing')

    const progress: DownloadProgress[] = []
    await models.download(ID, (update) => progress.push(update))

    expect(readFileSync(file('alpha.onnx'))).toEqual(Buffer.from(ALPHA))
    expect(readFileSync(file('beta.txt'))).toEqual(Buffer.from(BETA))
    expect(existsSync(file('alpha.onnx.part'))).toBe(false)
    expect(models.state(ID)).toBe('installed')
    expect(server.requests).toEqual([
      { url: ALPHA_URL, range: null },
      { url: BETA_URL, range: null }
    ])

    const marker = JSON.parse(readFileSync(file(MARKER_FILE), 'utf8'))
    expect(marker).toEqual({
      id: ID,
      verifiedAt: expect.any(String),
      files: MANIFEST.files.map(({ name, bytes: size, sha256: hash }) => ({
        name,
        bytes: size,
        sha256: hash
      }))
    })

    expect(progress.length).toBeGreaterThan(0)
    for (const update of progress) {
      expect(update.totalBytes).toBe(MANIFEST.totalBytes)
      expect(update.receivedBytes).toBeLessThanOrEqual(MANIFEST.totalBytes)
    }
  })

  it('does nothing at all when the model is already installed', async () => {
    const first = fakeServer(bothFiles())
    await store(first.fetch).download(ID)
    const second = fakeServer(bothFiles())
    await store(second.fetch).download(ID)
    expect(second.requests).toEqual([])
  })

  it('resumes a part file with a Range request and carries on the same hash', async () => {
    mkdirSync(folder(), { recursive: true })
    writeFileSync(file('alpha.onnx.part'), ALPHA.subarray(0, 1000))
    const server = fakeServer(bothFiles())

    await store(server.fetch).download(ID)

    expect(server.requests[0]).toEqual({ url: ALPHA_URL, range: 'bytes=1000-' })
    expect(readFileSync(file('alpha.onnx'))).toEqual(Buffer.from(ALPHA))
    expect(store(server.fetch).state(ID)).toBe('installed')
  })

  it('starts a file again when the server ignores the range', async () => {
    mkdirSync(folder(), { recursive: true })
    writeFileSync(file('alpha.onnx.part'), ALPHA.subarray(0, 1000))
    const server = fakeServer({ ...bothFiles(), [ALPHA_URL]: { body: ALPHA, ignoreRange: true } })

    await store(server.fetch).download(ID)

    // The whole file once — not the first 1000 bytes twice over.
    expect(statSync(file('alpha.onnx')).size).toBe(ALPHA.length)
    expect(readFileSync(file('alpha.onnx'))).toEqual(Buffer.from(ALPHA))
  })

  it('refuses a damaged file, deletes it, and never installs it', async () => {
    const damaged = ALPHA.slice()
    damaged[1500] = (damaged[1500] ?? 0) ^ 0xff
    const server = fakeServer({ ...bothFiles(), [ALPHA_URL]: { body: damaged } })
    const models = store(server.fetch)

    const error = await rejection(models.download(ID))
    expect(error).toBeInstanceOf(ModelStoreError)
    expect(error.message).toBe('The download was damaged. Try again.')
    expect(existsSync(file('alpha.onnx.part'))).toBe(false)
    expect(existsSync(file('alpha.onnx'))).toBe(false)
    expect(existsSync(file(MARKER_FILE))).toBe(false)
    expect(models.state(ID)).not.toBe('installed')
  })

  it('refuses a body longer than the file can be', async () => {
    const longer = new Uint8Array(ALPHA.length + 10)
    longer.set(ALPHA)
    const server = fakeServer({ ...bothFiles(), [ALPHA_URL]: { body: longer } })
    expect((await rejection(store(server.fetch).download(ID))).message).toBe(DOWNLOAD_DAMAGED)
    expect(existsSync(file('alpha.onnx.part'))).toBe(false)
  })

  it('refuses a partial answer that starts somewhere else', async () => {
    mkdirSync(folder(), { recursive: true })
    writeFileSync(file('alpha.onnx.part'), ALPHA.subarray(0, 1000))
    const server = fakeServer({ ...bothFiles(), [ALPHA_URL]: { body: ALPHA, claimStart: 0 } })
    expect((await rejection(store(server.fetch).download(ID))).message).toBe(DOWNLOAD_DAMAGED)
    // Bytes that cannot be trusted are not resumed from.
    expect(existsSync(file('alpha.onnx.part'))).toBe(false)
  })

  it('drops a part the server cannot resume (416), so the next try starts clean', async () => {
    mkdirSync(folder(), { recursive: true })
    writeFileSync(file('alpha.onnx.part'), ALPHA.subarray(0, 1000))
    const server = fakeServer({ ...bothFiles(), [ALPHA_URL]: { body: ALPHA, status: 416 } })
    expect((await rejection(store(server.fetch).download(ID))).message).toBe(DOWNLOAD_DAMAGED)
    expect(existsSync(file('alpha.onnx.part'))).toBe(false)
  })

  it('keeps the part file when cancelled, and resumes from it next time', async () => {
    let releaseFirst: (() => void) | null = null
    const firstChunkSent = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const server = fakeServer(bothFiles(), {
      chunkSize: 1000,
      beforeChunk: (url, index) => {
        if (url !== ALPHA_URL || index < 1) return
        releaseFirst?.()
        // Hold the second chunk until the download is cancelled.
        return new Promise<void>(() => undefined)
      }
    })
    const controller = new AbortController()
    const download = store(server.fetch).download(ID, undefined, controller.signal)
    await firstChunkSent
    await new Promise((resolve) => setTimeout(resolve, 20))
    controller.abort()

    const error = await rejection(download)
    expect(error.name).toBe('AbortError')
    expect(error).not.toBeInstanceOf(ModelStoreError)
    const kept = statSync(file('alpha.onnx.part')).size
    expect(kept).toBe(1000)
    expect(store(server.fetch).state(ID)).toBe('partial')

    const again = fakeServer(bothFiles())
    await store(again.fetch).download(ID)
    expect(again.requests[0]).toEqual({ url: ALPHA_URL, range: `bytes=${kept}-` })
    expect(readFileSync(file('alpha.onnx'))).toEqual(Buffer.from(ALPHA))
  })

  it('stops before fetching anything when already cancelled', async () => {
    const server = fakeServer(bothFiles())
    const controller = new AbortController()
    controller.abort()
    const error = await rejection(store(server.fetch).download(ID, undefined, controller.signal))
    expect(error.name).toBe('AbortError')
    expect(server.requests).toEqual([])
  })

  it('says the disk is full when it is', async () => {
    const server = fakeServer(bothFiles())
    const models = store(server.fetch, {
      fs: {
        openAppend: async () => ({
          write: async () => {
            throw Object.assign(new Error('ENOSPC: no space left on device, write'), {
              code: 'ENOSPC'
            })
          },
          sync: async () => undefined,
          close: async () => undefined
        })
      }
    })
    const error = await rejection(models.download(ID))
    expect(error).toBeInstanceOf(ModelStoreError)
    expect(error.message).toBe('Not enough free disk space — about 700 MB is needed.')
    expect(error.message).toBe(DISK_FULL)
  })

  it('says it could not reach the server when the network fails', async () => {
    const offline: ModelFetch = async () => {
      throw new TypeError('fetch failed')
    }
    const error = await rejection(store(offline).download(ID))
    expect(error.message).toBe(
      'Could not reach the download server. Check your internet connection.'
    )
    expect(error.message).toBe(DOWNLOAD_UNREACHABLE)
  })

  it('names the HTTP status when the server refuses', async () => {
    const server = fakeServer({ [BETA_URL]: { body: BETA } }) // alpha → 404
    const error = await rejection(store(server.fetch).download(ID))
    expect(error.message).toBe('The download server answered with an error (HTTP 404).')
    expect(error.message).toBe(httpFailure(404))
  })

  it('verifies files already in place instead of fetching them again', async () => {
    // A copy put there by hand, with no marker to vouch for it.
    mkdirSync(folder(), { recursive: true })
    writeFileSync(file('alpha.onnx'), ALPHA)
    writeFileSync(file('beta.txt'), BETA)
    const server = fakeServer(bothFiles())
    const models = store(server.fetch)
    expect(models.state(ID)).toBe('partial')

    const phases = new Set<string>()
    await models.download(ID, (update) => phases.add(update.phase))

    expect(server.requests).toEqual([])
    expect(phases).toEqual(new Set(['verifying']))
    expect(models.state(ID)).toBe('installed')
  })

  it('fetches again a file in place that does not match', async () => {
    mkdirSync(folder(), { recursive: true })
    writeFileSync(file('alpha.onnx'), bytes(ALPHA.length, 9))
    writeFileSync(file('beta.txt'), BETA)
    const server = fakeServer(bothFiles())
    await store(server.fetch).download(ID)
    expect(server.requests).toEqual([{ url: ALPHA_URL, range: null }])
    expect(readFileSync(file('alpha.onnx'))).toEqual(Buffer.from(ALPHA))
  })

  it('reports progress at most every 200 ms, and always on a change of phase', async () => {
    let clock = 0
    const server = fakeServer(bothFiles(), { chunkSize: 50 })
    const progress: DownloadProgress[] = []
    // Every reading of the clock is 50 ms later than the last.
    await store(server.fetch, { now: () => (clock += 50) }).download(ID, (update) =>
      progress.push(update)
    )
    const chunks = Math.ceil(ALPHA.length / 50) + Math.ceil(BETA.length / 50)
    expect(progress.length).toBeGreaterThan(1)
    expect(progress.length).toBeLessThanOrEqual(Math.ceil(chunks / 4) + 1)
    const received = progress.map((update) => update.receivedBytes)
    expect([...received].sort((a, b) => a - b)).toEqual(received)
  })

  it('will not run two downloads of the same model at once', async () => {
    const server = fakeServer(bothFiles(), {
      beforeChunk: () => new Promise<void>(() => undefined)
    })
    const models = store(server.fetch)
    const controller = new AbortController()
    const first = models.download(ID, undefined, controller.signal)
    const second = await rejection(models.download(ID))
    expect(second.message).toBe(ALREADY_DOWNLOADING)
    controller.abort()
    await rejection(first)
  })
})

describe('ModelStore.state', () => {
  async function installed(): Promise<ModelStore> {
    const models = store(fakeServer(bothFiles()).fetch)
    await models.download(ID)
    expect(models.state(ID)).toBe('installed')
    return models
  }

  it('trusts the marker, never re-hashing at start-up', async () => {
    const models = await installed()
    // Same size, different bytes: only a hash would notice, and state() does
    // not hash — that is the marker's job, done once at download.
    writeFileSync(file('alpha.onnx'), bytes(ALPHA.length, 5))
    expect(models.state(ID)).toBe('installed')
  })

  it('stops calling it installed when a file is missing or the wrong size', async () => {
    const models = await installed()
    writeFileSync(file('beta.txt'), BETA.subarray(0, 100))
    expect(models.state(ID)).toBe('partial')
  })

  it('stops calling it installed when the marker lists other hashes', async () => {
    const models = await installed()
    const marker = JSON.parse(readFileSync(file(MARKER_FILE), 'utf8'))
    marker.files[0].sha256 = '0'.repeat(64)
    writeFileSync(file(MARKER_FILE), JSON.stringify(marker))
    expect(models.state(ID)).toBe('partial')
  })

  it('stops calling it installed when the marker is gone or unreadable', async () => {
    const models = await installed()
    writeFileSync(file(MARKER_FILE), 'not json')
    expect(models.state(ID)).toBe('partial')
  })

  it('calls a folder with only part files partial, and an empty one missing', () => {
    const models = store(fakeServer(bothFiles()).fetch)
    expect(models.state(ID)).toBe('missing')
    mkdirSync(folder(), { recursive: true })
    expect(models.state(ID)).toBe('missing')
    writeFileSync(file('beta.txt.part'), BETA.subarray(0, 10))
    expect(models.state(ID)).toBe('partial')
  })

  it('refuses a model it does not know', () => {
    expect(() => store(fakeServer({}).fetch).state('whisper-large')).toThrow(ModelStoreError)
  })
})

describe('ModelStore.remove', () => {
  it('deletes the model folder, parts and marker included', async () => {
    const models = store(fakeServer(bothFiles()).fetch)
    await models.download(ID)
    writeFileSync(file('stray.part'), 'x')
    await models.remove(ID)
    expect(existsSync(folder())).toBe(false)
    expect(models.state(ID)).toBe('missing')
  })

  it('is content when there is nothing to remove', async () => {
    await expect(store(fakeServer({}).fetch).remove(ID)).resolves.toBeUndefined()
  })

  it('gives the model folder to the engine', () => {
    expect(store(fakeServer({}).fetch).path(ID)).toBe(join(root, 'parakeet-tdt-0.6b-v3-int8'))
  })
})

describe('modelsRoot', () => {
  it('uses MURMUR_MODELS_DIR when it is set', () => {
    expect(
      modelsRoot({
        env: { MURMUR_MODELS_DIR: 'D:\\scratch\\models', LOCALAPPDATA: 'C:\\Local' },
        platform: 'win32',
        userData: 'C:\\Roaming\\Murmur'
      })
    ).toBe('D:\\scratch\\models')
  })

  it('keeps the model out of the roaming profile on Windows', () => {
    expect(
      modelsRoot({
        env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
        platform: 'win32',
        userData: 'C:\\Users\\me\\AppData\\Roaming\\Murmur'
      })
    ).toBe(join('C:\\Users\\me\\AppData\\Local', 'Murmur', 'models'))
  })

  it('falls back to the profile folder elsewhere', () => {
    expect(modelsRoot({ env: {}, platform: 'linux', userData: '/home/me/.config/Murmur' })).toBe(
      join('/home/me/.config/Murmur', 'models')
    )
    expect(modelsRoot({ env: {}, platform: 'win32', userData: 'C:\\Roaming\\Murmur' })).toBe(
      join('C:\\Roaming\\Murmur', 'models')
    )
  })
})
