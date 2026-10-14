import { describe, expect, it } from 'vitest'
import { OWN_NAME_MISHEARINGS, withOwnName, withOwnNameRules } from '../src/shared/own-name'
import { PRODUCT_NAME } from '../src/shared/product'
import { applyReplacements, parseReplacements } from '../src/shared/replacements'
import { correctVocabulary } from '../src/shared/vocabulary-correction'

describe("the app's own name", () => {
  it('is a term in every dictation, after the user’s own', () => {
    expect(withOwnName([])).toEqual([PRODUCT_NAME])
    expect(withOwnName(['Kirinde', 'ITU-T'])).toEqual(['Kirinde', 'ITU-T', PRODUCT_NAME])
  })

  it('is not added twice when the user already listed it', () => {
    expect(withOwnName(['vocette', 'ITU'])).toEqual(['vocette', 'ITU'])
  })

  it('fixes the on-device mishearing the owner heard', () => {
    // 15 Oct 2026, the 0.6.4 hand test: "typed by using Vocette" came back as "Voset".
    expect(applyReplacements('This sentence is typed by using Voset.', withOwnNameRules([]))).toBe(
      'This sentence is typed by using Vocette.'
    )
  })

  it('fixes every listed mishearing, whatever its case', () => {
    for (const heard of OWN_NAME_MISHEARINGS) {
      expect(applyReplacements(`I use ${heard.toLowerCase()} daily.`, withOwnNameRules([]))).toBe(
        'I use Vocette daily.'
      )
    }
  })

  it('leaves ordinary words alone', () => {
    const text = 'I set the vote, so the voice set is fine. Vosettes and Vocetta stay.'
    expect(applyReplacements(text, withOwnNameRules([]))).toBe(text)
  })

  it('lets a rule of the user’s own for the same word win', () => {
    const rules = withOwnNameRules(parseReplacements('voset => VOSET Ltd').rules)
    expect(applyReplacements('Ask Voset.', rules)).toBe('Ask VOSET Ltd.')
  })

  it('never takes a place in the user’s own rules', () => {
    const own = parseReplacements('itu => ITU').rules
    const rules = withOwnNameRules(own)
    expect(rules.slice(0, own.length)).toEqual(own)
    expect(own).toHaveLength(1)
  })

  it('gets its capital from the correction when heard in lower case', () => {
    const notCommon = (): boolean => false
    expect(correctVocabulary('Use vocette daily.', withOwnName([]), 'en', notCommon)).toBe(
      'Use Vocette daily.'
    )
  })
})
