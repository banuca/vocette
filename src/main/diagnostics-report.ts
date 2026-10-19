import type { LoggedEvent } from './diagnostics-log'

/**
 * The text "Copy diagnostics" puts on the clipboard: facts about this install
 * and the last events, for the user to paste into an email. Every line is
 * built from typed facts; nothing the user said, typed or named is an input.
 */

export interface DiagnosticsFacts {
  version: string
  os: string
  arch: string
  memoryGb: number
  engine: 'local' | 'cloud'
  modelState: string
  shortcut: string
  mode: string
  autoPaste: boolean
  instantCapture: boolean
  restoreClipboard: boolean
  language: string
  plan: string
  /** Capabilities that are not available here, with the app's reason. */
  limits: Array<{ name: string; state: string; reason: string }>
  events: LoggedEvent[]
}

export const REPORT_EVENTS = 50

const onOff = (value: boolean): string => (value ? 'on' : 'off')

/** "09:15:40" in UTC, so a report reads the same wherever it is opened. */
function time(iso: string): string {
  return iso.slice(11, 19)
}

function day(iso: string): string {
  return iso.slice(0, 10)
}

export function describeEvent(event: LoggedEvent): string {
  switch (event.kind) {
    case 'startup':
      return `startup      ready in ${(event.readyMs / 1000).toFixed(1)} s`
    case 'take': {
      const parts: string[] = [event.outcome, event.engine]
      if (event.recordMs !== undefined) parts.push(`${(event.recordMs / 1000).toFixed(1)} s spoken`)
      if (event.transcribeMs !== undefined) parts.push(`${(event.transcribeMs / 1000).toFixed(2)} s wait`)
      if (event.words !== undefined) parts.push(`${event.words} words`)
      if (event.message) parts.push(`"${event.message}"`)
      return `take         ${parts.join(' · ')}`
    }
    case 'paste-declined':
      return `paste        declined · ${event.reason}`
    case 'mic-error':
      return `mic-error    ${event.name}`
    case 'engine-exit':
      return `engine-exit  code ${event.code ?? 'unknown'} · ${event.busy ? 'while busy' : 'while idle'}`
    case 'crash':
      return `crash        ${event.where} · ${event.reason}`
  }
}

export function formatDiagnostics(facts: DiagnosticsFacts): string {
  const lines = [
    `Vocette ${facts.version} · ${facts.os} · ${facts.arch} · ${facts.memoryGb} GB`,
    `Engine: ${facts.engine === 'local' ? 'on this PC' : 'cloud'} · model ${facts.modelState}`,
    `Shortcut: ${facts.shortcut} · ${facts.mode}`,
    `Auto-paste ${onOff(facts.autoPaste)} · instant capture ${onOff(facts.instantCapture)} · ` +
      `restore clipboard ${onOff(facts.restoreClipboard)} · language ${facts.language}`,
    `Plan: ${facts.plan}`
  ]
  if (facts.limits.length > 0) {
    lines.push('', 'Not available here')
    for (const limit of facts.limits) lines.push(`  ${limit.name}: ${limit.state}${limit.reason ? ` · ${limit.reason}` : ''}`)
  }
  const events = facts.events.slice(-REPORT_EVENTS)
  lines.push('', events.length > 0 ? `Last ${events.length} events (UTC)` : 'No events recorded yet')
  let lastDay = ''
  for (const event of events) {
    if (day(event.at) !== lastDay) {
      lastDay = day(event.at)
      lines.push(`  ${lastDay}`)
    }
    lines.push(`  ${time(event.at)} ${describeEvent(event)}`)
  }
  return lines.join('\n')
}
