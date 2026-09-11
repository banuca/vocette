import { describe, expect, it } from 'vitest'
import { createRecordingControl, recordingControlState } from '../src/renderer/recording-control'
import { available, unavailable, type PlatformStatus } from '../src/shared/capabilities'
import type { ApiKeySource, WorkflowStatus } from '../src/shared/types'

/**
 * The window control is the entry point that always works, whatever the
 * desktop will or will not allow. These cases are the promises it makes.
 */
function platform(overrides: Partial<PlatformStatus['capabilities']> = {}): PlatformStatus {
  return {
    platform: 'windows',
    session: null,
    pasteLabel: 'Ctrl + V',
    primaryModifierLabel: 'Ctrl',
    capabilities: {
      globalHold: available(),
      globalToggle: available(),
      targetVerification: available(),
      autoPaste: available(),
      launchAtLogin: available(),
      secureKeyStorage: available(),
      ...overrides
    }
  }
}

const state = (
  status: WorkflowStatus,
  options: { apiKeySource?: ApiKeySource; platform?: PlatformStatus } = {}
) =>
  recordingControlState({
    status,
    platform: options.platform ?? platform(),
    apiKeySource: options.apiKeySource ?? 'stored'
  })

describe('recordingControlState', () => {
  it('offers Record when idle and set up', () => {
    const result = state({ phase: 'idle', message: 'Ready' })
    expect(result).toMatchObject({
      primaryLabel: 'Record',
      primaryEnabled: true,
      primaryAction: 'start',
      cancelVisible: false,
      phaseLabel: 'Ready',
      tone: 'idle'
    })
  })

  it('will not start without a key, and says what is missing', () => {
    const result = state({ phase: 'idle', message: 'Ready' }, { apiKeySource: 'none' })
    expect(result.primaryEnabled).toBe(false)
    expect(result.primaryAction).toBeNull()
    expect(result.hint).toBe('Add your API key in Settings before recording.')
    // Not "Ready": as the heading over the record button, that would contradict
    // the hint immediately beneath it.
    expect(result.phaseLabel).toBe('Not set up yet')
  })

  it('accepts a session key as being set up', () => {
    expect(state({ phase: 'idle', message: 'Ready' }, { apiKeySource: 'session' }).primaryEnabled).toBe(
      true
    )
  })

  it('turns into Stop, with Cancel available, while recording', () => {
    for (const phase of ['starting', 'recording'] as const) {
      const result = state({ phase, message: 'Listening…' })
      expect(result.primaryLabel).toBe('Stop')
      expect(result.primaryAction).toBe('stop')
      expect(result.cancelVisible).toBe(true)
      expect(result.tone).toBe(phase)
    }
  })

  it('says up front that a window recording goes to the clipboard', () => {
    expect(state({ phase: 'recording', message: 'Listening…' }).hint).toBe(
      'This recording goes to your clipboard.'
    )
  })

  it('keeps Cancel available while transcribing, when nothing else can be pressed', () => {
    const result = state({ phase: 'processing', message: 'Transcribing…' })
    expect(result.primaryEnabled).toBe(false)
    expect(result.primaryAction).toBeNull()
    expect(result.cancelVisible).toBe(true)
  })

  it('shows the outcome of the last take before returning to Record', () => {
    const result = state({ phase: 'success', message: 'Copied and pasted' })
    expect(result).toMatchObject({
      primaryLabel: 'Record',
      primaryAction: 'start',
      phaseLabel: 'Copied and pasted',
      tone: 'success'
    })
    expect(state({ phase: 'cancelled', message: 'Dictation cancelled' }).tone).toBe('cancelled')
    expect(state({ phase: 'error', message: 'Dictation failed' }).tone).toBe('error')
  })

  it('explains that this desktop has no global shortcut at all', () => {
    const result = state(
      { phase: 'idle', message: 'Ready' },
      {
        platform: platform({
          globalHold: unavailable('Wayland cannot watch the keyboard.'),
          globalToggle: unavailable('No shortcut could be registered.')
        })
      }
    )
    expect(result.hint).toBe('No system-wide shortcut on this desktop — use Record.')
    // Recording itself is still offered: that is the whole point of the button.
    expect(result.primaryEnabled).toBe(true)
  })

  it('explains clipboard-only delivery where pasting is impossible', () => {
    const result = state(
      { phase: 'idle', message: 'Ready' },
      {
        platform: platform({
          targetVerification: unavailable('Wayland hides the focused window.'),
          autoPaste: unavailable('Wayland will not let us type.')
        })
      }
    )
    expect(result.hint).toBe('Transcripts are copied here, not pasted. Settings explains why.')
  })

  it('has nothing to add when everything works', () => {
    expect(state({ phase: 'idle', message: 'Ready' }).hint).toBeNull()
  })

  it('puts the missing key ahead of any platform limitation', () => {
    const result = state(
      { phase: 'idle', message: 'Ready' },
      {
        apiKeySource: 'none',
        platform: platform({ autoPaste: unavailable('Cannot type here.') })
      }
    )
    expect(result.hint).toBe('Add your API key in Settings before recording.')
  })
})

