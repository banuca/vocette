import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** safeStorage only exists inside Electron; a reversible stand-in is enough. */
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^enc:/u, '')
  }
}))

const { KEY } = await import('../src/shared/keycodes')
const { DEFAULT_SETTINGS, SettingsStore, normaliseSettings } = await import(
  '../src/main/settings-store'
)

let directory: string
let file: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'vh-settings-'))
  file = join(directory, 'settings.json')
})

describe('v1 → v2 migration', () => {
  /** Shaped exactly like the settings.json written by the 0.1.0 build. */
  const v1 = {
    version: 1,
    shortcut: 'left-control-left-alt',
    autoPaste: true,
    removeFillers: true,
    launchAtLogin: false,
    microphoneId: '',
    historyRetentionDays: 0,
    model: 'gpt-transcribe',
    language: 'en',
    encryptedApiKey: 'ZW5jOnNrLXRlc3Q='
  }

  it('turns the preset id into keycodes', () => {
    const result = normaliseSettings(v1)
    expect(result.version).toBe(3)
    expect(result.shortcut).toEqual({ keys: [KEY.Ctrl, KEY.Alt] })
  })

  it('never drops the encrypted API key', () => {
    expect(normaliseSettings(v1).encryptedApiKey).toBe('ZW5jOnNrLXRlc3Q=')
  })

  it('keeps the other v1 values and fills in the new ones', () => {
    const result = normaliseSettings({ ...v1, autoPaste: false, historyRetentionDays: 90 })
    expect(result.autoPaste).toBe(false)
    expect(result.historyRetentionDays).toBe(90)
    expect(result.holdDelayMs).toBe(DEFAULT_SETTINGS.holdDelayMs)
    expect(result.hotkeyEnabled).toBe(true)
  })

  it('maps each legacy preset', () => {
    expect(normaliseSettings({ ...v1, shortcut: 'right-control' }).shortcut).toEqual({
      keys: [KEY.CtrlRight]
    })
    expect(normaliseSettings({ ...v1, shortcut: 'control-alt-space' }).shortcut).toEqual({
      keys: [KEY.Ctrl, KEY.Alt, KEY.Space]
    })
  })

  it('survives a real migration through the store, key intact', () => {
    writeFileSync(file, JSON.stringify(v1, null, 2))
    const store = new SettingsStore(file)
    expect(store.getApiKey()).toBe('sk-test')
    expect(store.getPublic().apiKeyConfigured).toBe(true)
    expect(store.getPublic().shortcut).toEqual({ keys: [KEY.Ctrl, KEY.Alt] })

    // Saving rewrites the file in the v2 shape without touching the key.
    store.update({ autoPaste: false })
    const written = JSON.parse(readFileSync(file, 'utf8'))
    expect(written.version).toBe(3)
    expect(written.encryptedApiKey).toBe('ZW5jOnNrLXRlc3Q=')
    expect(new SettingsStore(file).getApiKey()).toBe('sk-test')
  })
})

