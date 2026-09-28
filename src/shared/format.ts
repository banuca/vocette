export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`
}

/**
 * Whole decimal megabytes, the unit a download size is quoted in: the speech
 * model's 670,478,772 bytes are 670. Rounded down, so a count in progress is
 * never ahead of what has actually arrived.
 */
export function wholeMegabytes(bytes: number): number {
  return Math.max(0, Math.floor(bytes / 1_000_000))
}

export function formatMegabytes(bytes: number): string {
  return `${wholeMegabytes(bytes).toLocaleString('en-GB')} MB`
}

export function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/u).length : 0
}

/**
 * A wait after letting go, as the overlay and History show it: "0.4s", or
 * whole seconds from 10 s up, where tenths stop meaning anything.
 */
export function formatWait(milliseconds: number): string {
  const seconds = Math.max(0, milliseconds) / 1000
  return seconds < 9.95 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
}

/** True for a wait that was really measured; older entries have none. */
export function isMeasuredWait(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** How many of the newest measured dictations "Typical wait" is taken over. */
export const TYPICAL_WAIT_SAMPLE = 50

/**
 * The median wait over the newest measured dictations, newest first as
 * History lists them; null when none was measured. A median, so one slow
 * first take after a restart does not speak for the rest.
 */
export function typicalWait(entries: readonly { waitMs?: number }[]): number | null {
  const waits: number[] = []
  for (const entry of entries) {
    if (!isMeasuredWait(entry.waitMs)) continue
    waits.push(entry.waitMs)
    if (waits.length === TYPICAL_WAIT_SAMPLE) break
  }
  if (!waits.length) return null
  waits.sort((a, b) => a - b)
  const middle = Math.floor(waits.length / 2)
  return waits.length % 2 === 1
    ? (waits[middle] as number)
    : ((waits[middle - 1] as number) + (waits[middle] as number)) / 2
}
