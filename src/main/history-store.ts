import { randomUUID } from 'node:crypto'
import { readJsonWithBackup, writeJsonAtomic, writeJsonAtomicAsync } from './atomic-json'
import type { HistoryEntry } from '../shared/types'

const MAX_ENTRIES = 5000

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

export class HistoryStore {
  private entries: HistoryEntry[]
  private warning: string | null = null
  private writing = false
  private writeAgain = false

  constructor(private readonly filePath: string) {
    const { value, problem } = readJsonWithBackup<unknown>(filePath)
    this.entries = Array.isArray(value) ? value.filter(isHistoryEntry).slice(0, MAX_ENTRIES) : []
    this.warning = problem ?? null
  }

  takeWarning(): string | null {
    const warning = this.warning
    this.warning = null
    return warning
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
    this.scheduleWrite()
    return { ...entry }
  }

  delete(id: string): HistoryEntry[] {
    this.entries = this.entries.filter((entry) => entry.id !== id)
    this.scheduleWrite()
    return this.list()
  }

  clear(): void {
    this.entries = []
    this.scheduleWrite()
  }

  prune(retentionDays: number): boolean {
    if (retentionDays <= 0) return false
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
    const next = this.entries.filter((entry) => Date.parse(entry.createdAt) >= cutoff)
    if (next.length === this.entries.length) return false
    this.entries = next
    this.scheduleWrite()
    return true
  }

  /** Writes any pending changes synchronously. Call before quitting. */
  flush(): void {
    if (!this.writing && !this.writeAgain) return
    this.writeAgain = false
    try {
      writeJsonAtomic(this.filePath, this.entries)
    } catch {
      // Nothing useful to do while shutting down.
    }
  }

  /**
   * Coalescing async write: at most one write in flight, with a single pending
   * follow-up that always serialises the newest state.
   */
  private scheduleWrite(): void {
    if (this.writing) {
      this.writeAgain = true
      return
    }
    this.writing = true
    void writeJsonAtomicAsync(this.filePath, this.entries)
      .catch(() => {
        // Surfaced on next launch by the backup recovery path.
      })
      .finally(() => {
        this.writing = false
        if (this.writeAgain) {
          this.writeAgain = false
          this.scheduleWrite()
        }
      })
  }
}
