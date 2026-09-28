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
