/**
 * What to do with the keyboard hook when the user comes back from a sleep or
 * the lock screen. Windows can drop a low-level hook while the PC is away, and
 * the key-ups of Win + L are made where no hook can see them, so either way
 * the shortcut can go dead until Vocette restarts. Putting the hook back with
 * nothing held cures both.
 */

/** Resume and unlock often arrive together; one re-arm covers both. */
export const REARM_DEBOUNCE_MS = 3000

export type RearmPlan = 'skip' | 'rearm' | 'cancel-then-rearm'

export function rearmPlan(state: {
  /** Whether a take is still recording. */
  recording: boolean
  /** When the hook was last put back, or null if it never has been. */
  lastRearmAt: number | null
  now: number
}): RearmPlan {
  const since = state.lastRearmAt === null ? null : state.now - state.lastRearmAt
  // A clock set back after a resume makes `since` negative. That is not a
  // recent re-arm, and treating it as one would skip every re-arm until the
  // clock caught up again.
  if (since !== null && since >= 0 && since < REARM_DEBOUNCE_MS) return 'skip'
  // A take still recording across a sleep or a lock is not one to trust: the
  // microphone may have been reset under it.
  return state.recording ? 'cancel-then-rearm' : 'rearm'
}
