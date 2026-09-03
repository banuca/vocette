/**
 * Keycode table for global shortcuts.
 *
 * These values mirror `UiohookKey` from uiohook-napi (they are libuiohook
 * scancodes, not DOM key codes). They are duplicated here on purpose: the
 * renderer needs to label a chord, and uiohook-napi is a native module that can
 * only be loaded in the main process. `tests/keycodes.test.ts` asserts this
 * table stays in sync with the real one.
 */
export const KEY = {
  Escape: 0x0001,
  Backspace: 0x000e,
  Tab: 0x000f,
  Enter: 0x001c,
  CapsLock: 0x003a,
  Space: 0x0039,

  Ctrl: 0x001d,
  CtrlRight: 0x0e1d,
  Alt: 0x0038,
  AltRight: 0x0e38,
  Shift: 0x002a,
  ShiftRight: 0x0036,
  Meta: 0x0e5b,
  MetaRight: 0x0e5c,

  NumLock: 0x0045,
  ScrollLock: 0x0046,
  PrintScreen: 0x0e37,
  Insert: 0x0e52,
  Delete: 0x0e53,
  Home: 0x0e47,
  End: 0x0e4f,
  PageUp: 0x0e49,
  PageDown: 0x0e51,
  ArrowLeft: 0xe04b,
  ArrowUp: 0xe048,
  ArrowRight: 0xe04d,
  ArrowDown: 0xe050,

  Numpad0: 0x0052,
  Numpad1: 0x004f,
  Numpad2: 0x0050,
  Numpad3: 0x0051,
  Numpad4: 0x004b,
  Numpad5: 0x004c,
  Numpad6: 0x004d,
  Numpad7: 0x0047,
  Numpad8: 0x0048,
  Numpad9: 0x0049,
  NumpadMultiply: 0x0037,
  NumpadAdd: 0x004e,
  NumpadSubtract: 0x004a,
  NumpadDecimal: 0x0053,
  NumpadDivide: 0x0e35,

  Digit0: 0x000b,
  Digit1: 0x0002,
  Digit2: 0x0003,
  Digit3: 0x0004,
  Digit4: 0x0005,
  Digit5: 0x0006,
  Digit6: 0x0007,
  Digit7: 0x0008,
  Digit8: 0x0009,
  Digit9: 0x000a,

  A: 0x001e,
  B: 0x0030,
  C: 0x002e,
  D: 0x0020,
  E: 0x0012,
  F: 0x0021,
  G: 0x0022,
  H: 0x0023,
  I: 0x0017,
  J: 0x0024,
  K: 0x0025,
  L: 0x0026,
  M: 0x0032,
  N: 0x0031,
  O: 0x0018,
  P: 0x0019,
  Q: 0x0010,
  R: 0x0013,
  S: 0x001f,
  T: 0x0014,
  U: 0x0016,
  V: 0x002f,
  W: 0x0011,
  X: 0x002d,
  Y: 0x0015,
  Z: 0x002c,

  Semicolon: 0x0027,
  Equal: 0x000d,
  Comma: 0x0033,
  Minus: 0x000c,
  Period: 0x0034,
  Slash: 0x0035,
  Backquote: 0x0029,
  BracketLeft: 0x001a,
  Backslash: 0x002b,
  BracketRight: 0x001b,
  Quote: 0x0028,

  F1: 0x003b,
  F2: 0x003c,
  F3: 0x003d,
  F4: 0x003e,
  F5: 0x003f,
  F6: 0x0040,
  F7: 0x0041,
  F8: 0x0042,
  F9: 0x0043,
  F10: 0x0044,
  F11: 0x0057,
  F12: 0x0058,
  F13: 0x005b,
  F14: 0x005c,
  F15: 0x005d,
  F16: 0x0063,
  F17: 0x0064,
  F18: 0x0065,
  F19: 0x0066,
  F20: 0x0067,
  F21: 0x0068,
  F22: 0x0069,
  F23: 0x006a,
  F24: 0x006b
} as const

/** Left/right modifier keys, in canonical display order. */
export const MODIFIER_ORDER: readonly number[] = [
  KEY.Ctrl,
  KEY.CtrlRight,
  KEY.Alt,
  KEY.AltRight,
  KEY.Shift,
  KEY.ShiftRight,
  KEY.Meta,
  KEY.MetaRight
]

const MODIFIER_SET = new Set(MODIFIER_ORDER)

export function isModifier(keycode: number): boolean {
  return MODIFIER_SET.has(keycode)
}

/**
 * Keys that are safe to use on their own, because Windows and mainstream apps
 * do not bind them. Everything else must be combined with a modifier.
 */
export const SAFE_SOLO_KEYS: readonly number[] = [
  KEY.CtrlRight,
  KEY.AltRight,
  KEY.ShiftRight,
  KEY.ScrollLock,
  KEY.F13,
  KEY.F14,
  KEY.F15,
  KEY.F16,
  KEY.F17,
  KEY.F18,
  KEY.F19,
  KEY.F20,
  KEY.F21,
  KEY.F22,
  KEY.F23,
  KEY.F24
]

const SAFE_SOLO_SET = new Set(SAFE_SOLO_KEYS)

export function isSafeSoloKey(keycode: number): boolean {
  return SAFE_SOLO_SET.has(keycode)
}

/**
 * Keys of the main typing block, labelled as they appear on a US layout. A
 * chord built only from these would swallow ordinary typing.
 */
