import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  readJsonWithBackup,
  refreshJsonRecoveryBackupAsync,
  removeJsonRecoveryCopiesAsync,
  writeJsonAtomicAsync
} from './atomic-json'
import {
  EMPTY_EDIT_REFUSAL,
  MAX_HISTORY_TEXT_CHARS,
  type HistoryEntry,
  type HistorySaveStatus
} from '../shared/types'

const MAX_ENTRIES = 5000

/** The optional fields that carry text, checked and clamped like `text` itself. */
const OPTIONAL_TEXT_FIELDS = ['heardText', 'uneditedText'] as const

interface HistoryPersistence {
  writeJsonAtomicAsync: typeof writeJsonAtomicAsync
  removeJsonRecoveryCopiesAsync: typeof removeJsonRecoveryCopiesAsync
  refreshJsonRecoveryBackupAsync: typeof refreshJsonRecoveryBackupAsync
}

/**
 * The load filter. It checks the five original fields only, and must go on
 * doing so: it is all or nothing, so demanding a field that older files lack
 * would silently drop every entry saved before it.
 */
function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === 'string' &&
    typeof entry.text === 'string' &&
    typeof entry.createdAt === 'string' &&
    typeof entry.durationMs === 'number' &&
    typeof entry.model === 'string'
  )
}

/**
 * An entry the window hands back for Undo. It has crossed the IPC bridge, so
 * its shape is not taken on trust: the load filter's five fields, and each
 * optional field that is present with its own type.
 */
export function isRestorableEntry(value: unknown): value is HistoryEntry {
  if (!isHistoryEntry(value)) return false
  const entry = value as unknown as Record<string, unknown>
  return [...OPTIONAL_TEXT_FIELDS, 'editedAt'].every(
    (field) => entry[field] === undefined || typeof entry[field] === 'string'
  )
}

function clampText(text: string): string {
  return text.length > MAX_HISTORY_TEXT_CHARS ? text.slice(0, MAX_HISTORY_TEXT_CHARS) : text
}

export class HistoryStore {
  private entries: HistoryEntry[]
  private warning: string | null = null
  /** Always resolves, so a failed background write cannot poison later writes. */
  private writeTail: Promise<void> = Promise.resolve()
  /**
   * Set only when the primary file parsed cleanly, which is the one state that
   * proves the prior process got as far as writing it. The first retention
   * pass then finishes the companion cleanup that process may have been
   * interrupted during — deleting stale copies and refreshing the backup.
   *
   * After damaged-file recovery it stays false. There the companions are the
   * remaining copies of data this process could not read, so a verification
   * pass with nothing expired in memory has nothing to prove against them and
   * must not scrub them.
   */
  private interruptedCleanupCheckPending: boolean
  /** Where an unreadable primary was kept, so the warning can qualify it. */
  private readonly preservedDamagedFile: string | null
  /** A failed prune must report completion when its later retry succeeds. */
  private retentionCleanupFailed = false
  /**
   * Bumped by every change to `entries`. A completed write only proves the
   * snapshot it carried, so the warning may clear only once a persisted
   * version has caught up with the version currently in memory — an older
   * queued snapshot landing must not speak for entries added after it.
   */
  private version = 0
  private savedVersion = 0
  private saveFailed = false
  private readonly saveStatusListeners = new Set<(status: HistorySaveStatus) => void>()
  private readonly persistence: HistoryPersistence

  constructor(
    private readonly filePath: string,
    persistence: Partial<HistoryPersistence> = {}
  ) {
    this.persistence = {
      writeJsonAtomicAsync,
      removeJsonRecoveryCopiesAsync,
      refreshJsonRecoveryBackupAsync,
      ...persistence
    }
    const { value, problem, preserved } = readJsonWithBackup<unknown>(filePath)
    this.entries = Array.isArray(value) ? value.filter(isHistoryEntry).slice(0, MAX_ENTRIES) : []
    this.interruptedCleanupCheckPending = problem === undefined && value !== null
    this.preservedDamagedFile = preserved ?? null
    this.warning = problem ?? null
  }