describe('validation', () => {
  it('defaults to Left Ctrl + Left Shift for a fresh install', () => {
    const store = new SettingsStore(file)
    expect(store.getPublic().shortcut).toEqual({ keys: [KEY.Ctrl, KEY.Shift] })
  })

  it('falls back to the default when a stored chord is no longer allowed', () => {
    // A bare Left Ctrl would fire on every Ctrl shortcut.
    expect(normaliseSettings({ version: 2, shortcut: { keys: [KEY.Ctrl] } }).shortcut).toEqual({
      keys: [KEY.Ctrl, KEY.Shift]
    })
  })

  it('rejects an unusable chord on save', () => {
    const store = new SettingsStore(file)
    expect(() => store.update({ shortcut: { keys: [KEY.A] } })).toThrow()
    expect(store.getPublic().shortcut).toEqual({ keys: [KEY.Ctrl, KEY.Shift] })
  })

  it('accepts a custom chord on save', () => {
    const store = new SettingsStore(file)
    const result = store.update({ shortcut: { keys: [KEY.Ctrl, KEY.Space] } })
    expect(result.shortcut).toEqual({ keys: [KEY.Ctrl, KEY.Space] })
  })

  it('persists model and language, which v0.1.0 silently discarded', () => {
    const stored = normaliseSettings({ version: 2, model: 'whisper-1', language: 'fr' })
    expect(stored.model).toBe('whisper-1')
    expect(stored.language).toBe('fr')

    const store = new SettingsStore(file)
    expect(store.update({ model: 'gpt-4o-transcribe', language: 'de' }).model).toBe(
      'gpt-4o-transcribe'
    )
    expect(new SettingsStore(file).getPublic().language).toBe('de')
  })

  it('ignores an unknown model or malformed language', () => {
    const stored = normaliseSettings({ version: 2, model: 'pirate-9000', language: 'english' })
    expect(stored.model).toBe(DEFAULT_SETTINGS.model)
    expect(stored.language).toBe(DEFAULT_SETTINGS.language)
  })

  it('only accepts offered hold delays and retention periods', () => {
    const store = new SettingsStore(file)
    store.update({ holdDelayMs: 9999, historyRetentionDays: 7 })
    expect(store.getPublic().holdDelayMs).toBe(DEFAULT_SETTINGS.holdDelayMs)
    expect(store.getPublic().historyRetentionDays).toBe(0)
    store.update({ holdDelayMs: 400, historyRetentionDays: 365 })
    expect(store.getPublic().holdDelayMs).toBe(400)
    expect(store.getPublic().historyRetentionDays).toBe(365)
  })

  it('persists the sound preference and defaults it to on', () => {
    const store = new SettingsStore(file)
    expect(store.getPublic().playSounds).toBe(true)
    store.update({ playSounds: false })
    expect(store.getPublic().playSounds).toBe(false)
    expect(new SettingsStore(file).getPublic().playSounds).toBe(false)
    expect(normaliseSettings({ playSounds: false }).playSounds).toBe(false)
    expect(normaliseSettings({ playSounds: 'yes' }).playSounds).toBe(true)
  })

  it('validates API endpoints', () => {
    const store = new SettingsStore(file)
    store.update({ apiEndpoint: 'https://api.groq.com/openai/v1' })
    expect(store.getPublic().apiEndpoint).toBe('https://api.groq.com/openai/v1')

    // Local transcription servers may use plain http.
    store.update({ apiEndpoint: 'http://127.0.0.1:8080/v1' })
    expect(store.getPublic().apiEndpoint).toBe('http://127.0.0.1:8080/v1')

    expect(() => store.update({ apiEndpoint: 'ftp://example.com/v1' })).toThrow()
    expect(() => store.update({ apiEndpoint: 'not a url' })).toThrow()
    // Remote endpoints must be https — plain http would leak the API key.
    expect(() => store.update({ apiEndpoint: 'http://api.groq.com/v1' })).toThrow()
    // A rejected endpoint must not clobber the saved one.
    expect(store.getPublic().apiEndpoint).toBe('http://127.0.0.1:8080/v1')
  })

  it('allows a custom model name only against a custom endpoint', () => {
    const store = new SettingsStore(file)
    expect(() => store.update({ model: 'whisper-large-v3' })).toThrow()

    store.update({ apiEndpoint: 'http://localhost:8080/v1' })
    store.update({ model: 'whisper-large-v3' })
    expect(store.getPublic().model).toBe('whisper-large-v3')
    expect(new SettingsStore(file).getPublic().model).toBe('whisper-large-v3')

    // Malformed names are still rejected, even with an endpoint.
    expect(() => store.update({ model: 'has spaces' })).toThrow()
    // Clearing the endpoint falls back to a known model.
    store.update({ apiEndpoint: '' })
    expect(store.getPublic().model).toBe(DEFAULT_SETTINGS.model)
  })

  it('rejects an absurdly long API key', () => {
    const store = new SettingsStore(file)
    expect(() => store.update({ apiKey: 'x'.repeat(600) })).toThrow()
  })

  it('never exposes the key through the public shape', () => {
    const store = new SettingsStore(file)
    store.update({ apiKey: 'sk-secret' })
    expect(JSON.stringify(store.getPublic())).not.toContain('sk-secret')
    expect(store.getPublic().apiKeyConfigured).toBe(true)
    store.clearApiKey()
    expect(store.getPublic().apiKeyConfigured).toBe(false)
  })
})

describe('damaged files', () => {
  it('reports a problem instead of silently resetting', () => {
    writeFileSync(file, '{ "version": 2, "shortcut"')
    const store = new SettingsStore(file)
    expect(store.takeWarning()).toBeTruthy()
    // And the damaged original is kept rather than overwritten.
    expect(() => readFileSync(`${file}.corrupt`, 'utf8')).not.toThrow()
  })

  it('recovers the API key from the backup', () => {
    const store = new SettingsStore(file)
    store.update({ apiKey: 'sk-live' })
    store.update({ autoPaste: false }) // creates settings.json.bak
    writeFileSync(file, 'not json at all')

    const recovered = new SettingsStore(file)
    expect(recovered.takeWarning()).toContain('recovered')
    expect(recovered.getApiKey()).toBe('sk-live')
  })
})
