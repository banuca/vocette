import { describe, expect, it } from 'vitest'
import {
  setupHeading,
  setupIsBlocking,
  setupSteps,
  type SetupInput
} from '../src/renderer/setup-guide'
import {
  available,
  needsPermission,
  unavailable,
  type CapabilityMap
} from '../src/shared/capabilities'
import {
  KEY_NOT_READY_REASON,
  MODEL_NOT_READY_REASON,
  type EngineStatus,
  type ModelState
} from '../src/shared/engine'

/**
 * The guidance is only useful if it clears itself. Every case here is about
 * something appearing exactly when it applies, and disappearing the moment it
 * does not — no dismissal, no nagging about a permission already granted.
 */
function capabilities(overrides: Partial<CapabilityMap> = {}): CapabilityMap {
  return {
    globalHold: available(),
    globalToggle: available(),
    targetVerification: available(),
    autoPaste: available(),
    launchAtLogin: available(),
    secureKeyStorage: available(),
    ...overrides
  }
}

const TOTAL = 670_478_772

/** The on-device engine, with its model in the state given. */
function onThisPc(state: ModelState = 'installed'): EngineStatus {
  const ready = state === 'installed'
  return {
    engine: 'local',
    model: {
      id: 'parakeet-tdt-0.6b-v3-int8',
      state,
      receivedBytes: ready ? TOTAL : 0,
      totalBytes: TOTAL,
      error: null
    },
    ready,
    notReadyReason: ready ? null : MODEL_NOT_READY_REASON
  }
}

/** A cloud provider, with or without a key in use. The model is irrelevant to it. */
function inTheCloud(
  hasKey: boolean,
  reason: string | null = hasKey ? null : KEY_NOT_READY_REASON
): EngineStatus {
  return {
    engine: 'cloud',
    model: onThisPc('missing').model,
    ready: hasKey,
    notReadyReason: reason
  }
}

const input = (overrides: Partial<SetupInput> = {}): SetupInput => ({
  engine: onThisPc('installed'),
  capabilities: capabilities(),
  microphone: 'granted',
  ...overrides
})

const ids = (value: SetupInput): string[] => setupSteps(value).map((step) => step.id)

