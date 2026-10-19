import { describe, expect, it } from 'vitest'
import { REPORT_EVENTS, formatDiagnostics, type DiagnosticsFacts } from '../src/main/diagnostics-report'
import type { LoggedEvent } from '../src/main/diagnostics-log'

const FACTS: DiagnosticsFacts = {
  version: '0.8.0',
  os: 'Windows 10.0.26100',
  arch: 'x64',
  memoryGb: 16,
  engine: 'local',
  modelState: 'installed',
  shortcut: 'Left Ctrl + Left Shift',
  mode: 'hold',
  autoPaste: true,
  instantCapture: true,
  restoreClipboard: true,
  language: 'en',
  plan: 'trial',
  limits: [],
  events: []
}

describe('formatDiagnostics', () => {
  it('opens with the install and settings, in plain lines', () => {
    expect(formatDiagnostics(FACTS).split('\n').slice(0, 5)).toEqual([
      'Vocette 0.8.0 · Windows 10.0.26100 · x64 · 16 GB',
      'Engine: on this PC · model installed',
      'Shortcut: Left Ctrl + Left Shift · hold',
      'Auto-paste on · instant capture on · restore clipboard on · language en',
      'Plan: trial'
    ])
    expect(formatDiagnostics(FACTS)).toContain('No events recorded yet')
  })

  it('describes each kind of event, grouped by day', () => {
    const events: LoggedEvent[] = [
      { kind: 'startup', readyMs: 1800, at: '2026-10-19T09:14:02.000Z' },
      { kind: 'take', outcome: 'pasted', engine: 'local', recordMs: 4100, transcribeMs: 460, words: 23, at: '2026-10-19T09:15:40.000Z' },
      { kind: 'paste-declined', reason: 'focus-moved', at: '2026-10-19T09:21:07.000Z' },
      { kind: 'mic-error', name: 'NotFoundError', at: '2026-10-20T09:30:55.000Z' },
      { kind: 'take', outcome: 'failed', engine: 'local', message: 'The microphone could not be started.', at: '2026-10-20T09:31:20.000Z' },
      { kind: 'engine-exit', code: 3221225477, busy: true, at: '2026-10-20T10:02:13.000Z' },
      { kind: 'crash', where: 'window', reason: 'crashed (1)', at: '2026-10-20T10:05:00.000Z' }
    ]
    const report = formatDiagnostics({ ...FACTS, events })
    expect(report.split('\n').slice(6)).toEqual([
      'Last 7 events (UTC)',
      '  2026-10-19',
      '  09:14:02 startup      ready in 1.8 s',
      '  09:15:40 take         pasted · local · 4.1 s spoken · 0.46 s wait · 23 words',
      '  09:21:07 paste        declined · focus-moved',
      '  2026-10-20',
      '  09:30:55 mic-error    NotFoundError',
      '  09:31:20 take         failed · local · "The microphone could not be started."',
      '  10:02:13 engine-exit  code 3221225477 · while busy',
      '  10:05:00 crash        window · crashed (1)'
    ])
  })

  it('lists what this platform cannot do, and only the last 50 events', () => {
    const events: LoggedEvent[] = Array.from({ length: 80 }, (_, index) => ({
      kind: 'startup',
      readyMs: index,
      at: '2026-10-19T09:00:00.000Z'
    }))
    const report = formatDiagnostics({
      ...FACTS,
      limits: [{ name: 'autoPaste', state: 'unavailable', reason: 'Wayland blocks synthetic key presses.' }],
      events
    })
    expect(report).toContain('  autoPaste: unavailable · Wayland blocks synthetic key presses.')
    expect(report).toContain(`Last ${REPORT_EVENTS} events (UTC)`)
    expect(report.match(/startup/gu)).toHaveLength(REPORT_EVENTS)
  })
})
