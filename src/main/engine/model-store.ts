import { createHash, type Hash } from 'node:crypto'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { mkdir, open, rename, rm, truncate } from 'node:fs/promises'
import { join } from 'node:path'
import { writeJsonAtomicAsync } from '../atomic-json'
import { PARAKEET_V3, type ModelFile, type ModelManifest } from './models'

/**
 * Downloads, verifies and keeps the on-device speech model.
 *
 * The model is 640 MB, so three things matter more than usual. A download
 * that stops — a closed lid, a dropped connection, Cancel — resumes where it
 * stopped instead of starting again. Nothing is trusted until its SHA-256
 * matches the manifest, so a damaged or substituted file is never loaded. And
 * the full check happens once: a `verified.json` marker records it, so reading
 * the state at start-up costs a few file sizes, not hashing 640 MB.
 *
 * `fetch` and the one file operation worth faking (appending to a part file)
 * are injected, so every path here runs in tests against a temporary folder.
 */

export type StoredModelState = 'missing' | 'partial' | 'installed'

export interface DownloadProgress {
  /** `verifying` while existing files are hashed, `downloading` otherwise. */
  phase: 'downloading' | 'verifying'
  receivedBytes: number
  totalBytes: number
}

export const MARKER_FILE = 'verified.json'
const PART_SUFFIX = '.part'
/** Progress is reported at most about five times a second. */
const PROGRESS_INTERVAL_MS = 200
const HASH_CHUNK_BYTES = 1024 * 1024
/** A freshly written 640 MB file is often held briefly by an antivirus scan. */
const RENAME_ATTEMPTS = 8
const RENAME_RETRY_DELAY_MS = 250

export const DOWNLOAD_UNREACHABLE =
  'Could not reach the download server. Check your internet connection.'
export const DOWNLOAD_DAMAGED = 'The download was damaged. Try again.'
export const DISK_FULL = 'Not enough free disk space — about 700 MB is needed.'
export const SAVE_FAILED =
  'The speech model could not be saved on this PC. Check the disk and try again.'
export const REMOVE_FAILED =
  'The speech model could not be removed. Close anything using it and try again.'
export const ALREADY_DOWNLOADING = 'The speech model is already downloading.'

export function httpFailure(status: number): string {
  return `The download server answered with an error (HTTP ${status}).`
}

/** An error whose message is already a sentence the user can be shown. */
export class ModelStoreError extends Error {}

export type ModelFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal }
) => Promise<Response>

export interface AppendHandle {
  write(chunk: Uint8Array): Promise<void>
  /** Flushes to disk, so a renamed file is never one a power cut can truncate. */
  sync(): Promise<void>
  close(): Promise<void>
}

export interface ModelStoreFs {
  /** Opens a file for appending, creating it when absent. */
  openAppend(path: string): Promise<AppendHandle>
}

export interface ModelStoreOptions {
  /** The folder that holds one subfolder per model id. */
  root: string
  fetch: ModelFetch
  fs?: Partial<ModelStoreFs>
  /** The models this store knows. Tests substitute small ones. */
  manifests?: readonly ModelManifest[]
  now?: () => number
}

interface VerifiedMarker {
  id: string
  verifiedAt: string
  files: Array<{ name: string; bytes: number; sha256: string }>
}

/**
 * Where models live. `MURMUR_MODELS_DIR` wins, so tests and side-by-side runs
 * never touch the real copy. On Windows it is the *local* application-data
 * folder: the roaming profile is copied to and from the server at every
 * sign-in on managed machines, and 640 MB of model has no business travelling
 * with it.
 */
export function modelsRoot(input: {
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
  userData: string
}): string {
  const override = input.env.MURMUR_MODELS_DIR?.trim()
  if (override) return override
  const localAppData = input.env.LOCALAPPDATA?.trim()
  if (input.platform === 'win32' && localAppData) return join(localAppData, 'Murmur', 'models')
  return join(input.userData, 'models')
}

