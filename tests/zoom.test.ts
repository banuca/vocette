import { describe, expect, it } from 'vitest'
import { DEFAULT_ZOOM, ZOOM_STEPS, isZoomStep, stepZoom, zoomKey } from '../src/main/zoom'

describe('zoom', () => {
  it('steps up and down through the sizes, and stops at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1.1, 1)).toBe(1.25)
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(ZOOM_STEPS[0]!, -1)).toBe(ZOOM_STEPS[0])
    expect(stepZoom(ZOOM_STEPS.at(-1)!, 1)).toBe(ZOOM_STEPS.at(-1))
  })

  it('starts from the nearest size when given one that is not a step', () => {
    expect(stepZoom(1.2, 1)).toBe(1.5)
    expect(stepZoom(7, -1)).toBe(1.75)
  })

  it('knows its own sizes, with 100% as the default', () => {
    expect(DEFAULT_ZOOM).toBe(1)
    expect(isZoomStep(1.25)).toBe(true)
    expect(isZoomStep(1.3)).toBe(false)
    expect(isZoomStep('1')).toBe(false)
  })

  it('reads Ctrl or Command with plus, minus and 0 as zoom keys, and nothing else', () => {
    const key = (k: string, extra: Partial<Parameters<typeof zoomKey>[0]> = {}) =>
      zoomKey({ type: 'keyDown', key: k, control: true, meta: false, alt: false, ...extra })
    expect(key('=')).toBe('in')
    expect(key('+')).toBe('in')
    expect(key('-')).toBe('out')
    expect(key('0')).toBe('reset')
    expect(key('=', { control: false, meta: true })).toBe('in')
    expect(key('=', { control: false })).toBeNull()
    expect(key('=', { alt: true })).toBeNull()
    expect(key('=', { type: 'keyUp' })).toBeNull()
    expect(key('a')).toBeNull()
  })
})
