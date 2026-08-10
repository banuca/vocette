import { describe, expect, it } from 'vitest'
import { KEY, chordLabel, sortChordKeys } from '../src/shared/keycodes'
import {
  chordEquals,
  chordFromLegacyPreset,
  chordIsSatisfied,
  normaliseChord,
  validateChord
} from '../src/shared/shortcuts'

const held = (...keys: number[]): Set<number> => new Set(keys)

describe('chordIsSatisfied', () => {
  const ctrlShift = [KEY.Ctrl, KEY.Shift]

  it('fires when exactly the chord is held', () => {
    expect(chordIsSatisfied(held(KEY.Ctrl, KEY.Shift), ctrlShift)).toBe(true)
  })

  it('does not fire when only part of the chord is held', () => {
    expect(chordIsSatisfied(held(KEY.Ctrl), ctrlShift)).toBe(false)
    expect(chordIsSatisfied(held(KEY.Shift), ctrlShift)).toBe(false)
  })

  it('rejects a chord held together with an outside modifier', () => {
    // Ctrl + Alt + Shift + X must not be read as Ctrl + Shift.
    expect(chordIsSatisfied(held(KEY.Ctrl, KEY.Shift, KEY.Alt), ctrlShift)).toBe(false)
  })

  it('ignores AltGr, which Windows reports as a phantom Left Ctrl', () => {
    // AltGr + Space on a Swiss/French layout: Left Ctrl and Right Alt both go
    // down. A Left Ctrl + Space chord must stay silent.
    const chord = [KEY.Ctrl, KEY.Space]
    expect(chordIsSatisfied(held(KEY.Ctrl, KEY.AltRight, KEY.Space), chord)).toBe(false)
    expect(chordIsSatisfied(held(KEY.Ctrl, KEY.Space), chord)).toBe(true)
  })

  it('distinguishes left and right modifiers', () => {
    expect(chordIsSatisfied(held(KEY.CtrlRight, KEY.Shift), ctrlShift)).toBe(false)
    expect(chordIsSatisfied(held(KEY.CtrlRight), [KEY.CtrlRight])).toBe(true)
  })

  it('allows a non-modifier key alongside the chord', () => {
    // Ctrl + Shift + T still satisfies the raw predicate; the hold delay in
    // ShortcutController is what stops it starting a dictation.
    expect(chordIsSatisfied(held(KEY.Ctrl, KEY.Shift, 0x0014), ctrlShift)).toBe(true)
  })
})

describe('validateChord', () => {
  it('accepts the default modifier pair', () => {
    expect(validateChord([KEY.Ctrl, KEY.Shift])).toEqual({ ok: true })
  })

  it('accepts safe solo keys', () => {
    expect(validateChord([KEY.CtrlRight]).ok).toBe(true)
    expect(validateChord([KEY.F13]).ok).toBe(true)
  })

  it('rejects a bare left modifier', () => {
    const result = validateChord([KEY.Ctrl])
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Left Ctrl')
  })

  it('rejects a bare character key', () => {
    expect(validateChord([0x001e]).ok).toBe(false) // A
    expect(validateChord([KEY.Space]).ok).toBe(false)
  })

  it('rejects a chord with no modifier', () => {
    expect(validateChord([KEY.Space, 0x001e]).ok).toBe(false)
  })

  it('rejects reserved Windows chords', () => {
    expect(validateChord([KEY.Ctrl, KEY.Alt, KEY.Delete]).ok).toBe(false)
    expect(validateChord([KEY.Alt, KEY.Tab]).ok).toBe(false)
  })

  it('rejects more than four keys', () => {
    expect(validateChord([KEY.Ctrl, KEY.Alt, KEY.Shift, KEY.Meta, KEY.Space]).ok).toBe(false)
  })

  it('warns but allows Ctrl + Space, which passes through to the focused app', () => {
    const result = validateChord([KEY.Ctrl, KEY.Space])
    expect(result.ok).toBe(true)
    expect(result.warning).toContain('also reaches the app')
  })

  it('warns about the Windows key', () => {
    const result = validateChord([KEY.Meta, KEY.Shift])
    expect(result.ok).toBe(true)
    expect(result.warning).toContain('Start menu')
  })
})

describe('normaliseChord', () => {
  it('accepts a keys array and a chord object', () => {
    expect(normaliseChord([KEY.Ctrl, KEY.Shift])).toEqual({ keys: [KEY.Ctrl, KEY.Shift] })
    expect(normaliseChord({ keys: [KEY.Shift, KEY.Ctrl] })).toEqual({
      keys: [KEY.Ctrl, KEY.Shift]
    })
  })

  it('dedupes and sorts into canonical order', () => {
    expect(normaliseChord([KEY.Space, KEY.Ctrl, KEY.Ctrl])).toEqual({
      keys: [KEY.Ctrl, KEY.Space]
    })
  })

  it('rejects junk', () => {
    expect(normaliseChord(null)).toBeNull()
    expect(normaliseChord([])).toBeNull()
    expect(normaliseChord(['ctrl'])).toBeNull()
    expect(normaliseChord([1, 2, 3, 4, 5])).toBeNull()
  })
})

describe('legacy presets', () => {
  it('maps every v1 preset id to its keycodes', () => {
    expect(chordFromLegacyPreset('left-control-left-alt')).toEqual({
      keys: [KEY.Ctrl, KEY.Alt]
    })
    expect(chordFromLegacyPreset('right-control')).toEqual({ keys: [KEY.CtrlRight] })
    expect(chordFromLegacyPreset('control-alt-space')).toEqual({
      keys: [KEY.Ctrl, KEY.Alt, KEY.Space]
    })
    expect(chordFromLegacyPreset('nonsense')).toBeNull()
  })
})

describe('labels', () => {
  it('labels chords in canonical order regardless of press order', () => {
    expect(chordLabel([KEY.Space, KEY.Ctrl])).toBe('Left Ctrl + Space')
    expect(chordLabel([KEY.Shift, KEY.Ctrl])).toBe('Left Ctrl + Left Shift')
  })

  it('names the left and right variants explicitly', () => {
    // The old build labelled a left-only chord as "Ctrl + Alt + Space".
    expect(chordLabel([KEY.Ctrl, KEY.Alt, KEY.Space])).toBe('Left Ctrl + Left Alt + Space')
    expect(chordLabel([KEY.CtrlRight])).toBe('Right Ctrl')
  })

  it('sorts modifiers before other keys', () => {
    expect(sortChordKeys([KEY.Space, KEY.Shift, KEY.Ctrl])).toEqual([
      KEY.Ctrl,
      KEY.Shift,
      KEY.Space
    ])
  })

  it('compares chords irrespective of order', () => {
    expect(chordEquals([KEY.Ctrl, KEY.Shift], [KEY.Shift, KEY.Ctrl])).toBe(true)
    expect(chordEquals([KEY.Ctrl], [KEY.Ctrl, KEY.Shift])).toBe(false)
  })
})