async function openAppend(path: string): Promise<AppendHandle> {
  const handle = await open(path, 'a')
  return {
    write: async (chunk) => {
      let written = 0
      while (written < chunk.byteLength) {
        const { bytesWritten } = await handle.write(chunk, written, chunk.byteLength - written)
        written += bytesWritten
      }
    },
    sync: () => handle.sync(),
    close: () => handle.close()
  }
}

function sizeOf(path: string): number | null {
  try {
    const stats = statSync(path)
    return stats.isFile() ? stats.size : null
  } catch {
    return null
  }
}

function readMarker(path: string): VerifiedMarker | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<VerifiedMarker> | null
    if (!value || typeof value.id !== 'string' || !Array.isArray(value.files)) return null
    return value as VerifiedMarker
  } catch {
    return null
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code
}

/** Runs a file operation, turning an operating-system error into a sentence. */
async function onDisk<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ModelStoreError) throw error
    throw new ModelStoreError(errorCode(error) === 'ENOSPC' ? DISK_FULL : SAVE_FAILED, {
      cause: error
    })
  }
}

async function removeIfPresent(path: string): Promise<void> {
  await onDisk(() => rm(path, { force: true }))
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      lastError = error
      if (attempt < RENAME_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS * attempt))
      }
    }
  }
  throw new ModelStoreError(SAVE_FAILED, { cause: lastError })
}

/** The first byte a 206 response says it carries, when it says. */
function contentRangeStart(response: Response): number | null {
  const match = /^bytes (\d+)-/u.exec(response.headers.get('content-range') ?? '')
  return match ? Number(match[1]) : null
}

class ProgressReporter {
  private lastAt = Number.NEGATIVE_INFINITY
  private lastPhase: DownloadProgress['phase'] | null = null

  constructor(
    private readonly onProgress: (progress: DownloadProgress) => void,
    private readonly totalBytes: number,
    private readonly now: () => number
  ) {}

  report(phase: DownloadProgress['phase'], receivedBytes: number): void {
    const at = this.now()
    // A change of phase is always news; more bytes of the same only every
    // PROGRESS_INTERVAL_MS, or the window would be redrawn thousands of times.
    if (phase === this.lastPhase && at - this.lastAt < PROGRESS_INTERVAL_MS) return
    this.lastAt = at
    this.lastPhase = phase
    this.onProgress({ phase, receivedBytes, totalBytes: this.totalBytes })
  }
}

export class ModelStore {
  private readonly fetch: ModelFetch
  private readonly fs: ModelStoreFs
  private readonly manifests: readonly ModelManifest[]
  private readonly now: () => number
  private readonly downloading = new Set<string>()

  constructor(private readonly options: ModelStoreOptions) {
    this.fetch = options.fetch
    this.fs = { openAppend, ...options.fs }
    this.manifests = options.manifests ?? [PARAKEET_V3]
    this.now = options.now ?? (() => Date.now())
  }

  /** The model's folder, for the engine. */
  path(id: string): string {
    return join(this.options.root, this.manifest(id).id)
  }

  /**
   * What is on disk. `installed` means every file has its manifest size and
   * the marker lists the manifest's hashes — both cheap to read. `partial`
   * means a download was started: a `.part` file, or a finished file not yet
   * vouched for by a marker, which the next download verifies rather than
   * fetches again.
   */
  state(id: string): StoredModelState {
    const manifest = this.manifest(id)
    const folder = this.path(id)
    if (this.isInstalled(manifest, folder)) return 'installed'
    const started = manifest.files.some(
      (file) =>
        sizeOf(join(folder, `${file.name}${PART_SUFFIX}`)) !== null ||
        sizeOf(join(folder, file.name)) !== null
    )
    return started ? 'partial' : 'missing'
  }