  takeWarning(): string | null {
    const warning = this.warning
    this.warning = null
    if (!warning) return null
    // Only mention the kept copy while it is actually there: a deletion, or a
    // prune that did find expired entries, scrubs it, and the note would then
    // describe a file that no longer exists.
    if (!this.preservedDamagedFile || !existsSync(this.preservedDamagedFile)) return warning
    return (
      `${warning} Retention cannot prune ${this.preservedDamagedFile} entry by entry,` +
      ' because its contents could not be parsed. It is kept for now, but a later' +
      ' cleanup deletes the whole file — with retention enabled, that includes the' +
      ' next startup once the primary file is readable again. Copy it somewhere else' +
      ' now if you need it to recover anything.'
    )
  }

  list(): HistoryEntry[] {
    return this.entries.map((entry) => ({ ...entry }))
  }

  add(input: Omit<HistoryEntry, 'id' | 'createdAt'>): HistoryEntry {
    const entry: HistoryEntry = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString()
    }
    this.entries.unshift(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.length = MAX_ENTRIES
    this.version += 1
    // A storage problem must never become a transcription failure: the entry
    // is already listed, and the rejection is reported through the save status.
    void this.persist(false).catch(() => undefined)
    return { ...entry }
  }

  async delete(id: string): Promise<HistoryEntry[]> {
    this.entries = this.entries.filter((entry) => entry.id !== id)
    this.version += 1
    await this.persist(true)
    return this.list()
  }

  /**
   * Replaces an entry's text with the user's correction. The date, duration,
   * model and what was heard stay as they were; the text before the first
   * edit is kept, so a second edit cannot overwrite what was delivered.
   *
   * Written like a delete, recovery copies included: an edit is destructive
   * to the text it replaces, and a stale `.bak` would bring that back.
   */
  async update(id: string, text: string): Promise<HistoryEntry[]> {
    const index = this.entries.findIndex((entry) => entry.id === id)
    const current = this.entries[index]
    if (!current) throw new Error('That dictation is no longer in your history.')
    const next = clampText(text)
    if (!next.trim()) throw new Error(EMPTY_EDIT_REFUSAL)
    // Nothing changed, so nothing is marked as edited and nothing is written.
    if (next === current.text) return this.list()

    this.entries[index] = {
      ...current,
      text: next,
      editedAt: new Date().toISOString(),
      uneditedText: current.uneditedText ?? current.text
    }
    this.version += 1
    await this.persist(true)
    return this.list()
  }

  /**
   * Puts back an entry the user has just deleted, from the window's copy of
   * it: the deletion itself went to disk at once, because a delete means
   * delete. It goes back where it was — among the rest by date, newest first.
   *
   * Only the fields History knows are taken, whatever else the object
   * carries; a field added to `HistoryEntry` later must be added here too, or
   * Undo would drop it.
   */
  async restore(entry: HistoryEntry): Promise<HistoryEntry[]> {
    if (this.entries.some((existing) => existing.id === entry.id)) {
      throw new Error('That dictation is already in your history.')
    }
    const restored: HistoryEntry = {
      id: entry.id,
      text: clampText(entry.text),
      createdAt: entry.createdAt,
      durationMs: entry.durationMs,
      model: entry.model
    }
    for (const field of OPTIONAL_TEXT_FIELDS) {
      const value = entry[field]
      if (value !== undefined) restored[field] = clampText(value)
    }
    if (entry.editedAt !== undefined) restored.editedAt = entry.editedAt

    // Ahead of the first entry that is no newer, so it lands between the
    // same neighbours it was deleted from.
    const createdAt = Date.parse(restored.createdAt)
    const at = this.entries.findIndex((existing) => Date.parse(existing.createdAt) <= createdAt)
    this.entries.splice(at === -1 ? this.entries.length : at, 0, restored)
    if (this.entries.length > MAX_ENTRIES) this.entries.length = MAX_ENTRIES
    this.version += 1
    // Adds back what the user chose to keep; there is no deleted content for
    // the recovery copies to shed, so it is written like a new dictation.
    await this.persist(false)
    return this.list()
  }

  async clear(): Promise<void> {
    this.entries = []
    this.version += 1
    await this.persist(true)
  }