describe('setupSteps', () => {
  it('says nothing at all once everything is in place, on either engine', () => {
    expect(setupSteps(input())).toEqual([])
    expect(setupSteps(input({ engine: inTheCloud(true) }))).toEqual([])
  })

  it('asks for the speech model first when this PC has none, and treats it as blocking', () => {
    const steps = setupSteps(input({ engine: onThisPc('missing') }))
    expect(steps[0]).toEqual({
      id: 'model',
      title: 'Download the speech model',
      detail:
        'Murmur transcribes on this PC, so your voice never leaves it. The model is 670 MB ' +
        'and downloads once.',
      // The download happens on the step itself, not somewhere it points to.
      action: null,
      blocking: true
    })
    expect(setupIsBlocking(steps)).toBe(true)
  })

  it('keeps the model step for every state short of installed', () => {
    for (const state of ['missing', 'partial', 'downloading', 'verifying', 'failed'] as const) {
      expect(ids(input({ engine: onThisPc(state) }))).toEqual(['model'])
    }
    expect(ids(input({ engine: onThisPc('installed') }))).toEqual([])
  })

  it('never asks the on-device engine for an API key', () => {
    const steps = setupSteps(
      input({
        engine: onThisPc('missing'),
        capabilities: capabilities({ secureKeyStorage: unavailable('No keyring here.') })
      })
    )
    expect(steps.map((step) => step.id)).toEqual(['model'])
    expect(steps[0]?.detail).not.toMatch(/API key/iu)
  })

  it('asks a cloud user without a key for one, through Settings', () => {
    const steps = setupSteps(input({ engine: inTheCloud(false) }))
    expect(steps[0]).toMatchObject({
      id: 'transcription',
      detail: KEY_NOT_READY_REASON,
      action: { kind: 'navigate-settings', label: 'Open Settings' },
      blocking: true
    })
    // The cloud has no use for the model, however it stands on disk.
    expect(steps.map((step) => step.id)).not.toContain('model')
  })

  it('still explains itself if not-ready arrives without a reason', () => {
    expect(setupSteps(input({ engine: inTheCloud(false, null) }))[0]?.detail).toBe(
      'Transcription is not set up yet.'
    )
  })

  it('raises a blocked microphone, with the pane that unblocks it', () => {
    const steps = setupSteps(input({ microphone: 'denied' }))
    expect(steps.map((step) => step.id)).toContain('microphone')
    expect(steps.find((step) => step.id === 'microphone')?.action).toEqual({
      kind: 'open-pane',
      pane: 'microphone',
      label: 'Open privacy settings'
    })
    expect(setupIsBlocking(steps)).toBe(true)
  })

  it('stays quiet about a microphone it cannot ask about', () => {
    expect(ids(input({ microphone: 'unknown' }))).not.toContain('microphone')
  })

  it('offers to open a permission pane, carrying the reason through verbatim', () => {
    const steps = setupSteps(
      input({
        capabilities: capabilities({
          globalHold: needsPermission('Grant Input Monitoring.', 'input-monitoring')
        })
      })
    )
    const step = steps.find((entry) => entry.id === 'input-monitoring')
    expect(step?.detail).toBe('Grant Input Monitoring.')
    expect(step?.action).toMatchObject({ kind: 'open-pane', pane: 'input-monitoring' })
    // A permission is worth guiding towards, but nothing is blocked by it:
    // recording from the window still works.
    expect(step?.blocking).toBe(false)
  })

  it('asks about the paste permission separately from the shortcut one', () => {
    const steps = setupSteps(
      input({
        capabilities: capabilities({
          autoPaste: needsPermission('Grant Accessibility.', 'accessibility')
        })
      })
    )
    expect(steps.map((step) => step.id)).toEqual(['accessibility'])
  })

  it('says nothing about a capability the desktop simply does not have', () => {
    // Wayland cannot watch the keyboard. That is a fact about the session, not
    // a step the user can take, and guidance that cannot be acted on is noise.
    const steps = setupSteps(
      input({
        capabilities: capabilities({
          globalHold: unavailable('Wayland cannot watch the keyboard.'),
          autoPaste: unavailable('Wayland will not let us type.')
        })
      })
    )
    expect(steps).toEqual([])
  })

  it('warns that a key cannot be saved, but only while a cloud user has none', () => {
    const unusable = capabilities({ secureKeyStorage: unavailable('No keyring here.') })
    expect(ids(input({ engine: inTheCloud(false), capabilities: unusable }))).toContain(
      'secure-storage'
    )
    // A session key in use makes the cloud engine ready: the user has seen
    // and answered this already.
    expect(ids(input({ engine: inTheCloud(true), capabilities: unusable }))).not.toContain(
      'secure-storage'
    )
    expect(ids(input({ engine: onThisPc('missing'), capabilities: unusable }))).not.toContain(
      'secure-storage'
    )
  })

  it('lists several outstanding items in the order they have to be dealt with', () => {
    expect(
      ids(
        input({
          engine: inTheCloud(false),
          microphone: 'denied',
          capabilities: capabilities({
            globalToggle: needsPermission('Grant Input Monitoring.', 'input-monitoring'),
            autoPaste: needsPermission('Grant Accessibility.', 'accessibility'),
            secureKeyStorage: unavailable('No keyring here.')
          })
        })
      )
    ).toEqual([
      'transcription',
      'microphone',
      'input-monitoring',
      'accessibility',
      'secure-storage'
    ])
    expect(
      ids(input({ engine: onThisPc('missing'), microphone: 'denied' }))
    ).toEqual(['model', 'microphone'])
  })

  it('reports nothing blocking when only permissions are outstanding', () => {
    const steps = setupSteps(
      input({
        capabilities: capabilities({
          globalToggle: needsPermission('Grant Input Monitoring.', 'input-monitoring')
        })
      })
    )
    expect(setupIsBlocking(steps)).toBe(false)
  })
})

describe('setupHeading', () => {
  it('says Get started until transcription works at all', () => {
    expect(setupHeading(setupSteps(input({ engine: onThisPc('missing') })))).toBe('Get started')
    expect(setupHeading(setupSteps(input({ engine: inTheCloud(false) })))).toBe('Get started')
  })

  it('says it is finishing off when only a permission is left', () => {
    const steps = setupSteps(
      input({
        capabilities: capabilities({
          autoPaste: needsPermission('Grant Accessibility.', 'accessibility')
        })
      })
    )
    expect(setupHeading(steps)).toBe('Finish setting up Murmur')
  })
})
