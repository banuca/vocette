import type { CountsReport } from '../shared/usage-counts'

/**
 * Sends the opt-in counts report (decision M), at most once a day, and only
 * while the user has it switched on. One POST of the report itself: no
 * cookies, no identifier, and a fixed User-Agent so the request says no more
 * than the report does. A failure is not retried until the next day; counts
 * are worth less than the quiet.
 */

export const COUNTS_URL = 'https://counts.vocette.com/v1/report'
export const COUNTS_TIMEOUT_MS = 10_000
/** A first send waits until startup has settled, like the update check. */
export const FIRST_SEND_DELAY_MS = 60_000
export const SEND_INTERVAL_MS = 24 * 60 * 60 * 1000
export const DUE_TICK_MS = 60 * 60 * 1000

/**
 * Where reports go. A packaged app sends to Vocette's counter; a development
 * build sends only to `MURMUR_COUNTS_URL` when it is set, and otherwise
 * nowhere, so testing never adds to the real numbers.
 */
export function countsUrl(env: Record<string, string | undefined>, packaged: boolean): string | null {
  if (packaged) return COUNTS_URL
  const override = env.MURMUR_COUNTS_URL?.trim()
  return override ? override : null
}

export type CountsFetch = (url: string, init: RequestInit) => Promise<Response>

export interface CountsSenderOptions {
  fetch: CountsFetch
  url: string | null
  /** Whether counts are on; read afresh each time. */
  enabled(): boolean
  /** The report as it stands now. */
  report(): CountsReport
  /** When a report was last attempted, as stored; null if never. */
  lastSentAt(): string | null
  saveLastSentAt(iso: string): void
  /** The minute's wait after startup or switching on; end-to-end checks shorten it. */
  firstDelayMs?: number
  now?: () => number
}

export class CountsSender {
  private inFlight: Promise<void> | null = null
  private firstTimer: NodeJS.Timeout | null = null
  private enableTimer: NodeJS.Timeout | null = null
  private tick: NodeJS.Timeout | null = null

  constructor(private readonly options: CountsSenderOptions) {}

  /** Begins the daily schedule. Nothing is sent now: the first look is a minute after startup. */
  start(): void {
    this.stop()
    this.firstTimer = setTimeout(() => {
      this.firstTimer = null
      void this.sendIfDue()
      this.tick = setInterval(() => void this.sendIfDue(), DUE_TICK_MS)
    }, this.firstDelay())
  }

  stop(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer)
    if (this.enableTimer) clearTimeout(this.enableTimer)
    if (this.tick) clearInterval(this.tick)
    this.firstTimer = null
    this.enableTimer = null
    this.tick = null
  }

  /** The switch was flipped. Switched on, a due report follows a minute later. */
  enabledChanged(): void {
    if (this.enableTimer) clearTimeout(this.enableTimer)
    this.enableTimer = null
    if (!this.options.enabled()) return
    this.enableTimer = setTimeout(() => {
      this.enableTimer = null
      void this.sendIfDue()
    }, this.firstDelay())
  }

  /** Sends only when switched on, with somewhere to send, and a day has passed. */
  sendIfDue(): Promise<void> {
    if (!this.options.enabled() || !this.options.url) return Promise.resolve()
    const since = this.now() - Date.parse(this.options.lastSentAt() ?? '')
    // A clock set back makes `since` negative; that is not a recent report.
    if (Number.isFinite(since) && since >= 0 && since < SEND_INTERVAL_MS) return Promise.resolve()
    if (this.inFlight) return this.inFlight
    this.inFlight = this.send(this.options.url).finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async send(url: string): Promise<void> {
    // Recorded before the request, so neither a failure nor a crash mid-way
    // can turn one day's report into several.
    this.options.saveLastSentAt(new Date(this.now()).toISOString())
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), COUNTS_TIMEOUT_MS)
    try {
      await this.options.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Vocette' },
        body: JSON.stringify(this.options.report()),
        credentials: 'omit',
        signal: controller.signal
      })
    } catch {
      // Offline, blocked or slow: tomorrow's report will do.
    } finally {
      clearTimeout(timer)
    }
  }

  private firstDelay(): number {
    return this.options.firstDelayMs ?? FIRST_SEND_DELAY_MS
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}
