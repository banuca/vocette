import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  refreshJsonRecoveryBackup,
  removeJsonRecoveryCopies,
  writeJsonAtomic
} from '../src/main/atomic-json'

/** safeStorage only exists inside Electron; a reversible stand-in is enough. */
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^enc:/u, '')
  }
}))

const { MAX_VOCABULARY_CHARS } = await import('../src/shared/vocabulary')
const { MAX_REPLACEMENTS_CHARS } = await import('../src/shared/replacements')
const { KEY } = await import('../src/shared/keycodes')
const { DEFAULT_SETTINGS, SETTINGS_VERSION, SettingsStore, normaliseSettings } = await import(
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
    expect(result.version).toBe(SETTINGS_VERSION)
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
    expect(store.getPublic().apiKeySource).toBe('stored')
    expect(store.getPublic().shortcut).toEqual({ keys: [KEY.Ctrl, KEY.Alt] })

    // Saving rewrites the file in the current shape without touching the key.
    store.update({ autoPaste: false })
    const written = JSON.parse(readFileSync(file, 'utf8'))
    expect(written.version).toBe(SETTINGS_VERSION)
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
    expect(store.getPublic().apiKeySource).toBe('stored')
    store.clearApiKey()
    expect(store.getPublic().apiKeySource).toBe('none')
  })

  it('does not recover a cleared API key from a backup when the primary becomes unreadable', () => {
    const store = new SettingsStore(file)
    store.update({ apiKey: 'sk-delete-me' })
    store.update({ autoPaste: false })
    expect(existsSync(`${file}.bak`)).toBe(true)
    writeFileSync(`${file}.tmp`, 'stale temporary copy')
    writeFileSync(`${file}.corrupt`, 'stale corrupt copy')

    store.clearApiKey()
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).encryptedApiKey).toBe('')
    expect(existsSync(`${file}.tmp`)).toBe(false)
    expect(existsSync(`${file}.corrupt`)).toBe(false)

    writeFileSync(file, 'not valid json')
    expect(new SettingsStore(file).getPublic().apiKeySource).toBe('none')
  })

  it('does not report an API-key deletion when persistence cleanup fails, and permits retry', () => {
    const seed = new SettingsStore(file)
    seed.update({ apiKey: 'sk-retryable-delete' })
    seed.update({ autoPaste: false })

    let cleanupFails = true
    const store = new SettingsStore(file, {
      writeJsonAtomic,
      removeJsonRecoveryCopies: (path) => {
        if (cleanupFails) throw new Error('injected cleanup failure')
        removeJsonRecoveryCopies(path)
      },
      refreshJsonRecoveryBackup
    })

    expect(() => store.clearApiKey()).toThrow('injected cleanup failure')
    expect(store.getPublic().apiKeySource).toBe('stored')

    cleanupFails = false
    expect(store.clearApiKey().apiKeySource).toBe('none')
  })

  it('does not report an API-key deletion when the write fails, and permits retry', () => {
    const seed = new SettingsStore(file)
    seed.update({ apiKey: 'sk-write-failure' })

    let writeFails = true
    const store = new SettingsStore(file, {
      writeJsonAtomic: (path, value) => {
        if (writeFails) throw new Error('injected write failure')
        writeJsonAtomic(path, value)
      },
      removeJsonRecoveryCopies,
      refreshJsonRecoveryBackup
    })

    expect(() => store.clearApiKey()).toThrow('injected write failure')
    expect(store.getPublic().apiKeySource).toBe('stored')

    writeFails = false
    expect(store.clearApiKey().apiKeySource).toBe('none')
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

describe('v3 → v4 migration', () => {
  it('gives a settings file with no recording mode the hold default', () => {
    const v3 = { ...DEFAULT_SETTINGS, version: 3 } as Record<string, unknown>
    delete v3.recordingMode
    expect(normaliseSettings(v3).recordingMode).toBe('hold')
  })

  it('keeps a recording mode it recognises and rejects one it does not', () => {
    expect(normaliseSettings({ recordingMode: 'toggle' }).recordingMode).toBe('toggle')
    expect(normaliseSettings({ recordingMode: 'voice-activated' }).recordingMode).toBe('hold')
  })

  it('stores the preference exactly as chosen, whatever the platform can do', () => {
    const store = new SettingsStore(file)
    expect(store.update({ recordingMode: 'toggle' }).recordingMode).toBe('toggle')
    expect(new SettingsStore(file).getPublic().recordingMode).toBe('toggle')
  })
})

describe('v4 → v5 migration', () => {
  it('gives a settings file with no theme the dark default', () => {
    const v4 = { ...DEFAULT_SETTINGS, version: 4 } as Record<string, unknown>
    delete v4.theme
    expect(normaliseSettings(v4).theme).toBe('dark')
  })

  it('keeps a theme it recognises and rejects one it does not', () => {
    expect(normaliseSettings({ theme: 'light' }).theme).toBe('light')
    expect(normaliseSettings({ theme: 'solarized' }).theme).toBe('dark')
  })

  it('survives a restart, because a theme is a setting and not a browser cache', () => {
    const store = new SettingsStore(file)
    expect(store.update({ theme: 'light' }).theme).toBe('light')
    expect(new SettingsStore(file).getPublic().theme).toBe('light')
  })
})

describe('cleanup switches', () => {
  /** A v5 file written before the two switches existed. */
  const withoutSwitches = (): Record<string, unknown> => {
    const v5 = { ...DEFAULT_SETTINGS, removeFillers: false } as Record<string, unknown>
    delete v5.spokenCorrections
    delete v5.spokenFormatting
    return v5
  }

  it('are on for a fresh install', () => {
    expect(DEFAULT_SETTINGS.spokenCorrections).toBe(true)
    expect(DEFAULT_SETTINGS.spokenFormatting).toBe(true)
    const store = new SettingsStore(file)
    expect(store.getPublic().spokenCorrections).toBe(true)
    expect(store.getPublic().spokenFormatting).toBe(true)
  })

  it('default to on when an existing file predates them', () => {
    const loaded = normaliseSettings(withoutSwitches())
    expect(loaded.spokenCorrections).toBe(true)
    expect(loaded.spokenFormatting).toBe(true)
    // The switch that was already there keeps its saved value.
    expect(loaded.removeFillers).toBe(false)
    expect(loaded.version).toBe(SETTINGS_VERSION)

    writeFileSync(file, JSON.stringify(withoutSwitches(), null, 2))
    const store = new SettingsStore(file)
    expect(store.getPublic().spokenCorrections).toBe(true)
    expect(store.getPublic().spokenFormatting).toBe(true)
    expect(store.getPublic().removeFillers).toBe(false)
  })

  it('ignore a value that is not a boolean on the load path', () => {
    const loaded = normaliseSettings({ spokenCorrections: 'no', spokenFormatting: 0 })
    expect(loaded.spokenCorrections).toBe(true)
    expect(loaded.spokenFormatting).toBe(true)
  })

  it('persist false and survive a reload', () => {
    const store = new SettingsStore(file)
    const saved = store.update({ spokenCorrections: false, spokenFormatting: false })
    expect(saved.spokenCorrections).toBe(false)
    expect(saved.spokenFormatting).toBe(false)

    const written = JSON.parse(readFileSync(file, 'utf8'))
    expect(written.spokenCorrections).toBe(false)
    expect(written.spokenFormatting).toBe(false)

    const reopened = new SettingsStore(file)
    expect(reopened.getPublic().spokenCorrections).toBe(false)
    expect(reopened.getPublic().spokenFormatting).toBe(false)
    expect(reopened.getInternal().spokenCorrections).toBe(false)
    expect(reopened.getInternal().spokenFormatting).toBe(false)
  })

  it('are saved independently, and left alone by an update that does not mention them', () => {
    const store = new SettingsStore(file)
    store.update({ spokenCorrections: false })
    expect(store.getPublic().spokenCorrections).toBe(false)
    expect(store.getPublic().spokenFormatting).toBe(true)

    const after = store.update({ playSounds: false })
    expect(after.spokenCorrections).toBe(false)
    expect(after.spokenFormatting).toBe(true)

    store.update({ spokenCorrections: true, spokenFormatting: false })
    const reopened = new SettingsStore(file).getPublic()
    expect(reopened.spokenCorrections).toBe(true)
    expect(reopened.spokenFormatting).toBe(false)
  })

  it('ignore a value that is not a boolean on save', () => {
    const store = new SettingsStore(file)
    store.update({ spokenCorrections: 'no' as unknown as boolean })
    expect(store.getPublic().spokenCorrections).toBe(true)
  })
})

describe('API keys where secure storage is unfit', () => {
  const unusable = { usable: false, reason: 'No keyring here.', backend: 'basic_text' }

  it('refuses to write a key to disk, and says why', () => {
    const store = new SettingsStore(file, {}, unusable)
    expect(() => store.update({ apiKey: 'sk-plain' })).toThrow('No keyring here.')
    expect(store.getPublic().apiKeySource).toBe('none')
    expect(existsSync(file) ? readFileSync(file, 'utf8') : '').not.toContain('sk-plain')
  })

  it('accepts a session key, uses it, and never writes it anywhere', () => {
    const store = new SettingsStore(file, {}, unusable)
    expect(store.update({ apiKey: 'sk-session', apiKeyScope: 'session' }).apiKeySource).toBe(
      'session'
    )
    expect(store.getApiKey()).toBe('sk-session')
    expect(readFileSync(file, 'utf8')).not.toContain('sk-session')
    // Gone with the process: a new store sees no key at all.
    expect(new SettingsStore(file, {}, unusable).getPublic().apiKeySource).toBe('none')
  })

  it('reports the storage problem without leaking anything about the key', () => {
    const store = new SettingsStore(file, {}, unusable)
    store.update({ apiKey: 'sk-session', apiKeyScope: 'session' })
    expect(JSON.stringify(store.keyStorage())).not.toContain('sk-session')
  })
})

describe('session keys alongside a stored key', () => {
  it('prefers the session key and falls back when it is forgotten', () => {
    const store = new SettingsStore(file)
    store.update({ apiKey: 'sk-stored' })
    expect(store.getApiKey()).toBe('sk-stored')

    store.update({ apiKey: 'sk-temporary', apiKeyScope: 'session' })
    expect(store.getPublic().apiKeySource).toBe('session')
    expect(store.getApiKey()).toBe('sk-temporary')

    expect(store.clearSessionApiKey().apiKeySource).toBe('stored')
    expect(store.getApiKey()).toBe('sk-stored')
  })

  it('a stored key replaces the session key rather than hiding behind it', () => {
    const store = new SettingsStore(file)
    store.update({ apiKey: 'sk-temporary', apiKeyScope: 'session' })
    store.update({ apiKey: 'sk-stored' })
    expect(store.getPublic().apiKeySource).toBe('stored')
    expect(store.getApiKey()).toBe('sk-stored')
  })

  it('clearing everything removes both', () => {
    const store = new SettingsStore(file)
    store.update({ apiKey: 'sk-stored' })
    store.update({ apiKey: 'sk-temporary', apiKeyScope: 'session' })
    expect(store.clearApiKey().apiKeySource).toBe('none')
    expect(store.getApiKey()).toBe('')
  })
})

describe('transcription engine', () => {
  /** A v5 file written before the engine choice existed. */
  const withoutEngine = (overrides: Record<string, unknown> = {}): Record<string, unknown> => {
    const v5 = { ...DEFAULT_SETTINGS, ...overrides } as Record<string, unknown>
    delete v5.engine
    return v5
  }

  it('starts a fresh install on this PC', () => {
    expect(DEFAULT_SETTINGS.engine).toBe('local')
    expect(new SettingsStore(file).getPublic().engine).toBe('local')
    expect(normaliseSettings(null).engine).toBe('local')
  })

  it('keeps an existing user with a saved key on the cloud that works for them', () => {
    const loaded = normaliseSettings(withoutEngine({ encryptedApiKey: 'ZW5jOnNrLXRlc3Q=' }))
    expect(loaded.engine).toBe('cloud')
    // Nothing else about the file changes.
    expect(loaded.encryptedApiKey).toBe('ZW5jOnNrLXRlc3Q=')

    writeFileSync(file, JSON.stringify(withoutEngine({ encryptedApiKey: 'ZW5jOnNrLXRlc3Q=' })))
    const store = new SettingsStore(file)
    expect(store.getPublic().engine).toBe('cloud')
    expect(store.getApiKey()).toBe('sk-test')
  })

  it('moves an existing user without a saved key to this PC', () => {
    expect(normaliseSettings(withoutEngine()).engine).toBe('local')
    expect(normaliseSettings(withoutEngine({ encryptedApiKey: '' })).engine).toBe('local')
    // A key held for the session only was never on disk to be seen here.
    writeFileSync(file, JSON.stringify(withoutEngine({ removeFillers: false })))
    expect(new SettingsStore(file).getPublic().engine).toBe('local')
  })

  it('keeps a stored choice it recognises, even against the key rule', () => {
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, engine: 'cloud' }).engine).toBe('cloud')
    expect(
      normaliseSettings({ ...DEFAULT_SETTINGS, engine: 'local', encryptedApiKey: 'ZW5jOnNrLXRlc3Q=' })
        .engine
    ).toBe('local')
  })

  it('treats a stored value it does not recognise as absent', () => {
    expect(normaliseSettings(withoutEngine({ engine: 'gpu' })).engine).toBe('local')
    expect(
      normaliseSettings({ ...DEFAULT_SETTINGS, engine: 42, encryptedApiKey: 'ZW5jOnNrLXRlc3Q=' }).engine
    ).toBe('cloud')
  })

  it('saves a choice, which survives a restart', () => {
    const store = new SettingsStore(file)
    expect(store.update({ engine: 'cloud' }).engine).toBe('cloud')
    expect(JSON.parse(readFileSync(file, 'utf8')).engine).toBe('cloud')
    expect(new SettingsStore(file).getPublic().engine).toBe('cloud')
    expect(store.update({ engine: 'local' }).engine).toBe('local')
    expect(new SettingsStore(file).getInternal().engine).toBe('local')
  })

  it('ignores an engine it does not know on save', () => {
    const store = new SettingsStore(file)
    store.update({ engine: 'cloud' })
    store.update({ engine: 'gpu' as unknown as 'local' })
    expect(store.getPublic().engine).toBe('cloud')
  })

  it('leaves the choice alone when an update does not mention it', () => {
    const store = new SettingsStore(file)
    store.update({ engine: 'cloud' })
    expect(store.update({ playSounds: false }).engine).toBe('cloud')
  })

  it('writes the migrated choice with the next save, so it no longer depends on the key', () => {
    writeFileSync(file, JSON.stringify(withoutEngine({ encryptedApiKey: 'ZW5jOnNrLXRlc3Q=' })))
    const store = new SettingsStore(file)
    store.clearApiKey()
    // Clearing the key must not quietly move the user to a model they lack.
    expect(new SettingsStore(file).getPublic().engine).toBe('cloud')
  })
})

