import { describe, expect, it, vi } from 'vitest'
import { AcceleratorShortcutBackend } from '../src/main/platform/accelerator-backend'
import { KEY } from '../src/shared/keycodes'
import type { ShortcutBackendOptions } from '../src/main/platform/types'

/**
 * On Wayland the compositor owns the keyboard and the only global shortcut
 * available is one registered with the desktop. It fires a single callback and
 * has no matching release, so this backend must never claim hold support:
 * synthesising a release would produce dictations that never stop.
 */
function fakeDesktop(options: { registers?: boolean; verifies?: boolean; throws?: boolean } = {}) {
  const registered = new Map<string, () => void>()
  const calls = { register: [] as string[], unregister: [] as string[] }
  return {
    registered,
    calls,
    fire(accelerator: string): void {
      registered.get(accelerator)?.()
    },
    api: {
      register: (accelerator: string, callback: () => void): boolean => {
        calls.register.push(accelerator)
        if (options.throws) throw new Error('portal refused')
        if (options.registers === false) return false
        registered.set(accelerator, callback)
        return true
      },
      unregister: (accelerator: string): void => {
        calls.unregister.push(accelerator)
        registered.delete(accelerator)
      },
      isRegistered: (accelerator: string): boolean =>
        options.verifies === false ? false : registered.has(accelerator)
    }
  }
}

function options(keys: number[], overrides: Partial<ShortcutBackendOptions> = {}): ShortcutBackendOptions {
  return {
    chord: { keys },
    holdDelayMs: 250,
    onPress: vi.fn(),
    onRelease: vi.fn(),
    onError: vi.fn(),
    onCapture: vi.fn(),
    ...overrides
  }
}

describe('AcceleratorShortcutBackend', () => {
  it('never claims to support holding or capturing', () => {
    const desktop = fakeDesktop()
    const backend = new AcceleratorShortcutBackend(options([KEY.Ctrl, KEY.D]), desktop.api)
    expect(backend.supportsHold).toBe(false)
    expect(backend.supportsCapture).toBe(false)
  })

  it('registers on start and fires the press callback', () => {
    const desktop = fakeDesktop()
    const config = options([KEY.Ctrl, KEY.Shift, KEY.D])
    const backend = new AcceleratorShortcutBackend(config, desktop.api)
    backend.start()
    expect(desktop.calls.register).toEqual(['Control+Shift+D'])
    expect(backend.registrationError()).toBeNull()
    desktop.fire('Control+Shift+D')
    expect(config.onPress).toHaveBeenCalledTimes(1)
    expect(config.onRelease).not.toHaveBeenCalled()
  })

  it('releases the old accelerator before taking the new one', () => {
    const desktop = fakeDesktop()
    const backend = new AcceleratorShortcutBackend(options([KEY.Ctrl, KEY.D]), desktop.api)
    backend.start()
    backend.setChord({ keys: [KEY.Alt, KEY.J] })
    expect(desktop.calls.unregister).toEqual(['Control+D'])
    expect(desktop.calls.register).toEqual(['Control+D', 'Alt+J'])
  })

  it('gives the shortcut back when disabled, and takes it again when re-enabled', () => {
    const desktop = fakeDesktop()
    const backend = new AcceleratorShortcutBackend(options([KEY.Ctrl, KEY.D]), desktop.api)
    backend.start()
    backend.setEnabled(false)
    expect(desktop.registered.size).toBe(0)
    expect(backend.isEnabled()).toBe(false)
    backend.setEnabled(true)
    expect(desktop.registered.has('Control+D')).toBe(true)
  })

  it('releases the shortcut on stop', () => {
    const desktop = fakeDesktop()
    const backend = new AcceleratorShortcutBackend(options([KEY.Ctrl, KEY.D]), desktop.api)
    backend.start()
    backend.stop()
    expect(desktop.registered.size).toBe(0)
  })

  it('explains a chord the desktop cannot express, without registering anything', () => {
    const desktop = fakeDesktop()
    const backend = new AcceleratorShortcutBackend(options([KEY.Ctrl, KEY.Shift]), desktop.api)
    backend.start()
    expect(desktop.calls.register).toEqual([])
    expect(backend.registrationError()).toContain('one ordinary key')
  })

  it('explains a shortcut another application already holds', () => {
    const desktop = fakeDesktop({ registers: false })
    const backend = new AcceleratorShortcutBackend(options([KEY.Ctrl, KEY.D]), desktop.api)
    backend.start()
    expect(backend.registrationError()).toContain('Another application may already use it')
  })

  it('does not trust a register() that says yes but leaves nothing registered', () => {
    const desktop = fakeDesktop({ verifies: false })
    const backend = new AcceleratorShortcutBackend(options([KEY.Ctrl, KEY.D]), desktop.api)
    backend.start()
    expect(backend.registrationError()).toContain('would not register')
  })

  it('survives a desktop that throws', () => {
    const desktop = fakeDesktop({ throws: true })
    const backend = new AcceleratorShortcutBackend(options([KEY.Ctrl, KEY.D]), desktop.api)
    backend.start()
    expect(backend.registrationError()).toContain('would not register')
  })

  it('ends a capture request immediately rather than stranding the Settings page', () => {
    const desktop = fakeDesktop()
    const config = options([KEY.Ctrl, KEY.D])
    const backend = new AcceleratorShortcutBackend(config, desktop.api)
    backend.beginCapture()
    expect(config.onCapture).toHaveBeenCalledWith([], true)
    expect(backend.isCapturing()).toBe(false)
  })

  it('has nothing to suppress or reset, and says so without throwing', () => {
    const desktop = fakeDesktop()
    const backend = new AcceleratorShortcutBackend(options([KEY.Ctrl, KEY.D]), desktop.api)
    backend.suppressSyntheticInput()
    backend.resetKeyState()
    backend.cancelCapture()
    backend.setHoldDelay()
    expect(backend.registrationError()).toBeNull()
  })

  it('registers nothing until started', () => {
    const desktop = fakeDesktop()
    const backend = new AcceleratorShortcutBackend(options([KEY.Ctrl, KEY.D]), desktop.api)
    backend.setChord({ keys: [KEY.Alt, KEY.J] })
    expect(desktop.calls.register).toEqual([])
  })
})
