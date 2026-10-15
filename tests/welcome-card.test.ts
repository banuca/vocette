import { describe, expect, it } from 'vitest'
import { welcomeSystemName } from '../src/renderer/welcome-card'

describe('the first-run card', () => {
  it('names the system Vocette starts with', () => {
    expect(welcomeSystemName('windows', true)).toBe('Windows')
    expect(welcomeSystemName('macos', true)).toBe('macOS')
    expect(welcomeSystemName('linux', true)).toBe('your computer')
  })

  it('leaves the question out where the platform cannot start Vocette at sign-in', () => {
    expect(welcomeSystemName('windows', false)).toBeNull()
    expect(welcomeSystemName('unknown', false)).toBeNull()
  })
})