  /**
   * Fetches whatever is missing, verifies everything, and writes the marker.
   *
   * Rejects with a `ModelStoreError` carrying a sentence for the user, or
   * with the abort reason when `signal` fires — in which case every `.part`
   * file is kept for the next attempt to resume.
   */
  async download(
    id: string,
    onProgress: (progress: DownloadProgress) => void = () => undefined,
    signal: AbortSignal = new AbortController().signal
  ): Promise<void> {
    const manifest = this.manifest(id)
    // Two downloads appending to the same part file would corrupt it.
    if (this.downloading.has(manifest.id)) throw new ModelStoreError(ALREADY_DOWNLOADING)
    this.downloading.add(manifest.id)
    try {
      await this.downloadAll(manifest, new ProgressReporter(onProgress, manifest.totalBytes, this.now), signal)
    } finally {
      this.downloading.delete(manifest.id)
    }
  }

  /** Deletes the model's folder, parts and all. */
  async remove(id: string): Promise<void> {
    const manifest = this.manifest(id)
    if (this.downloading.has(manifest.id)) throw new ModelStoreError(ALREADY_DOWNLOADING)
    try {
      await rm(this.path(id), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (error) {
      throw new ModelStoreError(REMOVE_FAILED, { cause: error })
    }
  }

  private manifest(id: string): ModelManifest {
    const manifest = this.manifests.find((candidate) => candidate.id === id)
    if (!manifest) throw new ModelStoreError('That speech model is not one Vocette knows.')
    return manifest
  }

  private isInstalled(manifest: ModelManifest, folder: string): boolean {
    const marker = readMarker(join(folder, MARKER_FILE))
    if (!marker || marker.id !== manifest.id) return false
    return manifest.files.every((file) => {
      const listed = marker.files.find((entry) => entry?.name === file.name)
      return (
        listed?.sha256 === file.sha256 &&
        listed.bytes === file.bytes &&
        sizeOf(join(folder, file.name)) === file.bytes
      )
    })
  }

  private async downloadAll(
    manifest: ModelManifest,
    progress: ProgressReporter,
    signal: AbortSignal
  ): Promise<void> {
    const folder = this.path(manifest.id)
    if (this.isInstalled(manifest, folder)) return
    await onDisk(() => mkdir(folder, { recursive: true }))
    // A marker that does not match the manifest vouches for other files.
    await removeIfPresent(join(folder, MARKER_FILE))

    let completed = 0
    for (const file of manifest.files) {
      signal.throwIfAborted()
      await this.ensureFile(file, folder, completed, progress, signal)
      completed += file.bytes
    }

    const marker: VerifiedMarker = {
      id: manifest.id,
      verifiedAt: new Date(this.now()).toISOString(),
      files: manifest.files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 }))
    }
    await onDisk(() => writeJsonAtomicAsync(join(folder, MARKER_FILE), marker))
  }

  /** Leaves `file` complete and verified under its final name. */
  private async ensureFile(
    file: ModelFile,
    folder: string,
    completed: number,
    progress: ProgressReporter,
    signal: AbortSignal
  ): Promise<void> {
    const finalPath = join(folder, file.name)
    const partPath = `${finalPath}${PART_SUFFIX}`

    // Only a verified file is ever renamed into place, but one that arrived
    // some other way — copied in by hand, or damaged since — has not been
    // checked by anyone, so without a marker it is hashed again. A copy that
    // matches is kept and nothing is fetched.
    const finalSize = sizeOf(finalPath)
    if (finalSize !== null) {
      if (finalSize === file.bytes) {
        const hash = createHash('sha256')
        await this.hashInto(hash, finalPath, (hashed) => progress.report('verifying', completed + hashed), signal)
        if (hash.digest('hex') === file.sha256) {
          await removeIfPresent(partPath)
          return
        }
      }
      await removeIfPresent(finalPath)
    }

    // Resume from a part file, carrying its bytes into the same hash.
    let hash = createHash('sha256')
    let offset = 0
    const partSize = sizeOf(partPath)
    if (partSize !== null && partSize <= file.bytes) {
      await this.hashInto(hash, partPath, (hashed) => progress.report('verifying', completed + hashed), signal)
      offset = partSize
    } else if (partSize !== null) {
      await removeIfPresent(partPath)
    }

    if (offset < file.bytes) {
      const response = await this.request(file.url, offset, signal)
      if (response.status === 206 && offset > 0) {
        const start = contentRangeStart(response)
        if (start !== null && start !== offset) {
          // Not the bytes that were asked for. Start this file afresh next time.
          await response.body?.cancel().catch(() => undefined)
          await removeIfPresent(partPath)
          throw new ModelStoreError(DOWNLOAD_DAMAGED)
        }
      } else if (response.status === 200 && offset > 0) {
        // The server ignored the range and is sending the whole file.
        await onDisk(() => truncate(partPath, 0))
        hash = createHash('sha256')
        offset = 0
      } else if (response.status === 416) {
        // The part is not the start of the file the server now has.
        await response.body?.cancel().catch(() => undefined)
        await removeIfPresent(partPath)
        throw new ModelStoreError(DOWNLOAD_DAMAGED)
      } else if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new ModelStoreError(httpFailure(response.status))
      }
      offset = await this.receive(response, file, partPath, hash, offset, (received) =>
        progress.report('downloading', completed + received), signal)
    }

    if (offset !== file.bytes || hash.digest('hex') !== file.sha256) {
      await removeIfPresent(partPath)
      throw new ModelStoreError(DOWNLOAD_DAMAGED)
    }
    await renameWithRetry(partPath, finalPath)
  }

  private async request(url: string, offset: number, signal: AbortSignal): Promise<Response> {
    try {
      return await this.fetch(url, {
        headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
        signal
      })
    } catch (error) {
      signal.throwIfAborted()
      throw new ModelStoreError(DOWNLOAD_UNREACHABLE, { cause: error })
    }
  }

  /** Streams the body onto the end of the part file, hashing as it goes. */
  private async receive(
    response: Response,
    file: ModelFile,
    partPath: string,
    hash: Hash,
    startOffset: number,
    onReceived: (received: number) => void,
    signal: AbortSignal
  ): Promise<number> {
    const reader = response.body?.getReader()
    if (!reader) throw new ModelStoreError(DOWNLOAD_DAMAGED)
    let part: AppendHandle
    try {
      signal.throwIfAborted()
      part = await onDisk(() => this.fs.openAppend(partPath))
    } catch (error) {
      await reader.cancel().catch(() => undefined)
      throw error
    }

    // A body that ignores the signal must still not hold a cancelled download
    // open, so every read races the abort.
    let onAbort: (() => void) | null = null
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
    })
    aborted.catch(() => undefined)

    let offset = startOffset
    let finished = false
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>
        try {
          chunk = await Promise.race([reader.read(), aborted])
        } catch (error) {
          signal.throwIfAborted()
          throw new ModelStoreError(DOWNLOAD_UNREACHABLE, { cause: error })
        }
        if (chunk.done) {
          finished = true
          break
        }
        const bytes = chunk.value
        offset += bytes.byteLength
        // More than the file can hold is not the file.
        if (offset > file.bytes) throw new ModelStoreError(DOWNLOAD_DAMAGED)
        hash.update(bytes)
        await onDisk(() => part.write(bytes))
        onReceived(offset)
      }
      await onDisk(() => part.sync())
    } catch (error) {
      if (error instanceof ModelStoreError && error.message === DOWNLOAD_DAMAGED) {
        // Never resume from bytes already known to be wrong.
        await part.close().catch(() => undefined)
        await removeIfPresent(partPath)
        throw error
      }
      throw error
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort)
      if (!finished) await reader.cancel().catch(() => undefined)
      await part.close().catch(() => undefined)
    }
    return offset
  }

  /** Hashes a file already on disk, reporting how far it has got. */
  private async hashInto(
    hash: Hash,
    path: string,
    onHashed: (hashed: number) => void,
    signal: AbortSignal
  ): Promise<void> {
    const stream = createReadStream(path, { highWaterMark: HASH_CHUNK_BYTES })
    let hashed = 0
    try {
      for await (const chunk of stream) {
        signal.throwIfAborted()
        const bytes = chunk as Buffer
        hash.update(bytes)
        hashed += bytes.byteLength
        onHashed(hashed)
      }
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof ModelStoreError) throw error
      throw new ModelStoreError(SAVE_FAILED, { cause: error })
    } finally {
      stream.destroy()
    }
  }
}
