import { KEY, isModifier, keyLabel, sortChordKeys } from './keycodes'

/**
 * Converts a chord into an Electron accelerator string.
 *
 * Only backends that cannot watch raw input need this — currently the Wayland
 * global-shortcut backend, where the compositor owns the keyboard and the app
 * may only ask the portal to register an accelerator.
 *
 * Accelerators are strictly less expressive than the chords the hook can
 * match, and the differences are reported rather than hidden:
 *
 *  - An accelerator needs exactly one ordinary key. A modifier-only chord —
 *    including the default Left Ctrl + Left Shift — cannot be expressed.
 *  - Accelerators do not distinguish left from right modifiers, so a
 *    right-side chord will also fire from the left-side key.
 */
export interface AcceleratorResult {
  /** The accelerator, or null when the chord cannot be expressed as one. */
  accelerator: string | null
  /** Why it cannot be expressed. Null when it can. */
  error: string | null
  /** Expressible, but not exactly the chord the user chose. */
  warning: string | null
}

const MODIFIER_TOKENS: Record<number, string> = {
  [KEY.Ctrl]: 'Control',
  [KEY.CtrlRight]: 'Control',
  [KEY.Alt]: 'Alt',
  [KEY.AltRight]: 'Alt',
  [KEY.Shift]: 'Shift',
  [KEY.ShiftRight]: 'Shift',
  [KEY.Meta]: 'Super',
  [KEY.MetaRight]: 'Super'
}

/** Modifiers Electron collapses to a single side. */
const RIGHT_MODIFIERS = new Set<number>([
  KEY.CtrlRight,
  KEY.AltRight,
  KEY.ShiftRight,
  KEY.MetaRight
])

const KEY_TOKENS: Record<number, string> = {
  [KEY.Space]: 'Space',
  [KEY.Tab]: 'Tab',
  [KEY.Enter]: 'Return',
  [KEY.Escape]: 'Escape',
  [KEY.Backspace]: 'Backspace',
  [KEY.Delete]: 'Delete',
  [KEY.Insert]: 'Insert',
  [KEY.Home]: 'Home',
  [KEY.End]: 'End',
  [KEY.PageUp]: 'PageUp',
  [KEY.PageDown]: 'PageDown',
  [KEY.ArrowLeft]: 'Left',
  [KEY.ArrowUp]: 'Up',
  [KEY.ArrowRight]: 'Right',
  [KEY.ArrowDown]: 'Down',
  [KEY.PrintScreen]: 'PrintScreen',
  [KEY.Semicolon]: ';',
  [KEY.Equal]: '=',
  [KEY.Comma]: ',',
  [KEY.Minus]: '-',
  [KEY.Period]: '.',
  [KEY.Slash]: '/',
  [KEY.Backquote]: '`',
  [KEY.BracketLeft]: '[',
  [KEY.Backslash]: '\\',
  [KEY.BracketRight]: ']',
  [KEY.Quote]: "'",
  [KEY.Numpad0]: 'num0',
  [KEY.Numpad1]: 'num1',
  [KEY.Numpad2]: 'num2',
  [KEY.Numpad3]: 'num3',
  [KEY.Numpad4]: 'num4',
  [KEY.Numpad5]: 'num5',
  [KEY.Numpad6]: 'num6',
  [KEY.Numpad7]: 'num7',
  [KEY.Numpad8]: 'num8',
  [KEY.Numpad9]: 'num9',
  [KEY.NumpadAdd]: 'numadd',
  [KEY.NumpadSubtract]: 'numsub',
  [KEY.NumpadMultiply]: 'nummult',
  [KEY.NumpadDivide]: 'numdiv',
  [KEY.NumpadDecimal]: 'numdec'
}

for (const [name, code] of Object.entries(KEY)) {
  if (/^[A-Z]$/u.test(name)) KEY_TOKENS[code] = name
  else if (/^Digit\d$/u.test(name)) KEY_TOKENS[code] = name.slice(5)
  else if (/^F\d{1,2}$/u.test(name)) KEY_TOKENS[code] = name
}

export function acceleratorForChord(keys: readonly number[]): AcceleratorResult {
  const fail = (error: string): AcceleratorResult => ({ accelerator: null, error, warning: null })

  if (!keys.length) return fail('No shortcut is set.')

  const sorted = sortChordKeys(keys)
  const modifiers = sorted.filter(isModifier)
  const ordinary = sorted.filter((key) => !isModifier(key))

  if (!ordinary.length) {
    return fail(
      'A shortcut registered with the desktop needs one ordinary key as well as its ' +
        'modifiers. Add a letter, number or function key.'
    )
  }
  if (ordinary.length > 1) {
    return fail('A shortcut registered with the desktop can use only one ordinary key.')
  }

  const [only] = ordinary
  const token = only === undefined ? undefined : KEY_TOKENS[only]
  if (!token) {
    return fail(`${only === undefined ? 'That key' : keyLabel(only)} cannot be registered with the desktop.`)
  }

  const parts = [...new Set(modifiers.map((key) => MODIFIER_TOKENS[key] ?? ''))].filter(Boolean)
  const collapsed = modifiers.filter((key) => RIGHT_MODIFIERS.has(key))

  return {
    accelerator: [...parts, token].join('+'),
    error: null,
    warning: collapsed.length
      ? `${collapsed.map(keyLabel).join(' and ')} cannot be told apart from the left-hand key ` +
        'by a desktop-registered shortcut, so either side will start dictation.'
      : null
  }
}