describe('vocabulary', () => {
  it('defaults to empty when the settings file predates the field', () => {
    const v5 = {
      version: 5,
      shortcut: { keys: [KEY.Ctrl, KEY.Shift] },
      holdDelayMs: 250,
      recordingMode: 'hold',
      hotkeyEnabled: true,
      autoPaste: true,
      removeFillers: true,
      playSounds: true,
      launchAtLogin: false,
      theme: 'light',
      microphoneId: 'mic-7',
      historyRetentionDays: 90,
      model: 'whisper-1',
      language: 'de',
      apiEndpoint: '',
      encryptedApiKey: 'ZW5jOnNrLXRlc3Q='
    }
    const result = normaliseSettings(v5)
    expect(result.vocabulary).toBe('')
    // Every other value survives: adding the field must not disturb the file.
    expect(result.theme).toBe('light')
    expect(result.microphoneId).toBe('mic-7')
    expect(result.historyRetentionDays).toBe(90)
    expect(result.model).toBe('whisper-1')
    expect(result.language).toBe('de')
    expect(result.encryptedApiKey).toBe('ZW5jOnNrLXRlc3Q=')
  })

  it('ignores a non-string value on the load path', () => {
    expect(normaliseSettings({ vocabulary: ['Kirinde'] }).vocabulary).toBe('')
    expect(normaliseSettings({ vocabulary: 42 }).vocabulary).toBe('')
    expect(normaliseSettings({ vocabulary: null }).vocabulary).toBe('')
  })

  it('clamps an over-long stored value rather than discarding it', () => {
    const raw = `${'x'.repeat(30)}\n`.repeat(200)
    const result = normaliseSettings({ vocabulary: raw })
    expect(result.vocabulary.length).toBeLessThanOrEqual(MAX_VOCABULARY_CHARS)
    expect(result.vocabulary.length).toBeGreaterThan(0)
    // Cut on a line boundary: no half-term may reach a request.
    for (const term of result.vocabulary.split('\n')) expect(term).toBe('x'.repeat(30))
  })

  it('keeps nothing rather than half a term when one line overruns the ceiling', () => {
    const raw = 'x'.repeat(MAX_VOCABULARY_CHARS + 500)
    expect(normaliseSettings({ vocabulary: raw }).vocabulary).toBe('')
  })

  it('saves a multi-line list and reads it back after a restart', () => {
    const store = new SettingsStore(file, {
      writeJsonAtomic,
      removeJsonRecoveryCopies,
      refreshJsonRecoveryBackup
    })
    const list = 'Kirinde\nITU-T\nDataverse'
    const saved = store.update({ vocabulary: list })
    expect(saved.vocabulary).toBe(list)

    const reopened = new SettingsStore(file, {
      writeJsonAtomic,
      removeJsonRecoveryCopies,
      refreshJsonRecoveryBackup
    })
    expect(reopened.getPublic().vocabulary).toBe(list)
    expect(reopened.getInternal().vocabulary).toBe(list)
  })

  it('clamps on save without throwing, as the other free-text fields do', () => {
    const store = new SettingsStore(file, {
      writeJsonAtomic,
      removeJsonRecoveryCopies,
      refreshJsonRecoveryBackup
    })
    const saved = store.update({ vocabulary: `${'y'.repeat(25)}\n`.repeat(200) })
    expect(saved.vocabulary.length).toBeLessThanOrEqual(MAX_VOCABULARY_CHARS)
    for (const term of saved.vocabulary.split('\n')) expect(term).toBe('y'.repeat(25))
  })

  it('leaves the list alone when an update does not mention it', () => {
    const store = new SettingsStore(file, {
      writeJsonAtomic,
      removeJsonRecoveryCopies,
      refreshJsonRecoveryBackup
    })
    store.update({ vocabulary: 'Kirinde' })
    const after = store.update({ playSounds: false })
    expect(after.vocabulary).toBe('Kirinde')
    expect(after.playSounds).toBe(false)
  })

  it('can be emptied again', () => {
    const store = new SettingsStore(file, {
      writeJsonAtomic,
      removeJsonRecoveryCopies,
      refreshJsonRecoveryBackup
    })
    store.update({ vocabulary: 'Kirinde' })
    expect(store.update({ vocabulary: '' }).vocabulary).toBe('')
  })

  it('is defaulted empty', () => {
    expect(DEFAULT_SETTINGS.vocabulary).toBe('')
  })
})

