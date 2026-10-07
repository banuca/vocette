import { PRODUCT_NAME } from '../shared/product'
import { compareVersions, isVersion, type UpdateStatus } from '../shared/update'

/**
 * Asks GitHub whether a newer release exists, and nothing more. One GET to
 * the public releases API: no account, no identifier, nothing about the user
 * or their dictation, and nothing downloaded. It only ever runs because the
 * user asked — "Check now", or the daily check they switched on.
 */

export const UPDATE_TIMEOUT_MS = 10_000
/** A first automatic check waits until startup has settled. */
export const FIRST_CHECK_DELAY_MS = 60_000
/** Never more often than this on its own. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
/** How often a running app asks itself whether a daily check is due. */
export const DUE_CHECK_TICK_MS = 60 * 60 * 1000

export type UpdateFetch = (url: string, init: RequestInit) => Promise<Response>

export type CheckResult =
  | { ok: true; latest: string; releaseUrl: string }
  | { ok: false; error: string }

const NOT_READABLE = "GitHub's answer could not be read. Try again later."

export async function fetchLatestRelease(options: {
  fetch: UpdateFetch
  repository: string
  currentVersion: string
  timeoutMs?: number
}): Promise<CheckResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? UPDATE_TIMEOUT_MS)
  let response: Response
  try {
    response = await options.fetch(
      `https://api.github.com/repos/${options.repository}/releases/latest`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          // GitHub asks every API client to name itself.
          'User-Agent': `${PRODUCT_NAME}/${options.currentVersion}`
        },
        signal: controller.signal
      }
    )
  } catch {
    clearTimeout(timer)
    return {
      ok: false,
      error: controller.signal.aborted
        ? 'GitHub did not answer within 10 seconds. Try again later.'
        : 'Could not reach GitHub. Check your internet connection and try again.'
    }
  }
  try {
    if (response.status === 404) {
      return { ok: false, error: 'No published release was found on GitHub.' }
    }
    if (response.status === 403 || response.status === 429) {
      return {
        ok: false,
        error: 'GitHub is limiting requests from this network. Try again in an hour.'
      }
    }
    if (!response.ok) {
      return {
        ok: false,
        error: `GitHub answered with an error (HTTP ${response.status}). Try again later.`
      }
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      return { ok: false, error: NOT_READABLE }
    }
    const release = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    const tag = release.tag_name
    if (typeof tag !== 'string' || tag.length > 64 || !isVersion(tag)) {
      return { ok: false, error: NOT_READABLE }
    }
    return { ok: true, latest: tag.trim(), releaseUrl: releasePage(options.repository, release.html_url) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The page "Download" opens. GitHub's link is used only when it is a release
 * page of this repository; anything else falls back to one built here, so an
 * answer can never send the user somewhere else.
 */
export function releasePage(repository: string, htmlUrl: unknown): string {
  const prefix = `https://github.com/${repository}/releases/`
  if (typeof htmlUrl === 'string' && htmlUrl.length <= 300 && htmlUrl.startsWith(prefix)) {
    try {
      const parsed = new URL(htmlUrl)
      if (parsed.origin === 'https://github.com' && !parsed.username && !parsed.password) {
        return parsed.toString()
      }
    } catch {
      // Not a URL after all; the built one is used.
    }
  }
  return `${prefix}latest`
}

export interface UpdateCheckerOptions {
  fetch: UpdateFetch
  repository: string
  currentVersion: string
  /** Whether the daily check is on; read afresh each time. */
  enabled(): boolean
  /** When the last check finished, as stored; null if never. */
  lastCheckedAt(): string | null
  saveLastCheckedAt(iso: string): void
  /** Every change of status, for the window and the tray. */
  onStatus(status: UpdateStatus): void
  now?: () => number
}

export class UpdateChecker {
  private status: UpdateStatus
  private releaseUrl: string | null = null
  private inFlight: Promise<UpdateStatus> | null = null
  private firstTimer: NodeJS.Timeout | null = null
  private enableTimer: NodeJS.Timeout | null = null
  private tick: NodeJS.Timeout | null = null

  constructor(private readonly options: UpdateCheckerOptions) {
    this.status = {
      enabled: options.enabled(),
      state: 'idle',
      current: options.currentVersion,
      latest: null,
      checkedAt: options.lastCheckedAt(),
      error: null
    }
  }

  getStatus(): UpdateStatus {
    return { ...this.status, enabled: this.options.enabled() }
  }

  /** The release page to open, while an update is on offer; otherwise null. */
  downloadPage(): string | null {
    return this.status.state === 'available' ? this.releaseUrl : null
  }

  /**
   * Begins the daily schedule. Nothing is sent now: the first look is a
   * minute after startup, and only if the check is on and a day has passed.
   */
  start(): void {
    this.stop()
    this.firstTimer = setTimeout(() => {
      this.firstTimer = null
      void this.checkIfDue()
      this.tick = setInterval(() => void this.checkIfDue(), DUE_CHECK_TICK_MS)
    }, FIRST_CHECK_DELAY_MS)
  }

  stop(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer)
    if (this.enableTimer) clearTimeout(this.enableTimer)
    if (this.tick) clearInterval(this.tick)
    this.firstTimer = null
    this.enableTimer = null
    this.tick = null
  }

  /** The switch was flipped. Switched on, a due check follows a minute later. */
  enabledChanged(): void {
    if (this.enableTimer) clearTimeout(this.enableTimer)
    this.enableTimer = null
    if (this.options.enabled()) {
      this.enableTimer = setTimeout(() => {
        this.enableTimer = null
        void this.checkIfDue()
      }, FIRST_CHECK_DELAY_MS)
    }
    this.publish()
  }

  /** "Check now": asked for by name, so it runs whether or not the switch is on. */
  checkNow(): Promise<UpdateStatus> {
    return this.check()
  }

  /** The daily check: only when switched on, and only once a day has passed. */
  async checkIfDue(): Promise<void> {
    if (!this.options.enabled()) return
    const last = Date.parse(this.options.lastCheckedAt() ?? '')
    const since = this.now() - last
    // A clock set back makes `since` negative; that is not a recent check.
    if (Number.isFinite(since) && since >= 0 && since < CHECK_INTERVAL_MS) return
    await this.check()
  }

  private check(): Promise<UpdateStatus> {
    // Two presses, or a press during the daily check, send one request.
    if (this.inFlight) return this.inFlight
    this.status = { ...this.status, state: 'checking', error: null }
    this.publish()
    this.inFlight = fetchLatestRelease({
      fetch: this.options.fetch,
      repository: this.options.repository,
      currentVersion: this.options.currentVersion
    })
      // Only a bug could throw here; it must not leave the window on "Checking…".
      .catch((): CheckResult => ({ ok: false, error: NOT_READABLE }))
      .then((result) => {
        const checkedAt = new Date(this.now()).toISOString()
        this.options.saveLastCheckedAt(checkedAt)
        if (result.ok) {
          const newer = compareVersions(result.latest, this.options.currentVersion) > 0
          this.releaseUrl = newer ? result.releaseUrl : null
          this.status = {
            ...this.status,
            state: newer ? 'available' : 'latest',
            latest: result.latest,
            checkedAt,
            error: null
          }
        } else {
          this.releaseUrl = null
          this.status = { ...this.status, state: 'error', checkedAt, error: result.error }
        }
        this.publish()
        return this.getStatus()
      })
      .finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }

  private publish(): void {
    this.options.onStatus(this.getStatus())
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}