describe('createRecordingControl', () => {
  /** Just enough of an element for the control to render and be clicked. */
  class FakeElement {
    innerHTML = ''
    textContent: string | null = ''
    hidden = false
    disabled = false
    className = ''
    title = ''
    readonly attributes = new Map<string, string>()
    private readonly listeners: Array<() => void> = []

    constructor(readonly id: string) {}

    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value)
    }

    addEventListener(_type: string, listener: () => void): void {
      this.listeners.push(listener)
    }

    click(): void {
      this.listeners.forEach((listener) => listener())
    }
  }

  function makeHost() {
    const elements = new Map<string, FakeElement>([
      ['#record-primary', new FakeElement('record-primary')],
      ['#record-icon', new FakeElement('record-icon')],
      ['#record-label', new FakeElement('record-label')],
      ['#record-cancel', new FakeElement('record-cancel')],
      ['#record-phase', new FakeElement('record-phase')],
      ['#record-hint', new FakeElement('record-hint')]
    ])
    const host = {
      innerHTML: '',
      querySelector: (selector: string) => elements.get(selector) ?? null
    } as unknown as HTMLElement
    return { host, elements }
  }

  function makeBridge(overrides: Partial<Record<'start' | 'stop' | 'cancel', () => Promise<void>>> = {}) {
    const calls: string[] = []
    return {
      calls,
      bridge: {
        startRecording: overrides.start ?? (async () => void calls.push('start')),
        stopRecording: overrides.stop ?? (async () => void calls.push('stop')),
        cancelRecording: overrides.cancel ?? (async () => void calls.push('cancel'))
      }
    }
  }

  const recording: WorkflowStatus = { phase: 'recording', message: 'Listening…' }
  const idle: WorkflowStatus = { phase: 'idle', message: 'Ready' }

  it('sends each button to its own command', () => {
    const { host, elements } = makeHost()
    const { calls, bridge } = makeBridge()
    const view = createRecordingControl(host, bridge)

    view.apply({ status: idle, platform: platform(), apiKeySource: 'stored' })
    elements.get('#record-primary')?.click()
    expect(calls).toEqual(['start'])

    view.apply({ status: recording, platform: platform(), apiKeySource: 'stored' })
    elements.get('#record-primary')?.click()
    elements.get('#record-cancel')?.click()
    expect(calls).toEqual(['start', 'stop', 'cancel'])
  })

  it('does nothing when the primary button has no action', () => {
    const { host, elements } = makeHost()
    const { calls, bridge } = makeBridge()
    const view = createRecordingControl(host, bridge)
    view.apply({ status: idle, platform: platform(), apiKeySource: 'none' })
    elements.get('#record-primary')?.click()
    expect(calls).toEqual([])
  })

  it('shows a command that failed instead of swallowing it', async () => {
    // A button that does nothing and says nothing is indistinguishable from a
    // missed click, which is the worst thing it could be halfway through a
    // dictation.
    const { host, elements } = makeHost()
    const { bridge } = makeBridge({
      cancel: () => Promise.reject(new Error('Forbidden.'))
    })
    const view = createRecordingControl(host, bridge)
    view.apply({ status: recording, platform: platform(), apiKeySource: 'stored' })

    elements.get('#record-cancel')?.click()
    await Promise.resolve()
    await Promise.resolve()

    const hint = elements.get('#record-hint')
    expect(hint?.textContent).toBe('Forbidden.')
    expect(hint?.hidden).toBe(false)
  })

  it('clears a failure once something real happens', async () => {
    const { host, elements } = makeHost()
    const { bridge } = makeBridge({ cancel: () => Promise.reject(new Error('Forbidden.')) })
    const view = createRecordingControl(host, bridge)
    view.apply({ status: recording, platform: platform(), apiKeySource: 'stored' })
    elements.get('#record-cancel')?.click()
    await Promise.resolve()
    await Promise.resolve()

    view.apply({ status: idle, platform: platform(), apiKeySource: 'stored' })
    expect(elements.get('#record-hint')?.textContent).toBe('')
  })

  it('hides Cancel unless there is something to cancel', () => {
    const { host, elements } = makeHost()
    const { bridge } = makeBridge()
    const view = createRecordingControl(host, bridge)

    view.apply({ status: idle, platform: platform(), apiKeySource: 'stored' })
    expect(elements.get('#record-cancel')?.hidden).toBe(true)

    view.apply({ status: recording, platform: platform(), apiKeySource: 'stored' })
    expect(elements.get('#record-cancel')?.hidden).toBe(false)
  })
})