describe('replacements', () => {
  it('default to empty, for a fresh install and for a file that predates the field', () => {
    expect(DEFAULT_SETTINGS.replacements).toBe('')
    expect(new SettingsStore(file).getPublic().replacements).toBe('')

    const v5 = { ...DEFAULT_SETTINGS, vocabulary: 'Kirinde', theme: 'light' } as Record<
      string,
      unknown
    >
    delete v5.replacements
    const result = normaliseSettings(v5)
    expect(result.replacements).toBe('')
    // Adding the field must not disturb anything else in the file.
    expect(result.vocabulary).toBe('Kirinde')
    expect(result.theme).toBe('light')
    expect(result.version).toBe(SETTINGS_VERSION)
  })

  it('ignore a value that is not a string on the load path', () => {
    expect(normaliseSettings({ replacements: ['itu => ITU'] }).replacements).toBe('')
    expect(normaliseSettings({ replacements: 42 }).replacements).toBe('')
    expect(normaliseSettings({ replacements: null }).replacements).toBe('')
  })

  it('are clamped on a line boundary on the load path, not discarded', () => {
    const rule = 'my email => name@example.com'
    const result = normaliseSettings({ replacements: `${rule}\n`.repeat(1000) })
    expect(result.replacements.length).toBeLessThanOrEqual(MAX_REPLACEMENTS_CHARS)
    expect(result.replacements.length).toBeGreaterThan(0)
    // Half a rule would still parse, and paste half an address.
    for (const line of result.replacements.split('\n')) expect(line).toBe(rule)
  })

  it('keep nothing rather than half a rule when one line overruns the ceiling', () => {
    const raw = `sign off => ${'x'.repeat(MAX_REPLACEMENTS_CHARS)}`
    expect(normaliseSettings({ replacements: raw }).replacements).toBe('')
  })

  it('are saved exactly as typed and read back after a restart', () => {
    const store = new SettingsStore(file)
    // Verbatim: `\n` stays the two characters typed until a dictation parses it.
    const list =
      "itu => ITU\r\nsign off => Best regards,\\nAlex\n# a comment\ntoday's date => {date}"
    expect(store.update({ replacements: list }).replacements).toBe(list)
    expect(JSON.parse(readFileSync(file, 'utf8')).replacements).toBe(list)

    const reopened = new SettingsStore(file)
    expect(reopened.getPublic().replacements).toBe(list)
    expect(reopened.getInternal().replacements).toBe(list)
  })

  it('are clamped on a line boundary on save, without throwing', () => {
    const store = new SettingsStore(file)
    const rule = 'console log => console.log()'
    const saved = store.update({ replacements: `${rule}\n`.repeat(1000) })
    expect(saved.replacements.length).toBeLessThanOrEqual(MAX_REPLACEMENTS_CHARS)
    expect(saved.replacements.length).toBeGreaterThan(0)
    for (const line of saved.replacements.split('\n')) expect(line).toBe(rule)
    // What was clamped is what persisted.
    expect(new SettingsStore(file).getPublic().replacements).toBe(saved.replacements)
  })

  it('are left alone by an update that does not mention them', () => {
    const store = new SettingsStore(file)
    store.update({ replacements: 'itu => ITU' })
    const after = store.update({ vocabulary: 'Kirinde' })
    expect(after.replacements).toBe('itu => ITU')
    expect(after.vocabulary).toBe('Kirinde')
  })

  it('ignore a value that is not a string on save', () => {
    const store = new SettingsStore(file)
    store.update({ replacements: 'itu => ITU' })
    store.update({ replacements: 42 as unknown as string })
    expect(store.getPublic().replacements).toBe('itu => ITU')
  })

  it('can be emptied again, and stay empty after a restart', () => {
    const store = new SettingsStore(file)
    store.update({ replacements: 'itu => ITU' })
    expect(store.update({ replacements: '' }).replacements).toBe('')
    expect(new SettingsStore(file).getPublic().replacements).toBe('')
  })
})
