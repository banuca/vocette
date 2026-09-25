import { describe, expect, it } from 'vitest'
import { setupIsBlocking, setupSteps, type SetupInput } from '../src/renderer/setup-guide'
import {
  available,
  needsPermission,
  unavailable,
  type CapabilityMap
} from '../src/shared/capabilities'

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

const NEEDS_KEY = 'Add your API key in Settings before recording.'
const NEEDS_MODEL = 'Download the speech model in Settings first.'

const input = (overrides: Partial<SetupInput> = {}): SetupInput => ({
  ready: true,
  notReadyReason: null,
  capabilities: capabilities(),
  microphone: 'granted',
  ...overrides
})

/** Transcription not set up, for the reason given. */
const notReady = (reason: string | null = NEEDS_KEY): Partial<SetupInput> => ({
  ready: false,
  notReadyReason: reason
})

const ids = (value: SetupInput): string[] => setupSteps(value).map((step) => step.id)

describe('setupSteps', () => {
  it('says nothing at all once everything is in place', () => {
    expect(setupSteps(input())).toEqual([])
  })

  it('asks for what transcription is missing first, and treats it as blocking', () => {
    const steps = setupSteps(input(notReady(NEEDS_KEY)))
    expect(steps[0]?.id).toBe('transcription')
    expect(steps[0]?.detail).toBe(NEEDS_KEY)
    expect(steps[0]?.action).toEqual({ kind: 'navigate-settings', label: 'Open Settings' })
    expect(setupIsBlocking(steps)).toBe(true)
  })

  it('names the speech model when that is what is missing', () => {
    // The on-device engine needs no key, so the step must not ask for one.
    const steps = setupSteps(input(notReady(NEEDS_MODEL)))
    expect(steps[0]?.detail).toBe(NEEDS_MODEL)
    expect(steps[0]?.detail).not.toMatch(/API key/iu)
  })

  it('still explains itself if not-ready arrives without a reason', () => {
    expect(setupSteps(input(notReady(null)))[0]?.detail).toBe('Transcription is not set up yet.')
  })

  it('clears once transcription is ready, however it became so', () => {
    expect(ids(input({ ready: true, notReadyReason: null }))).not.toContain('transcription')
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

  it('warns that a key cannot be saved, but only while transcription is not set up', () => {
    const unusable = capabilities({ secureKeyStorage: unavailable('No keyring here.') })
    expect(ids(input({ ...notReady(NEEDS_KEY), capabilities: unusable }))).toContain(
      'secure-storage'
    )
    // A session key in use makes the cloud engine ready: the user has seen
    // and answered this already.
    expect(ids(input({ ready: true, capabilities: unusable }))).not.toContain('secure-storage')
  })

  it('lists several outstanding items in the order they have to be dealt with', () => {
    expect(
      ids(
        input({
          ...notReady(NEEDS_KEY),
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
