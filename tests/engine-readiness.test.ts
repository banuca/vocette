import { describe, expect, it } from 'vitest'
import {
  KEY_NOT_READY_REASON,
  MODEL_NOT_READY_REASON,
  engineReady,
  type ModelState
} from '../src/shared/engine'

/**
 * Readiness decides whether Record works at all, so it has to ask for the
 * right thing: the on-device engine never needs a key, and the cloud never
 * needs the model.
 */
const ALL_STATES: ModelState[] = [
  'missing',
  'partial',
  'downloading',
  'verifying',
  'installed',
  'failed'
]

describe('engineReady', () => {
  it('is ready on this PC only once the model is installed', () => {
    for (const state of ALL_STATES) {
      const readiness = engineReady({ engine: 'local', apiKeySource: 'none' }, state)
      if (state === 'installed') {
        expect(readiness).toEqual({ ready: true, notReadyReason: null })
      } else {
        expect(readiness).toEqual({ ready: false, notReadyReason: MODEL_NOT_READY_REASON })
      }
    }
  })

  it('does not ask an on-device user for a key, whether or not they have one', () => {
    expect(engineReady({ engine: 'local', apiKeySource: 'stored' }, 'missing').notReadyReason).toBe(
      'Download the speech model in Settings first.'
    )
    expect(engineReady({ engine: 'local', apiKeySource: 'none' }, 'installed').ready).toBe(true)
  })

  it('is ready in the cloud with a key held anywhere, whatever the model', () => {
    for (const state of ALL_STATES) {
      expect(engineReady({ engine: 'cloud', apiKeySource: 'stored' }, state).ready).toBe(true)
      expect(engineReady({ engine: 'cloud', apiKeySource: 'session' }, state).ready).toBe(true)
    }
  })

  it('asks a cloud user for a key, not for the model', () => {
    expect(engineReady({ engine: 'cloud', apiKeySource: 'none' }, 'installed')).toEqual({
      ready: false,
      notReadyReason: 'Add your API key in Settings before recording.'
    })
    expect(KEY_NOT_READY_REASON).toBe('Add your API key in Settings before recording.')
  })
})
