import { describe, expect, it } from 'vitest'
import { lightCleanup } from '../src/shared/cleanup'

describe('lightCleanup', () => {
  it('removes filler words', () => {
    expect(lightCleanup('um so I think uh we should ship it')).toBe(
      'So I think we should ship it'
    )
  })

  it('handles stretched fillers', () => {
    expect(lightCleanup('ummm hmmm this is fine')).toBe('This is fine')
  })

  it('does not eat real words that start with a filler', () => {
    expect(lightCleanup('The umbrella is uh blue')).toBe('The umbrella is blue')
    expect(lightCleanup('Humming along')).toBe('Humming along')
  })

  it('repairs spacing around punctuation', () => {
    expect(lightCleanup('Hello , world .Next sentence')).toBe('Hello, world. Next sentence')
  })

  it('collapses repeated punctuation', () => {
    // The collapsed full stop then counts as a sentence end, so "what" is
    // capitalised — the same rule the next test covers.
    expect(lightCleanup('Wait.. what,, really')).toBe('Wait. What, really')
  })

  it('capitalises the first letter and after sentence ends', () => {
    expect(lightCleanup('hello there. how are you? fine')).toBe('Hello there. How are you? Fine')
  })

  it('leaves leading punctuation in place while still capitalising', () => {
    expect(lightCleanup('"hello there"')).toBe('"Hello there"')
  })

  it('returns an empty string for filler-only input', () => {
    expect(lightCleanup('um uh erm')).toBe('')
    expect(lightCleanup('   ')).toBe('')
  })

  it('preserves non-Latin scripts', () => {
    expect(lightCleanup('  こんにちは  ')).toBe('こんにちは')
  })

  it('collapses runs of whitespace', () => {
    expect(lightCleanup('too     many     spaces')).toBe('Too many spaces')
  })
})
