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

const input = (overrides: Partial<SetupInput> = {}): SetupInput => ({
  apiKeySource: 'stored',
  capabilities: capabilities(),
  microphone: 'granted',
  ...overrides
})

const ids = (value: SetupInput): string[] => setupSteps(value).map((step) => step.id)

describe('setupSteps', () => {
  it('says nothing at all once everything is in place', () => {
    expect(setupSteps(input())).toEqual([])
  })

  it('asks for a key first, and treats it as blocking', () => {
    const steps = setupSteps(input({ apiKeySource: 'none' }))
    expect(steps[0]?.id).toBe('api-key')
    expect(steps[0]?.action).toEqual({ kind: 'navigate-settings', label: 'Open Settings' })
    expect(setupIsBlocking(steps)).toBe(true)
  })

  it('accepts a session key as done', () => {
    expect(ids(input({ apiKeySource: 'session' }))).not.toContain('api-key')
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

  it('warns that a key cannot be saved, but only before one is in use', () => {
    const unusable = capabilities({ secureKeyStorage: unavailable('No keyring here.') })
    expect(ids(input({ apiKeySource: 'none', capabilities: unusable }))).toContain('secure-storage')
    expect(ids(input({ apiKeySource: 'session', capabilities: unusable }))).not.toContain(
      'secure-storage'
    )
  })

  it('lists several outstanding items in the order they have to be dealt with', () => {
    expect(
      ids(
        input({
          apiKeySource: 'none',
          microphone: 'denied',
          capabilities: capabilities({
            globalToggle: needsPermission('Grant Input Monitoring.', 'input-monitoring'),
            autoPaste: needsPermission('Grant Accessibility.', 'accessibility'),
            secureKeyStorage: unavailable('No keyring here.')
          })
        })
      )
    ).toEqual(['api-key', 'microphone', 'input-monitoring', 'accessibility', 'secure-storage'])
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
