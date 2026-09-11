import type { HistoryEntry } from '../shared/types'

type HistoryInput = Omit<HistoryEntry, 'id' | 'createdAt'>

interface HistoryRetentionStore {
  add(input: HistoryInput): HistoryEntry
  prune(retentionDays: number): Promise<boolean>
}

export interface HistoryRetentionDependencies {
  historyStore: HistoryRetentionStore
  retentionDays: () => number
  onHistoryChanged: () => void
  onRetentionFailure: (error: unknown) => void
}

/**
 * Saves a usable transcript immediately, then performs retention in the
 * background. Retention failure is deliberately reported instead of becoming
 * an unhandled rejection or changing the successful dictation into a retry.
 */
export function recordHistoryWithRetention(
  dependencies: HistoryRetentionDependencies,
  input: HistoryInput
): void {
  dependencies.historyStore.add(input)
  void dependencies.historyStore
    .prune(dependencies.retentionDays())
    .catch((error: unknown) => dependencies.onRetentionFailure(error))
  dependencies.onHistoryChanged()
}
