import { describe, expect, it } from 'vitest'
import { acceleratorForChord } from '../src/shared/accelerator'
import { KEY } from '../src/shared/keycodes'

/**
 * Accelerators are what a Wayland session can register with the desktop
 * portal, and they are strictly less expressive than the chords the keyboard
 * hook can match. Every gap has to surface as an error or a warning the user
 * can read, never as a shortcut that silently does something else.
 */
describe('acceleratorForChord', () => {
  it('converts a modifier plus a letter', () => {
    const result = acceleratorForChord([KEY.Ctrl, KEY.Shift, KEY.D])
    expect(result.accelerator).toBe('Control+Shift+D')
    expect(result.error).toBeNull()
    expect(result.warning).toBeNull()
  })

  it('refuses a modifier-only chord, including the default one', () => {
    const result = acceleratorForChord([KEY.Ctrl, KEY.Shift])
    expect(result.accelerator).toBeNull()
    expect(result.error).toContain('one ordinary key')
  })

  it('refuses a chord with two ordinary keys', () => {
    const result = acceleratorForChord([KEY.Ctrl, KEY.A, KEY.B])
    expect(result.accelerator).toBeNull()
    expect(result.error).toContain('only one ordinary key')
  })

  it('refuses an empty chord', () => {
    expect(acceleratorForChord([]).error).toBe('No shortcut is set.')
  })

  it('warns that a right-hand modifier cannot be told apart from the left', () => {
    const result = acceleratorForChord([KEY.CtrlRight, KEY.Space])
    expect(result.accelerator).toBe('Control+Space')
    expect(result.warning).toContain('Right Ctrl')
  })

  it('collapses duplicate sides into one modifier token', () => {
    expect(acceleratorForChord([KEY.Ctrl, KEY.CtrlRight, KEY.J]).accelerator).toBe('Control+J')
  })

  it('maps the Windows key to Super', () => {
    expect(acceleratorForChord([KEY.Meta, KEY.Space]).accelerator).toBe('Super+Space')
  })

  it('maps digits, function keys, punctuation and the numpad', () => {
    expect(acceleratorForChord([KEY.Alt, KEY.Digit7]).accelerator).toBe('Alt+7')
    expect(acceleratorForChord([KEY.F13]).accelerator).toBe('F13')
    expect(acceleratorForChord([KEY.Ctrl, KEY.Semicolon]).accelerator).toBe('Control+;')
    expect(acceleratorForChord([KEY.Ctrl, KEY.Numpad5]).accelerator).toBe('Control+num5')
    expect(acceleratorForChord([KEY.Ctrl, KEY.Backslash]).accelerator).toBe('Control+\\')
  })

  it('maps the arrow keys and Return to their accelerator names', () => {
    expect(acceleratorForChord([KEY.Ctrl, KEY.ArrowUp]).accelerator).toBe('Control+Up')
    expect(acceleratorForChord([KEY.Ctrl, KEY.Enter]).accelerator).toBe('Control+Return')
  })

  it('refuses a key the desktop has no name for', () => {
    const result = acceleratorForChord([KEY.Ctrl, KEY.ScrollLock])
    expect(result.accelerator).toBeNull()
    expect(result.error).toContain('cannot be registered')
  })

  it('orders modifiers ahead of the key regardless of input order', () => {
    expect(acceleratorForChord([KEY.K, KEY.Shift, KEY.Ctrl]).accelerator).toBe('Control+Shift+K')
  })
})
