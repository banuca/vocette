import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync
} from 'node:fs'
import { copyFile, open, rename } from 'node:fs/promises'

/**
 * Crash-safe JSON files.
 *
 * The previous implementation used a bare `writeFileSync` and, on a parse
 * failure, silently fell back to an empty value — so a crash mid-write
 * truncated the file and the next write replaced it with `[]` or defaults.
 * That destroyed transcript history and the encrypted API key with no warning.
 *
 * Here: write to `<file>.tmp`, fsync, keep the previous good copy as
 * `<file>.bak`, then rename over the target. On read, a corrupt primary falls
 * back to `.bak`, and a corrupt-with-no-backup file is *preserved* (moved
 * aside) rather than overwritten.
 */

export interface ReadResult<T> {
  value: T | null
  /** Set when the file existed but could not be used. */
  problem?: string
}

const RENAME_ATTEMPTS = 4
const RENAME_RETRY_DELAY_MS = 60

/**
 * Windows rename can fail transiently with EPERM/EACCES when antivirus or
 * Explorer holds the target. A few short retries make those failures
 * invisible instead of surfacing a cryptic OS error in the settings UI.
 */
async function renameWithRetry(temporaryPath: string, path: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt += 1) {
    try {
      await rename(temporaryPath, path)
      return
    } catch (error) {
      lastError = error
      if (attempt < RENAME_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS * attempt))
      }
    }
  }
  const code = (lastError as NodeJS.ErrnoException | null)?.code ?? 'UNKNOWN'
  throw new Error(
    `Could not finish saving the data file (${code}). ` +
      'Close any app that has it open and try again.',
    { cause: lastError }
  )
}

function parse<T>(path: string): T | null {
  const raw = readFileSync(path, 'utf8')
  if (!raw.trim()) return null
  return JSON.parse(raw) as T
}

export function readJsonWithBackup<T>(path: string): ReadResult<T> {
  if (existsSync(path)) {
    try {
      const value = parse<T>(path)
      if (value !== null) return { value }
    } catch {
      // fall through to the backup
    }
  } else if (!existsSync(`${path}.bak`)) {
    return { value: null }
  }

  const backupPath = `${path}.bak`
  if (existsSync(backupPath)) {
    try {
      const value = parse<T>(backupPath)
      if (value !== null) {
        preserveCorrupt(path)
        return {
          value,
          problem: `${path} was unreadable; recovered the previous version from ${backupPath}.`
        }
      }
    } catch {
      // both copies are bad
    }
  }

  const preserved = preserveCorrupt(path)
  return {
    value: null,
    problem: preserved
      ? `${path} was unreadable and no backup was usable. The damaged file was kept as ${preserved}.`
      : undefined
  }
}

/**
 * Moves a damaged file aside so a later write cannot silently erase it.
 * Returns the path it was moved to, or null when there was nothing to keep.
 */
function preserveCorrupt(path: string): string | null {
  if (!existsSync(path)) return null
  const target = `${path}.corrupt`
  try {
    if (existsSync(target)) unlinkSync(target)
    renameSync(path, target)
    return target
  } catch {
    return null
  }
}

function renameWithRetrySync(temporaryPath: string, path: string): void {
  let lastError: unknown
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt += 1) {
    try {
      renameSync(temporaryPath, path)
      return
    } catch (error) {
      lastError = error
      if (attempt < RENAME_ATTEMPTS) {
        // Blocking retry backoff; the main thread is doing nothing else here.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_RETRY_DELAY_MS * attempt)
      }
    }
  }
  const code = (lastError as NodeJS.ErrnoException | null)?.code ?? 'UNKNOWN'
  throw new Error(
    `Could not finish saving the data file (${code}). ` +
      'Close any app that has it open and try again.',
    { cause: lastError }
  )
}

export function writeJsonAtomic(path: string, value: unknown): void {
  const temporaryPath = `${path}.tmp`
  const payload = `${JSON.stringify(value)}\n`

  const handle = openSync(temporaryPath, 'w', 0o600)
  try {
    writeSync(handle, payload, null, 'utf8')
    // Force the bytes to disk before the rename, so a power loss can only ever
    // leave a complete old file or a complete new one.
    fsyncSync(handle)
  } finally {
    closeSync(handle)
  }

  if (existsSync(path)) {
    try {
      copyFileSync(path, `${path}.bak`)
    } catch {
      // A missing backup must not block the write.
    }
  }

  renameWithRetrySync(temporaryPath, path)
}

/**
 * Same guarantees as `writeJsonAtomic`, off the main thread.
 *
 * History is rewritten in full after every dictation, so doing it
 * synchronously stalled the main process for longer and longer as the file
 * grew. Callers still flush — now asynchronously — on quit.
 */
export async function writeJsonAtomicAsync(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.tmp`
  const payload = `${JSON.stringify(value)}\n`

  const handle = await open(temporaryPath, 'w', 0o600)
  try {
    await handle.writeFile(payload, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }

  if (existsSync(path)) {
    try {
      await copyFile(path, `${path}.bak`)
    } catch {
      // A missing backup must not block the write.
    }
  }

  await renameWithRetry(temporaryPath, path)
}
