import { readJsonWithBackup, writeJsonAtomic, writeJsonAtomicAsync } from './atomic-json'

/**
 * A short record of what went wrong, kept on this PC so that someone can copy
 * it into an email (S1). Nothing here is ever sent anywhere by Vocette.
 *
 * Privacy is by construction: events are typed records with fixed fields,
 * every string is checked or cut, and nothing that could carry what was said
 * (the text, the vocabulary, a window title, a key, an endpoint, a microphone
 * name) has a field to go in. The only free text is Vocette's own error
 * sentences, cut to 200 characters.
 */

export type TakeOutcome = 'pasted' | 'copied' | 'failed' | 'cancelled' | 'empty'
export type PasteDeclined = 'not-verified' | 'focus-moved' | 'elevated' | 'keys-held' | 'blocked'
export type CrashWhere = 'main' | 'window' | 'worker' | 'gpu' | 'other'

export type DiagnosticEvent =
  | { kind: 'startup'; readyMs: number }
  | {
      kind: 'take'
      outcome: TakeOutcome
      engine: 'local' | 'cloud'
      recordMs?: number
      transcribeMs?: number
      words?: number
      message?: string
    }
  | { kind: 'paste-declined'; reason: PasteDeclined }
  | { kind: 'mic-error'; name: string }
  | { kind: 'engine-exit'; code: number | null; busy: boolean }
  | { kind: 'crash'; where: CrashWhere; reason: string }

export type LoggedEvent = DiagnosticEvent & { at: string }

export const MAX_EVENTS = 500
export const MAX_MESSAGE_CHARS = 200
const WRITE_DELAY_MS = 1000

const OUTCOMES = new Set<TakeOutcome>(['pasted', 'copied', 'failed', 'cancelled', 'empty'])
const DECLINED = new Set<PasteDeclined>(['not-verified', 'focus-moved', 'elevated', 'keys-held', 'blocked'])
const WHERE = new Set<CrashWhere>(['main', 'window', 'worker', 'gpu', 'other'])

const cut = (text: unknown, max = MAX_MESSAGE_CHARS): string =>
  typeof text === 'string' ? text.replace(/\s+/gu, ' ').trim().slice(0, max) : ''
const ms = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined

/** The event with only its own fields, each checked; null when it is not one. */
export function cleanEvent(input: unknown): DiagnosticEvent | null {
  if (typeof input !== 'object' || input === null) return null
  const event = input as Record<string, unknown>
  switch (event.kind) {
    case 'startup': {
      const readyMs = ms(event.readyMs)
      return readyMs === undefined ? null : { kind: 'startup', readyMs }
    }
    case 'take': {
      if (!OUTCOMES.has(event.outcome as TakeOutcome)) return null
      if (event.engine !== 'local' && event.engine !== 'cloud') return null
      const take: DiagnosticEvent = { kind: 'take', outcome: event.outcome as TakeOutcome, engine: event.engine }
      const recordMs = ms(event.recordMs)
      const transcribeMs = ms(event.transcribeMs)
      const words = ms(event.words)
      const message = cut(event.message)
      if (recordMs !== undefined) take.recordMs = recordMs
      if (transcribeMs !== undefined) take.transcribeMs = transcribeMs
      if (words !== undefined) take.words = words
      if (message) take.message = message
      return take
    }
    case 'paste-declined':
      return DECLINED.has(event.reason as PasteDeclined)
        ? { kind: 'paste-declined', reason: event.reason as PasteDeclined }
        : null
    case 'mic-error': {
      // A DOMException name ("NotAllowedError"), never a device label.
      const name = typeof event.name === 'string' && /^[A-Za-z]{1,40}$/u.test(event.name) ? event.name : 'Unknown'
      return { kind: 'mic-error', name }
    }
    case 'engine-exit':
      return {
        kind: 'engine-exit',
        code: typeof event.code === 'number' && Number.isInteger(event.code) ? event.code : null,
        busy: event.busy === true
      }
    case 'crash':
      return {
        kind: 'crash',
        where: WHERE.has(event.where as CrashWhere) ? (event.where as CrashWhere) : 'other',
        reason: cut(event.reason, 120) || 'unknown'
      }
    default:
      return null
  }
}

export class DiagnosticsLog {
  private events: LoggedEvent[]
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly now: () => Date = () => new Date()
  ) {
    const stored = readJsonWithBackup<unknown>(path).value
    this.events = Array.isArray(stored)
      ? stored
          .map((item) => {
            const event = cleanEvent(item)
            const at = (item as { at?: unknown } | null)?.at
            return event && typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? { ...event, at } : null
          })
          .filter((item): item is LoggedEvent => item !== null)
          .slice(-MAX_EVENTS)
      : []
  }

  /** Adds an event; anything that isn't a valid one is dropped. Saved a second later. */
  record(input: DiagnosticEvent): void {
    const event = cleanEvent(input)
    if (!event) return
    this.events.push({ ...event, at: this.now().toISOString() })
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
    this.schedule()
  }

  /** The newest `count` events, oldest first. */
  recent(count = MAX_EVENTS): LoggedEvent[] {
    return this.events.slice(-count)
  }

  /** Writes now and waits; for quit. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.writing = this.writing.then(() => writeJsonAtomicAsync(this.path, this.events)).catch(() => undefined)
    await this.writing
  }

  /** Writes now, blocking; for a crash, when there may be no later. */
  flushSync(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      writeJsonAtomic(this.path, this.events)
    } catch {
      // A log that can't be saved must never make a crash worse.
    }
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, WRITE_DELAY_MS)
    this.timer.unref?.()
  }
}
