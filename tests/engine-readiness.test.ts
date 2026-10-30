import { describe, expect, it } from 'vitest'
import {
  KEY_NOT_READY_REASON,
  MODEL_NOT_READY_REASON,
  SELF_CHECK_FAILED_REASON,
  engineReady,
  type ModelState
} from '../src/shared/engine'

/**
 * Readiness decides whether Record works at all, so it has to ask for the
 * right thing: the on-device engine never needs a key, the cloud never needs
 * the model, and a server of the user's own may need no key at all.
 */
const ALL_STATES: ModelState[] = [
  'missing',
  'partial',
  'downloading',
  'verifying',
  'installed',
  'failed'
]

/** No endpoint set: OpenAI, which always needs a key. */
const OPENAI = ''
const LOCAL_SERVER = 'http://localhost:8080/v1'

describe('engineReady', () => {
  it('is ready on this PC only once the model is installed', () => {
    for (const state of ALL_STATES) {
      const readiness = engineReady(
        { engine: 'local', apiKeySource: 'none', apiEndpoint: OPENAI },
        state
      )
      if (state === 'installed') {
        expect(readiness).toEqual({ ready: true, notReadyReason: null })
      } else {
        expect(readiness).toEqual({ ready: false, notReadyReason: MODEL_NOT_READY_REASON })
      }
    }
  })

  it('does not ask an on-device user for a key, whether or not they have one', () => {
    expect(
      engineReady({ engine: 'local', apiKeySource: 'stored', apiEndpoint: OPENAI }, 'missing')
        .notReadyReason
    ).toBe('Download the speech model first.')
    expect(
      engineReady({ engine: 'local', apiKeySource: 'none', apiEndpoint: OPENAI }, 'installed').ready
    ).toBe(true)
  })

  it('is not ready on this PC once the engine has failed its self-check, and says why', () => {
    const local = { engine: 'local', apiKeySource: 'none', apiEndpoint: OPENAI } as const
    expect(engineReady(local, 'installed', 'failed')).toEqual({
      ready: false,
      notReadyReason: SELF_CHECK_FAILED_REASON
    })
    expect(SELF_CHECK_FAILED_REASON).toBe(
      "On-device transcription isn't working correctly on this PC. To keep dictating, choose Cloud in Settings."
    )
    expect(engineReady(local, 'installed', 'passed')).toEqual({ ready: true, notReadyReason: null })
    // Without the model, the model is what is missing.
    expect(engineReady(local, 'missing', 'failed').notReadyReason).toBe(MODEL_NOT_READY_REASON)
    // The cloud does not care how the on-device engine fared.
    expect(
      engineReady({ engine: 'cloud', apiKeySource: 'stored', apiEndpoint: OPENAI }, 'installed', 'failed')
    ).toEqual({ ready: true, notReadyReason: null })
  })

  it('still needs the model on this PC, whatever endpoint is saved', () => {
    expect(
      engineReady({ engine: 'local', apiKeySource: 'none', apiEndpoint: LOCAL_SERVER }, 'missing')
    ).toEqual({ ready: false, notReadyReason: MODEL_NOT_READY_REASON })
  })

  it('is ready in the cloud with a key held anywhere, whatever the model or endpoint', () => {
    for (const state of ALL_STATES) {
      for (const apiEndpoint of [OPENAI, LOCAL_SERVER]) {
        expect(engineReady({ engine: 'cloud', apiKeySource: 'stored', apiEndpoint }, state).ready).toBe(
          true
        )
        expect(
          engineReady({ engine: 'cloud', apiKeySource: 'session', apiEndpoint }, state).ready
        ).toBe(true)
      }
    }
  })

  it('asks a cloud user for a key, not for the model, when the endpoint is OpenAI', () => {
    expect(
      engineReady({ engine: 'cloud', apiKeySource: 'none', apiEndpoint: OPENAI }, 'installed')
    ).toEqual({
      ready: false,
      notReadyReason: 'Add your API key in Settings before recording.'
    })
    expect(KEY_NOT_READY_REASON).toBe('Add your API key in Settings before recording.')
  })

  it('is ready with no key at all against an endpoint of the user’s own', () => {
    // whisper.cpp, Speaches or a corporate server may need no key, and only
    // the server can say whether it does.
    for (const state of ALL_STATES) {
      expect(
        engineReady({ engine: 'cloud', apiKeySource: 'none', apiEndpoint: LOCAL_SERVER }, state)
      ).toEqual({ ready: true, notReadyReason: null })
    }
    expect(
      engineReady(
        { engine: 'cloud', apiKeySource: 'none', apiEndpoint: 'https://api.groq.com/openai/v1' },
        'missing'
      ).ready
    ).toBe(true)
  })

  it('takes an endpoint of spaces for none, so OpenAI still asks for its key', () => {
    expect(
      engineReady({ engine: 'cloud', apiKeySource: 'none', apiEndpoint: '   ' }, 'installed')
    ).toEqual({ ready: false, notReadyReason: KEY_NOT_READY_REASON })
  })
})
