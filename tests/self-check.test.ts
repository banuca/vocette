import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SELF_CHECK_FILE, SELF_CHECK_WORDS, selfCheckPasses, wordsOf } from '../src/main/engine/self-check'
import { decodeWav } from '../src/main/wav'

/**
 * The engine's check of itself must never fail a correct engine over a comma,
 * and must never pass one that garbles speech the way the q8 model did.
 */

describe('selfCheckPasses', () => {
  it("passes the released model's reading of the recording", () => {
    expect(
      selfCheckPasses('Ask not what your country can do for you, ask what you can do for your country.')
    ).toBe(true)
  })

  it('ignores case, punctuation and words in between', () => {
    expect(selfCheckPasses('ASK NOT — what YOUR country can do, for you?!')).toBe(true)
    expect(selfCheckPasses('And so, ask not, um, what your country can do for you')).toBe(true)
  })

  it('fails the q8 model’s garbled reading from the AMD runners', () => {
    expect(selfCheckPasses('Ask not what you’re comstrich and do for you…')).toBe(false)
    expect(selfCheckPasses("Ask not what you're comstrich and do for you...")).toBe(false)
  })

  it('fails nothing, other speech, and the right words in the wrong order', () => {
    expect(selfCheckPasses('')).toBe(false)
    expect(selfCheckPasses('Please send the ITUT draft to Kirinda before Friday.')).toBe(false)
    expect(selfCheckPasses('You for do can country your what not ask.')).toBe(false)
    expect(selfCheckPasses('Ask not what your country can do')).toBe(false)
  })

  it('splits text into lower-case words', () => {
    expect(wordsOf('Ask not, what YOUR country?')).toEqual(['ask', 'not', 'what', 'your', 'country'])
    expect(SELF_CHECK_WORDS).toEqual(['ask', 'not', 'what', 'your', 'country', 'can', 'do', 'for', 'you'])
  })
})

describe('the shipped recording', () => {
  const bytes = readFileSync(join(__dirname, '..', 'resources', SELF_CHECK_FILE))

  it('is the file whose making self-check.ts records', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '3b90f6d7920851cb8a1f01583a8ab526cf7a0f6c04b2f9a92ffb4444c18d4b50'
    )
  })

  it('is about three seconds of 16 kHz mono speech the app can read', () => {
    const wav = decodeWav(new Uint8Array(bytes))
    expect(wav?.sampleRate).toBe(16000)
    expect((wav?.samples.length ?? 0) / 16000).toBeCloseTo(3.23, 2)
    expect(wav?.samples.some((sample) => Math.abs(sample) > 0.1)).toBe(true)
  })
})