  async prune(retentionDays: number): Promise<boolean> {
    if (retentionDays <= 0) return false
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
    const next = this.entries.filter((entry) => Date.parse(entry.createdAt) >= cutoff)
    const changed = next.length !== this.entries.length
    const retryingFailedCleanup = this.retentionCleanupFailed
    // Persist with nothing expired only to finish work already begun: an
    // interrupted cleanup after a clean load, or a cleanup this store knows
    // failed. Neither applies to a store that recovered from damaged data.
    if (!changed && !this.interruptedCleanupCheckPending && !retryingFailedCleanup) return false

    if (changed) {
      this.entries = next
      this.version += 1
    }
    try {
      await this.persist(true)
    } catch (error) {
      // `entries` is intentionally already pruned, so a retry must still
      // write its current snapshot and refresh recovery copies.
      this.retentionCleanupFailed = true
      throw error
    }
    this.interruptedCleanupCheckPending = false
    this.retentionCleanupFailed = false
    return changed || retryingFailedCleanup
  }

  /**
   * Whether a save has been observed to fail and has not since been made good.
   *
   * `saveFailed: false` is the starting state and claims only that no failure
   * is outstanding — never that a queued write has finished, so a store with
   * writes still in flight reports false. It returns to false only once a
   * completed write covers the version currently in memory.
   */
  getSaveStatus(): HistorySaveStatus {
    return { saveFailed: this.saveFailed }
  }

  /**
   * Notifies on every change to the save status. Returns an unsubscribe so a
   * caller that goes away cannot keep a stale window or menu alive.
   */
  onSaveStatusChanged(listener: (status: HistorySaveStatus) => void): () => void {
    this.saveStatusListeners.add(listener)
    return () => {
      this.saveStatusListeners.delete(listener)
    }
  }

  /**
   * Waits until every scheduled write has landed on disk. The previous build
   * returned immediately while a write was in flight, so quitting within
   * moments of a dictation could kill the process between the fsync and the
   * rename — losing the newest transcript on the next launch.
   *
   * Completion proves only that nothing is still queued, never that the writes
   * succeeded: a failed write drains the queue like any other. Callers that
   * need to know whether history survived must read `getSaveStatus()` after
   * this resolves — before it, a false there only means nothing has failed yet.
   */
  async flush(): Promise<void> {
    for (;;) {
      const tail = this.writeTail
      await tail
      if (tail === this.writeTail) return
    }
  }

  /**
   * Serialises every snapshot. A destructive write waits behind an older
   * in-flight snapshot, then writes the deletion and removes its recovery
   * copies before its caller can report success. A later add gets its own
   * snapshot after that cleanup, so it cannot restore deleted content.
   */
  private persist(removeRecoveryCopies: boolean): Promise<void> {
    const snapshot = this.entries.map((entry) => ({ ...entry }))
    const version = this.version
    const task = this.writeTail.then(async () => {
      try {
        await this.persistence.writeJsonAtomicAsync(this.filePath, snapshot)
      } catch (error) {
        this.setSaveFailed(true)
        throw error
      }
      // The snapshot is on disk. Companion cleanup failing after this is a
      // retention problem, reported by the rejecting caller — the transcripts
      // themselves are saved, so the save warning must not claim otherwise.
      this.markSaved(version)
      if (removeRecoveryCopies) {
        await this.persistence.removeJsonRecoveryCopiesAsync(this.filePath)
        await this.persistence.refreshJsonRecoveryBackupAsync(this.filePath)
      }
    })
    this.writeTail = task.catch(() => undefined)
    return task
  }

  private markSaved(version: number): void {
    if (version > this.savedVersion) this.savedVersion = version
    if (this.savedVersion >= this.version) this.setSaveFailed(false)
  }

  private setSaveFailed(failed: boolean): void {
    if (this.saveFailed === failed) return
    this.saveFailed = failed
    const status = this.getSaveStatus()
    // A listener that throws must not take down the write queue with it.
    this.saveStatusListeners.forEach((listener) => {
      try {
        listener(status)
      } catch {
        // Reporting the status is best effort.
      }
    })
  }
}
