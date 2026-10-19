import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DiagnosticsLog, MAX_EVENTS, cleanEvent } from '../src/main/diagnostics-log'

let file: string
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'vocette-diag-')), 'diagnostics.json')
})

const at = (): Date => new Date('2026-10-19T09:15:40Z')

describe('cleanEvent', () => {
  it('keeps only the fields an event has', () => {
    expect(
      cleanEvent({
        kind: 'take',
        outcome: 'pasted',
        engine: 'local',
        recordMs: 4100.4,
        transcribeMs: 512,
        words: 23,
        text: 'Remind me to send the invoice on Friday.',
        vocabulary: 'Polar',
        window: 'Invoices - Outlook'
      })
    ).toEqual({ kind: 'take', outcome: 'pasted', engine: 'local', recordMs: 4100, transcribeMs: 512, words: 23 })
  })

  it('refuses what is not an event, and cuts long messages', () => {
    expect(cleanEvent({ kind: 'transcript', text: 'hello' })).toBeNull()
    expect(cleanEvent({ kind: 'take', outcome: 'maybe', engine: 'local' })).toBeNull()
    expect(cleanEvent({ kind: 'paste-declined', reason: 'Outlook' })).toBeNull()
    const take = cleanEvent({ kind: 'take', outcome: 'failed', engine: 'cloud', message: 'x'.repeat(500) })
    expect(take && 'message' in take ? take.message?.length : 0).toBe(200)
  })

  it('keeps a microphone error name but never a device label', () => {
    expect(cleanEvent({ kind: 'mic-error', name: 'NotFoundError' })).toEqual({ kind: 'mic-error', name: 'NotFoundError' })
    expect(cleanEvent({ kind: 'mic-error', name: 'Headset (Jabra Evolve2 65)' })).toEqual({
      kind: 'mic-error',
      name: 'Unknown'
    })
  })
})

describe('DiagnosticsLog', () => {
  it('records, survives a restart, and keeps only the newest 500', async () => {
    const log = new DiagnosticsLog(file, at)
    for (let index = 0; index < MAX_EVENTS + 20; index += 1) log.record({ kind: 'startup', readyMs: index })
    await log.flush()
    const again = new DiagnosticsLog(file, at)
    const events = again.recent()
    expect(events).toHaveLength(MAX_EVENTS)
    expect(events[0]).toEqual({ kind: 'startup', readyMs: 20, at: '2026-10-19T09:15:40.000Z' })
    expect(again.recent(2).map((event) => (event as { readyMs: number }).readyMs)).toEqual([518, 519])
  })

  it("can't be made to hold a dictation's text", async () => {
    const log = new DiagnosticsLog(file, at)
    log.record({
      kind: 'take',
      outcome: 'pasted',
      engine: 'local',
      words: 8,
      ...({ text: 'Remind me to send the invoice on Friday.' } as object)
    } as never)
    await log.flush()
    expect(readFileSync(file, 'utf8')).not.toContain('invoice')
  })

  it('drops damaged or foreign entries when it loads', () => {
    writeFileSync(
      file,
      JSON.stringify([
        { kind: 'startup', readyMs: 900, at: '2026-10-19T09:00:00Z' },
        { kind: 'transcript', text: 'secret', at: '2026-10-19T09:00:01Z' },
        { kind: 'startup', readyMs: 5 }
      ])
    )
    expect(new DiagnosticsLog(file, at).recent()).toEqual([
      { kind: 'startup', readyMs: 900, at: '2026-10-19T09:00:00Z' }
    ])
  })

  it('writes at once when a crash asks it to', () => {
    const log = new DiagnosticsLog(file, at)
    log.record({ kind: 'crash', where: 'main', reason: 'TypeError: x is undefined' })
    log.flushSync()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1)
  })
})
