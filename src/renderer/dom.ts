export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export { formatDuration, wordCount } from '../shared/format'

export function formatDate(iso: string): string {
  const date = new Date(iso)
  const sameDay = date.toDateString() === new Date().toDateString()
  // `undefined` locale follows Windows' regional format instead of forcing en-GB.
  return new Intl.DateTimeFormat(undefined, {
    ...(sameDay ? {} : { day: 'numeric', month: 'short' }),
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

/** Renders a chord as a row of `<kbd>` chips. */
export function keyChips(labels: readonly string[]): string {
  if (!labels.length) return '<kbd class="chip chip-empty">Not set</kbd>'
  return labels.map((label) => `<kbd class="chip">${escapeHtml(label)}</kbd>`).join('<i>+</i>')
}
