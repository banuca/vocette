import { PRODUCT_NAME } from './product'

/**
 * The update check, as the window sees it. Off unless the user switches it on;
 * "Check now" works either way. Nothing is ever downloaded or installed: an
 * update found is a line of text and a link to the release page.
 */
export interface UpdateStatus {
  /** Whether the daily check is switched on. */
  enabled: boolean
  state: 'idle' | 'checking' | 'latest' | 'available' | 'error'
  /** The version running now. */
  current: string
  /** The newest published version, once a check has found one. */
  latest: string | null
  /** When the last check finished, successfully or not. */
  checkedAt: string | null
  /** Why the last check failed, in words for the window. */
  error: string | null
}

const VERSION_PATTERN = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,40}))?(?:\+[0-9A-Za-z.-]{1,40})?$/u

interface Version {
  core: [number, number, number]
  prerelease: string[]
}

function parseVersion(text: string): Version | null {
  const match = VERSION_PATTERN.exec(text.trim())
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : []
  }
}

/** True for a tag this check can compare: `0.6.0`, `v0.6.0`, `v1.0.0-beta.2`. */
export function isVersion(text: string): boolean {
  return parseVersion(text) !== null
}

/** The version without a leading `v`, for display. */
export function displayVersion(text: string): string {
  return text.trim().replace(/^v/u, '')
}

function compareIdentifiers(a: string, b: string): number {
  const numericA = /^\d+$/u.test(a)
  const numericB = /^\d+$/u.test(b)
  if (numericA && numericB) return Math.sign(Number(a) - Number(b))
  // Semantic Versioning: numeric identifiers sort before alphanumeric ones.
  if (numericA) return -1
  if (numericB) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Semantic Versioning order, `v` prefix tolerated: -1, 0 or 1. A pre-release
 * sorts before its release, so `0.6.0-beta.1` is never offered over `0.6.0`.
 * Anything that is not a version sorts as older than everything, so a
 * malformed tag can never be offered as an update.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return left ? 1 : right ? -1 : 0
  for (let index = 0; index < 3; index += 1) {
    const difference = Math.sign((left.core[index] ?? 0) - (right.core[index] ?? 0))
    if (difference !== 0) return difference
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    return Math.sign(right.prerelease.length - left.prerelease.length)
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const x = left.prerelease[index]
    const y = right.prerelease[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const difference = compareIdentifiers(x, y)
    if (difference !== 0) return difference
  }
  return 0
}

/** The result line under "Check now". Empty before the first check. */
export function updateResultText(status: UpdateStatus): string {
  switch (status.state) {
    case 'checking':
      return 'Checking…'
    case 'latest':
      return `You have the latest version (${displayVersion(status.current)}).`
    case 'available':
      return `${PRODUCT_NAME} ${displayVersion(status.latest ?? '')} is available.`
    case 'error':
      return status.error ?? 'The check did not work. Try again later.'
    default:
      return ''
  }
}
