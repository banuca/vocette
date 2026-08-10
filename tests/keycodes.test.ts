import { describe, expect, it } from 'vitest'
import { UiohookKey } from 'uiohook-napi'
import { KEY, isModifier, isTypingKey, keyLabel } from '../src/shared/keycodes'

/**
 * `src/shared/keycodes.ts` duplicates uiohook's table so the renderer can label
 * a chord without loading a native module. If upstream ever renumbers a key,
 * the matcher and the label would disagree — this catches that at build time.
 */
describe('keycode table stays in sync with uiohook-napi', () => {
  // uiohook keys the digit row numerically (`UiohookKey[0]`), we name them.
  const aliases: Record<string, keyof typeof UiohookKey> = {
    Digit0: 0,
    Digit1: 1,
    Digit2: 2,
    Digit3: 3,
    Digit4: 4,
    Digit5: 5,
    Digit6: 6,
    Digit7: 7,
    Digit8: 8,
    Digit9: 9
  }

  it('matches every key we define', () => {
    const mismatches: string[] = []
    for (const [name, value] of Object.entries(KEY)) {
      const upstreamName = aliases[name] ?? (name as keyof typeof UiohookKey)
      const upstream = UiohookKey[upstreamName]
      if (upstream === undefined) {
        mismatches.push(`${name}: missing upstream`)
      } else if (upstream !== value) {
        mismatches.push(`${name}: ours ${value}, upstream ${upstream}`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('agrees that Ctrl, Alt and Shift mean the left-hand key', () => {
    expect(KEY.Ctrl).toBe(UiohookKey.Ctrl)
    expect(KEY.CtrlRight).toBe(UiohookKey.CtrlRight)
    expect(KEY.Ctrl).not.toBe(KEY.CtrlRight)
  })
})

describe('classification', () => {
  it('recognises modifiers on both sides', () => {
    expect(isModifier(KEY.Ctrl)).toBe(true)
    expect(isModifier(KEY.MetaRight)).toBe(true)
    expect(isModifier(KEY.Space)).toBe(false)
    expect(isModifier(KEY.F13)).toBe(false)
  })

  it('treats characters and Space as typing keys', () => {
    expect(isTypingKey(KEY.A)).toBe(true)
    expect(isTypingKey(KEY.Space)).toBe(true)
    expect(isTypingKey(KEY.Digit1)).toBe(true)
    expect(isTypingKey(KEY.F13)).toBe(false)
    expect(isTypingKey(KEY.Ctrl)).toBe(false)
  })

  it('labels unknown keycodes without throwing', () => {
    expect(keyLabel(0x7fff)).toBe('Key 32767')
  })
})