const TYPING_LABELS: Record<number, string> = {
  [KEY.Digit0]: '0',
  [KEY.Digit1]: '1',
  [KEY.Digit2]: '2',
  [KEY.Digit3]: '3',
  [KEY.Digit4]: '4',
  [KEY.Digit5]: '5',
  [KEY.Digit6]: '6',
  [KEY.Digit7]: '7',
  [KEY.Digit8]: '8',
  [KEY.Digit9]: '9',
  [KEY.A]: 'A',
  [KEY.B]: 'B',
  [KEY.C]: 'C',
  [KEY.D]: 'D',
  [KEY.E]: 'E',
  [KEY.F]: 'F',
  [KEY.G]: 'G',
  [KEY.H]: 'H',
  [KEY.I]: 'I',
  [KEY.J]: 'J',
  [KEY.K]: 'K',
  [KEY.L]: 'L',
  [KEY.M]: 'M',
  [KEY.N]: 'N',
  [KEY.O]: 'O',
  [KEY.P]: 'P',
  [KEY.Q]: 'Q',
  [KEY.R]: 'R',
  [KEY.S]: 'S',
  [KEY.T]: 'T',
  [KEY.U]: 'U',
  [KEY.V]: 'V',
  [KEY.W]: 'W',
  [KEY.X]: 'X',
  [KEY.Y]: 'Y',
  [KEY.Z]: 'Z',
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
  [KEY.Quote]: "'"
}

const TYPING_SET = new Set(Object.keys(TYPING_LABELS).map(Number))

/** Numpad digits type numbers, so a solo chord on them is rejected too. */
const NUMERIC_TYPING_SET = new Set<number>([
  KEY.Numpad0,
  KEY.Numpad1,
  KEY.Numpad2,
  KEY.Numpad3,
  KEY.Numpad4,
  KEY.Numpad5,
  KEY.Numpad6,
  KEY.Numpad7,
  KEY.Numpad8,
  KEY.Numpad9,
  KEY.NumpadDecimal
])

export function isTypingKey(keycode: number): boolean {
  return TYPING_SET.has(keycode) || NUMERIC_TYPING_SET.has(keycode) || keycode === KEY.Space
}

const NAMED_LABELS: Record<number, string> = {
  [KEY.Ctrl]: 'Left Ctrl',
  [KEY.CtrlRight]: 'Right Ctrl',
  [KEY.Alt]: 'Left Alt',
  [KEY.AltRight]: 'Right Alt',
  [KEY.Shift]: 'Left Shift',
  [KEY.ShiftRight]: 'Right Shift',
  [KEY.Meta]: 'Left Win',
  [KEY.MetaRight]: 'Right Win',
  [KEY.Space]: 'Space',
  [KEY.Escape]: 'Esc',
  [KEY.Backspace]: 'Backspace',
  [KEY.Tab]: 'Tab',
  [KEY.Enter]: 'Enter',
  [KEY.CapsLock]: 'Caps Lock',
  [KEY.NumLock]: 'Num Lock',
  [KEY.ScrollLock]: 'Scroll Lock',
  [KEY.PrintScreen]: 'Print Screen',
  [KEY.Insert]: 'Insert',
  [KEY.Delete]: 'Delete',
  [KEY.Home]: 'Home',
  [KEY.End]: 'End',
  [KEY.PageUp]: 'Page Up',
  [KEY.PageDown]: 'Page Down',
  [KEY.ArrowLeft]: '←',
  [KEY.ArrowUp]: '↑',
  [KEY.ArrowRight]: '→',
  [KEY.ArrowDown]: '↓',
  [KEY.Numpad0]: 'Numpad 0',
  [KEY.Numpad1]: 'Numpad 1',
  [KEY.Numpad2]: 'Numpad 2',
  [KEY.Numpad3]: 'Numpad 3',
  [KEY.Numpad4]: 'Numpad 4',
  [KEY.Numpad5]: 'Numpad 5',
  [KEY.Numpad6]: 'Numpad 6',
  [KEY.Numpad7]: 'Numpad 7',
  [KEY.Numpad8]: 'Numpad 8',
  [KEY.Numpad9]: 'Numpad 9',
  [KEY.NumpadMultiply]: 'Numpad *',
  [KEY.NumpadAdd]: 'Numpad +',
  [KEY.NumpadSubtract]: 'Numpad −',
  [KEY.NumpadDecimal]: 'Numpad .',
  [KEY.NumpadDivide]: 'Numpad /'
}

const FUNCTION_LABELS: Record<number, string> = Object.fromEntries(
  Object.entries(KEY)
    .filter(([name]) => /^F\d{1,2}$/u.test(name))
    .map(([name, code]) => [code, name])
)

/** Human label for a single key, e.g. `0x001d` → `"Left Ctrl"`. */
export function keyLabel(keycode: number): string {
  return (
    NAMED_LABELS[keycode] ??
    FUNCTION_LABELS[keycode] ??
    TYPING_LABELS[keycode] ??
    `Key ${keycode}`
  )
}

/**
 * Canonical ordering: modifiers first (left before right, Ctrl→Alt→Shift→Win),
 * then everything else by keycode. Guarantees `Left Ctrl + Space` never renders
 * as `Space + Left Ctrl`, whichever order the keys were pressed in.
 */
export function sortChordKeys(keys: readonly number[]): number[] {
  return [...keys].sort((a, b) => {
    const indexA = MODIFIER_ORDER.indexOf(a)
    const indexB = MODIFIER_ORDER.indexOf(b)
    if (indexA >= 0 && indexB >= 0) return indexA - indexB
    if (indexA >= 0) return -1
    if (indexB >= 0) return 1
    return a - b
  })
}

/** Human label for a whole chord, e.g. `"Left Ctrl + Left Shift"`. */
export function chordLabel(keys: readonly number[]): string {
  if (!keys.length) return 'Not set'
  return sortChordKeys(keys).map(keyLabel).join(' + ')
}
