import { describe, expect, it } from 'vitest'
import { assessSecureStorage } from '../src/main/secure-storage'

/**
 * Electron's safeStorage always encrypts something. On Linux without a
 * keyring, that "something" is a hard-coded key — obfuscation, not encryption.
 * Writing an API key there while calling it encrypted would be a lie, so this
 * has to come back unusable and the app offers a session-only key instead.
 */
describe('assessSecureStorage', () => {
  it('accepts a real OS backend', () => {
    const result = assessSecureStorage({
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret'
    })
    expect(result).toEqual({ usable: true, reason: '', backend: 'gnome_libsecret' })
  })

  it('accepts a platform that does not name a backend at all', () => {
    // Windows and macOS: DPAPI and the Keychain, with no backend selector.
    const result = assessSecureStorage({ isEncryptionAvailable: () => true })
    expect(result.usable).toBe(true)
    expect(result.backend).toBe('os')
  })

  it('refuses the plaintext fallback and explains what to do', () => {
    const result = assessSecureStorage({
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'basic_text'
    })
    expect(result.usable).toBe(false)
    expect(result.backend).toBe('basic_text')
    expect(result.reason).toContain('will not write the key to disk')
    expect(result.reason).toContain('session only')
  })

  it('refuses an unidentified backend rather than hoping', () => {
    expect(
      assessSecureStorage({
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'unknown'
      }).usable
    ).toBe(false)
  })

  it('refuses when there is no encryption at all', () => {
    const result = assessSecureStorage({ isEncryptionAvailable: () => false })
    expect(result).toEqual({
      usable: false,
      reason: expect.stringContaining('no working secure storage'),
      backend: 'none'
    })
  })

  it('treats a throwing probe as no encryption', () => {
    const result = assessSecureStorage({
      isEncryptionAvailable: () => {
        throw new Error('dbus unavailable')
      }
    })
    expect(result.usable).toBe(false)
  })

  it('treats a throwing backend selector as unidentified', () => {
    const result = assessSecureStorage({
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => {
        throw new Error('no session bus')
      }
    })
    expect(result).toMatchObject({ usable: false, backend: 'unknown' })
  })

  it('never puts key material in the assessment', () => {
    const result = assessSecureStorage({
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'kwallet6'
    })
    expect(JSON.stringify(result)).not.toMatch(/sk-/u)
  })
})
