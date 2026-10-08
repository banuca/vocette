/**
 * Zoom for the main window, as in a browser: Ctrl + mouse wheel or Ctrl + plus
 * and minus step through fixed sizes, and Ctrl + 0 goes back to 100%. Only the
 * main window zooms; the dictation pill keeps its size. The size is remembered
 * between sessions.
 */

/** The sizes zoom steps through. 100% is the default. */
export const ZOOM_STEPS: readonly number[] = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
export const DEFAULT_ZOOM = 1

export function isZoomStep(value: unknown): value is number {
  return typeof value === 'number' && ZOOM_STEPS.includes(value)
}

/** The next size up or down, staying within the steps. */
export function stepZoom(current: number, direction: 1 | -1): number {
  // A size that is not a step (it cannot be, but a file could say so) starts
  // from the nearest one.
  let index = 0
  ZOOM_STEPS.forEach((step, at) => {
    if (Math.abs(step - current) < Math.abs((ZOOM_STEPS[index] ?? 1) - current)) index = at
  })
  const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction))
  return ZOOM_STEPS[next] ?? DEFAULT_ZOOM
}

/** The part of a key press zoom cares about, as Electron reports it. */
export interface ZoomKeyInput {
  type: string
  key: string
  control: boolean
  meta: boolean
  alt: boolean
}

/** Ctrl (Command on a Mac) with plus, minus or 0 is a zoom key; anything else is not. */
export function zoomKey(input: ZoomKeyInput): 'in' | 'out' | 'reset' | null {
  if (input.type !== 'keyDown' || input.alt || !(input.control || input.meta)) return null
  if (input.key === '=' || input.key === '+') return 'in'
  if (input.key === '-' || input.key === '_') return 'out'
  if (input.key === '0') return 'reset'
  return null
}
