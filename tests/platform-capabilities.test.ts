import { describe, expect, it } from 'vitest'
import {
  autoPasteSupported,
  available,
  clipboardOnlyReason,
  effectiveRecordingMode,
  globalShortcutUsable,
  needsPermission,
  recordingModeIsForced,
  unavailable,
  type CapabilityMap
} from '../src/shared/capabilities'

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

/**
 * Capability and preference are deliberately separate. A capability that is
 * missing right now must never overwrite what the user chose, or their setting
 * would silently disappear the moment they moved to a session without it.
 */
describe('effectiveRecordingMode', () => {
  it('honours a hold preference when holding is supported', () => {
    expect(effectiveRecordingMode('hold', capabilities())).toBe('hold')
  })

  it('falls back to toggle when holding is unavailable', () => {
    const map = capabilities({ globalHold: unavailable('Wayland cannot watch the keyboard.') })
    expect(effectiveRecordingMode('hold', map)).toBe('toggle')
    expect(recordingModeIsForced('hold', map)).toBe(true)
  })

  it('treats a permission-gated hold as not yet usable', () => {
    const map = capabilities({
      globalHold: needsPermission('Grant Input Monitoring.', 'input-monitoring')
    })
    expect(effectiveRecordingMode('hold', map)).toBe('toggle')
  })

  it('leaves a toggle preference alone even where holding works', () => {
    expect(effectiveRecordingMode('toggle', capabilities())).toBe('toggle')
    expect(recordingModeIsForced('toggle', capabilities())).toBe(false)
  })
})

describe('globalShortcutUsable', () => {
  it('is true when only the toggle shortcut works', () => {
    const map = capabilities({ globalHold: unavailable('No key-up here.') })
    expect(globalShortcutUsable(map)).toBe(true)
  })

  it('is false when neither works', () => {
    const map = capabilities({
      globalHold: unavailable('no'),
      globalToggle: unavailable('no')
    })
    expect(globalShortcutUsable(map)).toBe(false)
  })
})

describe('autoPasteSupported', () => {
  it('requires both injection and target verification', () => {
    expect(autoPasteSupported(capabilities())).toBe(true)
    expect(
      autoPasteSupported(capabilities({ targetVerification: unavailable('cannot check focus') }))
    ).toBe(false)
    expect(autoPasteSupported(capabilities({ autoPaste: unavailable('cannot type') }))).toBe(false)
  })
})

describe('clipboardOnlyReason', () => {
  it('is null when automatic paste is on offer', () => {
    expect(clipboardOnlyReason(capabilities())).toBeNull()
  })

  it('reports the target problem first, because it explains the outcome', () => {
    const map = capabilities({
      targetVerification: unavailable('Wayland hides the focused window.'),
      autoPaste: unavailable('Wayland will not let us type.')
    })
    expect(clipboardOnlyReason(map)).toBe('Wayland hides the focused window.')
  })

  it('falls back to the injection problem when the target is verifiable', () => {
    const map = capabilities({ autoPaste: unavailable('The hook did not start.') })
    expect(clipboardOnlyReason(map)).toBe('The hook did not start.')
  })

  it('never returns an empty string, even for a reasonless capability', () => {
    const map = capabilities({ targetVerification: { state: 'unavailable', reason: '', pane: null } })
    expect(clipboardOnlyReason(map)).toBe('The paste target cannot be verified here.')
  })
})
