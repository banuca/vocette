import {
  KEY,
  chordLabel,
  isModifier,
  isSafeSoloKey,
  isTypingKey,
  keyLabel,
  sortChordKeys
} from './keycodes'

/** A hold-to-talk chord, stored as libuiohook scancodes. */
export interface ShortcutChord {
  keys: number[]
}

export const MAX_CHORD_KEYS = 4

/** Quick-pick chords offered as one-click buttons in Settings. */
export const SHORTCUT_PRESETS: readonly { id: string; keys: number[] }[] = [
  { id: 'left-control-left-shift', keys: [KEY.Ctrl, KEY.Shift] },
  { id: 'right-control', keys: [KEY.CtrlRight] },
  { id: 'left-control-left-alt', keys: [KEY.Ctrl, KEY.Alt] },
  { id: 'left-control-space', keys: [KEY.Ctrl, KEY.Space] }
]

export const DEFAULT_CHORD: ShortcutChord = { keys: [KEY.Ctrl, KEY.Shift] }

/** Legacy `settings.version === 1` preset ids, kept for migration only. */
const LEGACY_PRESETS: Record<string, number[]> = {
  'left-control-left-alt': [KEY.Ctrl, KEY.Alt],
  'right-control': [KEY.CtrlRight],
  'control-alt-space': [KEY.Ctrl, KEY.Alt, KEY.Space]
}

export function chordFromLegacyPreset(id: unknown): ShortcutChord | null {
  if (typeof id !== 'string') return null
  const keys = LEGACY_PRESETS[id]
  return keys ? { keys: [...keys] } : null
}

export const HOLD_DELAY_OPTIONS: readonly number[] = [0, 150, 250, 400]
export const DEFAULT_HOLD_DELAY_MS = 250

export function normaliseChord(value: unknown): ShortcutChord | null {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as ShortcutChord).keys)
      ? (value as ShortcutChord).keys
      : null
  if (!raw) return null
  const keys = sortChordKeys(
    [...new Set(raw.filter((key): key is number => Number.isInteger(key) && key > 0))]
  )
  if (!keys.length || keys.length > MAX_CHORD_KEYS) return null
  return { keys }
}

export function chordEquals(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  const left = sortChordKeys(a)
  const right = sortChordKeys(b)
  return left.every((key, index) => key === right[index])
}

export interface ChordValidation {
  ok: boolean
  /** Blocking problem — the chord cannot be saved. */
  error?: string
  /** Saveable, but the user should know about a side effect. */
  warning?: string
}

/**
 * Rejects chords that would make the machine unusable, and warns about chords
 * that work but have visible side effects.
 *
 * The keystroke is never swallowed — libuiohook observes input, it cannot
 * consume it — so any chord containing a character key also reaches whatever
 * app has focus. That is a warning, not an error: it is a legitimate choice.
 */
export function validateChord(keys: readonly number[]): ChordValidation {
  if (!keys.length) return { ok: false, error: 'Press the keys you want to hold.' }
  if (keys.length > MAX_CHORD_KEYS) {
    return { ok: false, error: `Use at most ${MAX_CHORD_KEYS} keys.` }
  }

  const sorted = sortChordKeys(keys)
  const modifiers = sorted.filter(isModifier)

  if (sorted.length === 1) {
    const [only] = sorted
    if (only === undefined) return { ok: false, error: 'Press the keys you want to hold.' }
    if (!isSafeSoloKey(only)) {
      if (isModifier(only)) {
        return {
          ok: false,
          error: `${keyLabel(only)} on its own would fire on every ${keyLabel(only).replace('Left ', '')} shortcut. Add a second key.`
        }
      }
      if (isTypingKey(only)) {
        return {
          ok: false,
          error: `${keyLabel(only)} on its own would trigger while you type. Add a modifier.`
        }
      }
      return { ok: false, error: `${keyLabel(only)} on its own is not safe. Add a modifier.` }
    }
    return { ok: true }
  }

  if (!modifiers.length) {
    return { ok: false, error: 'Include Ctrl, Alt, Shift, or Win.' }
  }

  // Chords Windows reserves or that would be actively hostile to hold.
  if (sorted.includes(KEY.Delete) && modifiers.includes(KEY.Ctrl) && modifiers.some((key) => key === KEY.Alt || key === KEY.AltRight)) {
    return { ok: false, error: 'Windows reserves Ctrl + Alt + Delete; it cannot be captured.' }
  }
  if (sorted.includes(KEY.Tab) && modifiers.some((key) => key === KEY.Alt || key === KEY.AltRight)) {
    return { ok: false, error: 'Alt + Tab is the Windows window switcher.' }
  }

  const label = chordLabel(sorted)

  if (sorted.includes(KEY.Escape)) {
    return { ok: true, warning: `${label} may collide with Task Manager and app-cancel shortcuts.` }
  }
  if (sorted.some((key) => key === KEY.Meta || key === KEY.MetaRight)) {
    return { ok: true, warning: 'The Windows key may still open the Start menu when you release it.' }
  }
  if (sorted.some(isTypingKey)) {
    return {
      ok: true,
      warning: `${label} also reaches the app you are typing in (code completion, IME switching). Dictation still works.`
    }
  }

  return { ok: true }
}

/**
 * True when the chord is fully held and nothing else that would change its
 * meaning is held with it.
 *
 * Exclusivity covers *modifiers* only. Without it, AltGr would false-trigger a
 * Left Ctrl chord — Windows injects a phantom Left Ctrl keydown for AltGr — and
 * Ctrl + Alt + Shift + X would fire a Ctrl + Alt chord.
 *
 * A chord that is a prefix of a longer shortcut (Left Ctrl + Left Shift vs
 * Ctrl + Shift + T) is handled separately, by the hold delay in
 * `ShortcutController`: the extra key cancels the pending arm.
 */
export function chordIsSatisfied(
  pressed: ReadonlySet<number>,
  chord: readonly number[]
): boolean {
  for (const key of chord) {
    if (!pressed.has(key)) return false
  }
  for (const key of pressed) {
    if (isModifier(key) && !chord.includes(key)) return false
  }
  return true
}

export { chordLabel }
