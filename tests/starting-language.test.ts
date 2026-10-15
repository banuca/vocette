import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^enc:/u, '')
  }
}))

const { startingLanguage } = await import('../src/shared/starting-language')
const { SettingsStore } = await import('../src/main/settings-store')

describe('the language a new profile starts in', () => {
  it("is the system's own when the model hears it", () => {
    expect(startingLanguage(['fr-CH', 'en-GB'])).toBe('fr')
    expect(startingLanguage(['de'])).toBe('de')
    expect(startingLanguage(['pt-BR'])).toBe('pt')
  })

  it("passes over a language the on-device model cannot hear, to the next one it can", () => {
    expect(startingLanguage(['ja-JP', 'es-ES'])).toBe('es')
  })

  it('is English otherwise', () => {
    expect(startingLanguage(['ja-JP'])).toBe('en')
    // Norwegian is offered for the cloud, but the on-device model does not hear it.
    expect(startingLanguage(['nb-NO'])).toBe('en')
    expect(startingLanguage(['zh-Hans-CN', 'ar'])).toBe('en')
    // Heard by the model, but not offered in Settings: English, so the dropdown can show it.
    expect(startingLanguage(['et-EE'])).toBe('en')
    expect(startingLanguage([])).toBe('en')
  })

  it('applies only to a profile with nothing on disk', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vh-language-'))
    const fresh = new SettingsStore(join(directory, 'new.json'), {}, undefined, {
      systemLanguages: () => ['it-IT']
    })
    expect(fresh.getPublic().language).toBe('it')

    const existing = join(directory, 'existing.json')
    writeFileSync(existing, JSON.stringify({ version: 5, language: 'en' }))
    const kept = new SettingsStore(existing, {}, undefined, { systemLanguages: () => ['it-IT'] })
    expect(kept.getPublic().language).toBe('en')
  })

  it('stays English if the system cannot say', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vh-language-'))
    const store = new SettingsStore(join(directory, 'new.json'), {}, undefined, {
      systemLanguages: () => {
        throw new Error('no locale')
      }
    })
    expect(store.getPublic().language).toBe('en')
  })
})
