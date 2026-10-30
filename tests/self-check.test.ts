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
    expect(selfCheckPasses('It is a truth universally acknowledged.')).toBe(true)
  })

  it('ignores case, punctuation and words in between', () => {
    expect(selfCheckPasses('IT IS — a truth, universally ACKNOWLEDGED?!')).toBe(true)
    expect(selfCheckPasses('Well, it is, um, a truth universally acknowledged that')).toBe(true)
  })

  it('fails a reading with any of its words garbled', () => {
    // Made up, in the way the q8 model garbled the previous recording on the
    // AMD runners ("Ask not what you’re comstrich and do for you…"): most
    // words right, one or two turned into near misses.
    expect(selfCheckPasses('It is a true universally acknowledged.')).toBe(false)
    expect(selfCheckPasses('It is a truth universal acknowledged.')).toBe(false)
    expect(selfCheckPasses('It is a truth universally acknowledge…')).toBe(false)
    expect(selfCheckPasses('It is a tooth you never sleep knowledge.')).toBe(false)
  })

  it('fails nothing, other speech, and the right words in the wrong order', () => {
    expect(selfCheckPasses('')).toBe(false)
    expect(selfCheckPasses('Please send the ITUT draft to Kirinda before Friday.')).toBe(false)
    expect(selfCheckPasses('Acknowledged universally truth a is it.')).toBe(false)
    expect(selfCheckPasses('It is a truth universally')).toBe(false)
    // The recording this one replaced.
    expect(selfCheckPasses('Ask not what your country can do for you.')).toBe(false)
  })

  it('splits text into lower-case words', () => {
    expect(wordsOf('It is, a TRUTH?')).toEqual(['it', 'is', 'a', 'truth'])
    expect(SELF_CHECK_WORDS).toEqual(['it', 'is', 'a', 'truth', 'universally', 'acknowledged'])
  })
})

describe('the shipped recording', () => {
  const bytes = readFileSync(join(__dirname, '..', 'resources', SELF_CHECK_FILE))

  it('is the file whose source and making resources/self-check.md records', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '71e41bf591c73affb142e0124e64a72724f8fec7231fd0bceda392298f5d507a'
    )
  })

  it('is about two seconds of 16 kHz mono speech the app can read', () => {
    const wav = decodeWav(new Uint8Array(bytes))
    expect(wav?.sampleRate).toBe(16000)
    expect((wav?.samples.length ?? 0) / 16000).toBeCloseTo(2.17, 2)
    expect(wav?.samples.some((sample) => Math.abs(sample) > 0.1)).toBe(true)
  })
})
