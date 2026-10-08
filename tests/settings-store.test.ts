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

  it('names exactly the fields the renderer may see, and no others', () => {
    // An allow-list: a field added to the stored settings must not cross into
    // the window until it is added here on purpose, and one added here must
    // exist in the public shape.
    const store = new SettingsStore(file)
    store.update({ apiKey: 'sk-listed', vocabulary: 'Kirinde', replacements: 'itu => ITU' })
    expect(Object.keys(store.getPublic()).sort()).toEqual(
      [
        'engine',
        'shortcut',
        'holdDelayMs',
        'recordingMode',
        'hotkeyEnabled',
        'instantCapture',
        'autoPaste',
        'restoreClipboard',
        'pasteLastShortcut',
        'removeFillers',
        'spokenCorrections',
        'spokenFormatting',
        'playSounds',
        'launchAtLogin',
        'theme',
        'microphoneId',
        'historyRetentionDays',
        'model',
        'language',
        'vocabulary',
        'replacements',
        'apiEndpoint',
        'apiKeySource',
        'polish'
      ].sort()
    )
  })

  it('hands out a copy of the shortcut, not the stored chord itself', () => {
    const store = new SettingsStore(file)
    store.getPublic().shortcut.keys.push(KEY.A)
    expect(store.getPublic().shortcut).toEqual({ keys: [KEY.Ctrl, KEY.Shift] })
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
  it('gives a settings file with no theme the follow-Windows default', () => {
    const v4 = { ...DEFAULT_SETTINGS, version: 4 } as Record<string, unknown>
    delete v4.theme
    expect(normaliseSettings(v4).theme).toBe('system')
  })

  it('keeps a theme it recognises and rejects one it does not', () => {
    expect(normaliseSettings({ theme: 'light' }).theme).toBe('light')
    expect(normaliseSettings({ theme: 'solarized' }).theme).toBe('system')
    expect(normaliseSettings({ theme: 'dark' }).theme).toBe('dark')
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

describe('clipboard switches', () => {
  /** A v5 file written before "Put my clipboard back" and Alt + Shift + V existed. */
  const withoutSwitches = (): Record<string, unknown> => {
    const v5 = { ...DEFAULT_SETTINGS, autoPaste: false } as Record<string, unknown>
    delete v5.restoreClipboard
    delete v5.pasteLastShortcut
    return v5
  }

  it('are on for a fresh install', () => {
    expect(DEFAULT_SETTINGS.restoreClipboard).toBe(true)
    expect(DEFAULT_SETTINGS.pasteLastShortcut).toBe(true)
    const store = new SettingsStore(file)
    expect(store.getPublic().restoreClipboard).toBe(true)
    expect(store.getPublic().pasteLastShortcut).toBe(true)
  })

  it('default to on when an existing file predates them', () => {
    const loaded = normaliseSettings(withoutSwitches())
    expect(loaded.restoreClipboard).toBe(true)
    expect(loaded.pasteLastShortcut).toBe(true)
    // What the file did say survives: adding the fields disturbs nothing.
    expect(loaded.autoPaste).toBe(false)
    expect(loaded.version).toBe(SETTINGS_VERSION)

    writeFileSync(file, JSON.stringify(withoutSwitches(), null, 2))
    const store = new SettingsStore(file)
    expect(store.getInternal().restoreClipboard).toBe(true)
    expect(store.getInternal().pasteLastShortcut).toBe(true)
    expect(store.getInternal().autoPaste).toBe(false)
  })

  it('ignore a value that is not a boolean on the load path', () => {
    const loaded = normaliseSettings({ restoreClipboard: 'no', pasteLastShortcut: 0 })
    expect(loaded.restoreClipboard).toBe(true)
    expect(loaded.pasteLastShortcut).toBe(true)
  })

  it('persist false and survive a reload', () => {
    const store = new SettingsStore(file)
    const saved = store.update({ restoreClipboard: false, pasteLastShortcut: false })
    expect(saved.restoreClipboard).toBe(false)
    expect(saved.pasteLastShortcut).toBe(false)

    const written = JSON.parse(readFileSync(file, 'utf8'))
    expect(written.restoreClipboard).toBe(false)
    expect(written.pasteLastShortcut).toBe(false)

    const reopened = new SettingsStore(file)
    expect(reopened.getPublic().restoreClipboard).toBe(false)
    expect(reopened.getPublic().pasteLastShortcut).toBe(false)
    expect(reopened.getInternal().restoreClipboard).toBe(false)
    expect(reopened.getInternal().pasteLastShortcut).toBe(false)
  })

  it('are saved independently, and left alone by an update that does not mention them', () => {
    const store = new SettingsStore(file)
    store.update({ restoreClipboard: false })
    expect(store.getPublic().restoreClipboard).toBe(false)
    expect(store.getPublic().pasteLastShortcut).toBe(true)

    const after = store.update({ autoPaste: false })
    expect(after.restoreClipboard).toBe(false)
    expect(after.pasteLastShortcut).toBe(true)

    store.update({ restoreClipboard: true, pasteLastShortcut: false })
    const reopened = new SettingsStore(file).getPublic()
    expect(reopened.restoreClipboard).toBe(true)
    expect(reopened.pasteLastShortcut).toBe(false)
  })

  it('ignore a value that is not a boolean on save', () => {
    const store = new SettingsStore(file)
    store.update({
      restoreClipboard: 'no' as unknown as boolean,
      pasteLastShortcut: 1 as unknown as boolean
    })
    expect(store.getPublic().restoreClipboard).toBe(true)
    expect(store.getPublic().pasteLastShortcut).toBe(true)
  })
})

describe('listening from the keypress', () => {
  /** A v5 file written before "Start listening as soon as the shortcut is held" existed. */
  const withoutSwitch = (): Record<string, unknown> => {
    const v5 = { ...DEFAULT_SETTINGS, hotkeyEnabled: false } as Record<string, unknown>
    delete v5.instantCapture
    return v5
  }

  it('is on for a fresh install', () => {
    expect(DEFAULT_SETTINGS.instantCapture).toBe(true)
    expect(new SettingsStore(file).getPublic().instantCapture).toBe(true)
    expect(normaliseSettings(null).instantCapture).toBe(true)
  })

  it('defaults to on when an existing file predates it', () => {
    const loaded = normaliseSettings(withoutSwitch())
    expect(loaded.instantCapture).toBe(true)
    // What the file did say survives: adding the field disturbs nothing.
    expect(loaded.hotkeyEnabled).toBe(false)
    expect(loaded.version).toBe(SETTINGS_VERSION)

    writeFileSync(file, JSON.stringify(withoutSwitch(), null, 2))
    const store = new SettingsStore(file)
    expect(store.getInternal().instantCapture).toBe(true)
    expect(store.getPublic().instantCapture).toBe(true)
    expect(store.getInternal().hotkeyEnabled).toBe(false)
  })

  it('keeps a stored false, and ignores a value that is not a boolean on the load path', () => {
    expect(normaliseSettings({ instantCapture: false }).instantCapture).toBe(false)
    expect(normaliseSettings({ instantCapture: 'no' }).instantCapture).toBe(true)
    expect(normaliseSettings({ instantCapture: 0 }).instantCapture).toBe(true)
  })

  it('persists false and survives a reload', () => {
    const store = new SettingsStore(file)
    expect(store.update({ instantCapture: false }).instantCapture).toBe(false)
    expect(JSON.parse(readFileSync(file, 'utf8')).instantCapture).toBe(false)

    const reopened = new SettingsStore(file)
    expect(reopened.getPublic().instantCapture).toBe(false)
    expect(reopened.getInternal().instantCapture).toBe(false)

    reopened.update({ instantCapture: true })
    expect(new SettingsStore(file).getInternal().instantCapture).toBe(true)
  })

  it('is left alone by an update that does not mention it, and ignores a non-boolean on save', () => {
    const store = new SettingsStore(file)
    store.update({ instantCapture: false })
    expect(store.update({ hotkeyEnabled: false }).instantCapture).toBe(false)
    store.update({ instantCapture: 'yes' as unknown as boolean })
    expect(store.getPublic().instantCapture).toBe(false)
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
    const raw = `${'x'.repeat(30)}\n`.repeat(Math.ceil(MAX_VOCABULARY_CHARS / 31) + 200)
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
    const saved = store.update({
      vocabulary: `${'y'.repeat(25)}\n`.repeat(Math.ceil(MAX_VOCABULARY_CHARS / 26) + 200)
    })
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

describe('the Pro trial', () => {
  const T0 = Date.parse('2026-09-25T09:00:00.000Z')
  const clock = (at: number) => ({ now: () => at })
  const usable = { usable: true, reason: '', backend: 'os' }

  it('starts on the first load and is written straight away', () => {
    const store = new SettingsStore(file, {}, usable, clock(T0))
    expect(store.getInternal().trialStartedAt).toBe('2026-09-25T09:00:00.000Z')
    expect(JSON.parse(readFileSync(file, 'utf8')).trialStartedAt).toBe('2026-09-25T09:00:00.000Z')
  })

  it('is set once: a later launch keeps the first date', () => {
    new SettingsStore(file, {}, usable, clock(T0))
    const later = new SettingsStore(file, {}, usable, clock(T0 + 12 * 86_400_000))
    expect(later.getInternal().trialStartedAt).toBe('2026-09-25T09:00:00.000Z')
    later.update({ playSounds: false })
    expect(JSON.parse(readFileSync(file, 'utf8')).trialStartedAt).toBe('2026-09-25T09:00:00.000Z')
  })

  it('starts for an existing user on their first launch of this version, changing nothing else', () => {
    const before = { ...DEFAULT_SETTINGS, theme: 'light', vocabulary: 'Kirinde' } as Record<
      string,
      unknown
    >
    delete before.trialStartedAt
    delete before.trialEndNoticeDismissed
    delete before.deviceTag
    delete before.licence
    writeFileSync(file, JSON.stringify(before))

    const store = new SettingsStore(file, {}, usable, clock(T0))
    expect(store.getInternal().trialStartedAt).toBe('2026-09-25T09:00:00.000Z')
    const written = JSON.parse(readFileSync(file, 'utf8'))
    expect(written.trialStartedAt).toBe('2026-09-25T09:00:00.000Z')
    expect(written.theme).toBe('light')
    expect(written.vocabulary).toBe('Kirinde')
    expect(written.version).toBe(SETTINGS_VERSION)
  })

  it('starts again from now when the stored date cannot be read', () => {
    expect(normaliseSettings({ trialStartedAt: 'last Tuesday' }).trialStartedAt).toBeNull()
    expect(normaliseSettings({ trialStartedAt: 42 }).trialStartedAt).toBeNull()
    writeFileSync(file, JSON.stringify({ ...DEFAULT_SETTINGS, trialStartedAt: 'garbage' }))
    const store = new SettingsStore(file, {}, usable, clock(T0))
    expect(store.getInternal().trialStartedAt).toBe('2026-09-25T09:00:00.000Z')
  })

  it('keeps a readable stored date exactly as written', () => {
    const stored = '2026-08-01T10:00:00.000Z'
    expect(normaliseSettings({ trialStartedAt: stored }).trialStartedAt).toBe(stored)
  })

  it('still opens when the first write fails, and the next save writes the date', () => {
    let fail = true
    const store = new SettingsStore(
      file,
      {
        writeJsonAtomic: (path, value) => {
          if (fail) throw new Error('disk full')
          writeJsonAtomic(path, value)
        }
      },
      usable,
      clock(T0)
    )
    expect(store.getInternal().trialStartedAt).toBe('2026-09-25T09:00:00.000Z')
    expect(existsSync(file)).toBe(false)
    fail = false
    store.update({ playSounds: false })
    expect(JSON.parse(readFileSync(file, 'utf8')).trialStartedAt).toBe('2026-09-25T09:00:00.000Z')
  })
})

describe('the device tag', () => {
  const usable = { usable: true, reason: '', backend: 'os' }

  it('is four upper-case hexadecimal characters, made once and kept', () => {
    const store = new SettingsStore(file)
    const tag = store.getInternal().deviceTag
    expect(tag).toMatch(/^[0-9A-F]{4}$/u)
    expect(JSON.parse(readFileSync(file, 'utf8')).deviceTag).toBe(tag)
    expect(new SettingsStore(file).getInternal().deviceTag).toBe(tag)
  })

  it('uses the tag it is given, and replaces a stored one that is not a tag', () => {
    const tagged = new SettingsStore(file, {}, usable, { newDeviceTag: () => '7F3A' })
    expect(tagged.getInternal().deviceTag).toBe('7F3A')
    expect(normaliseSettings({ deviceTag: '7f3a' }).deviceTag).toBe('')
    expect(normaliseSettings({ deviceTag: 'ZZZZ' }).deviceTag).toBe('')
    expect(normaliseSettings({ deviceTag: 1234 }).deviceTag).toBe('')
    expect(normaliseSettings({ deviceTag: 'BEEF' }).deviceTag).toBe('BEEF')
  })
})

describe('the trial-end notice', () => {
  it('is not dismissed on a fresh install or in a file that predates it', () => {
    expect(DEFAULT_SETTINGS.trialEndNoticeDismissed).toBe(false)
    expect(new SettingsStore(file).getInternal().trialEndNoticeDismissed).toBe(false)
    expect(normaliseSettings({ version: 5 }).trialEndNoticeDismissed).toBe(false)
  })

  it('is dismissed through a settings update, for good, and survives a restart', () => {
    const store = new SettingsStore(file)
    store.update({ trialEndNoticeDismissed: true })
    expect(store.getInternal().trialEndNoticeDismissed).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8')).trialEndNoticeDismissed).toBe(true)
    expect(new SettingsStore(file).getInternal().trialEndNoticeDismissed).toBe(true)

    // Once dismissed, nothing brings it back.
    store.update({ trialEndNoticeDismissed: false })
    expect(store.getInternal().trialEndNoticeDismissed).toBe(true)
  })

  it('ignores anything but true, on both paths', () => {
    const store = new SettingsStore(file)
    store.update({ trialEndNoticeDismissed: 'yes' as unknown as boolean })
    expect(store.getInternal().trialEndNoticeDismissed).toBe(false)
    expect(normaliseSettings({ trialEndNoticeDismissed: 'true' }).trialEndNoticeDismissed).toBe(false)
    expect(normaliseSettings({ trialEndNoticeDismissed: 1 }).trialEndNoticeDismissed).toBe(false)
    expect(normaliseSettings({ trialEndNoticeDismissed: true }).trialEndNoticeDismissed).toBe(true)
  })

  it('is left alone by an update that does not mention it', () => {
    const store = new SettingsStore(file)
    store.update({ trialEndNoticeDismissed: true })
    store.update({ vocabulary: 'Kirinde' })
    expect(new SettingsStore(file).getInternal().trialEndNoticeDismissed).toBe(true)
  })
})

describe('the update check', () => {
  it('is off on a fresh install and in a file that predates it', () => {
    expect(DEFAULT_SETTINGS.updateCheck).toBe(false)
    expect(new SettingsStore(file).getInternal().updateCheck).toBe(false)
    expect(normaliseSettings({ version: 5 }).updateCheck).toBe(false)
    expect(normaliseSettings({ version: 5 }).lastUpdateCheckAt).toBeNull()
  })

  it('is switched on only by a real true, and survives a restart', () => {
    for (const value of ['true', 1, 'yes', null]) {
      expect(normaliseSettings({ updateCheck: value }).updateCheck).toBe(false)
    }
    const store = new SettingsStore(file)
    store.setUpdateCheck(true)
    expect(JSON.parse(readFileSync(file, 'utf8')).updateCheck).toBe(true)
    expect(new SettingsStore(file).getInternal().updateCheck).toBe(true)
    store.setUpdateCheck(false)
    expect(new SettingsStore(file).getInternal().updateCheck).toBe(false)
  })

  it('remembers when it last ran, and keeps only a readable date', () => {
    const store = new SettingsStore(file)
    store.setLastUpdateCheck('2026-09-28T10:00:00.000Z')
    expect(new SettingsStore(file).getInternal().lastUpdateCheckAt).toBe('2026-09-28T10:00:00.000Z')
    store.setLastUpdateCheck('not a date')
    expect(store.getInternal().lastUpdateCheckAt).toBe('2026-09-28T10:00:00.000Z')
    expect(normaliseSettings({ lastUpdateCheckAt: 'soon' }).lastUpdateCheckAt).toBeNull()
    expect(normaliseSettings({ lastUpdateCheckAt: 42 }).lastUpdateCheckAt).toBeNull()
  })

  it('is not changed by an ordinary settings save, and never reaches the window', () => {
    const store = new SettingsStore(file)
    store.setUpdateCheck(true)
    store.update({ vocabulary: 'Kirinde', updateCheck: false } as never)
    expect(store.getInternal().updateCheck).toBe(true)
    expect(store.getPublic()).not.toHaveProperty('updateCheck')
    expect(store.getPublic()).not.toHaveProperty('lastUpdateCheckAt')
  })
})

describe('AI polish', () => {
  it('is off with the OpenAI preset on a fresh install, and in a file that predates it', () => {
    const polish = new SettingsStore(file).getPublic().polish
    expect(polish).toEqual({
      enabled: false,
      style: 'clean',
      instructions: '',
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      budgetMs: 4000,
      keySource: 'none'
    })
    expect(normaliseSettings({ version: 5 }).polishEnabled).toBe(false)
  })

  it('saves each field, and survives a restart', () => {
    const store = new SettingsStore(file)
    store.update({
      polish: {
        enabled: true,
        style: 'notes',
        instructions: 'British spelling.',
        endpoint: 'http://localhost:11434/v1',
        model: 'llama3.2:3b',
        budgetMs: 8000
      }
    })
    expect(new SettingsStore(file).getPublic().polish).toEqual({
      enabled: true,
      style: 'notes',
      instructions: 'British spelling.',
      endpoint: 'http://localhost:11434/v1',
      model: 'llama3.2:3b',
      budgetMs: 8000,
      keySource: 'none'
    })
  })

  it('leaves the rest alone when one field is saved', () => {
    const store = new SettingsStore(file)
    store.update({ polish: { style: 'casual' } })
    expect(store.getPublic().polish).toMatchObject({ style: 'casual', enabled: false, budgetMs: 4000 })
  })

  it('ignores a style or a wait it does not know, and clamps the instructions', () => {
    const store = new SettingsStore(file)
    store.update({
      polish: {
        style: 'shouty' as never,
        budgetMs: 3000 as never,
        instructions: 'x'.repeat(600)
      }
    })
    const polish = store.getPublic().polish
    expect(polish.style).toBe('clean')
    expect(polish.budgetMs).toBe(4000)
    expect(polish.instructions).toHaveLength(500)
    expect(normaliseSettings({ polishStyle: 'shouty', polishBudgetMs: 1 }).polishStyle).toBe('clean')
    expect(normaliseSettings({ polishEnabled: 'true' }).polishEnabled).toBe(false)
  })

  it('refuses an endpoint or model it cannot use, and says so', () => {
    const store = new SettingsStore(file)
    expect(() => store.update({ polish: { endpoint: 'http://llm.example.com/v1' } })).toThrow(
      'That polish endpoint is not valid.'
    )
    expect(() => store.update({ polish: { endpoint: '' } })).toThrow('That polish endpoint is not valid.')
    expect(() => store.update({ polish: { model: 'two words' } })).toThrow(
      'That polish model name is not valid.'
    )
    // An empty model is allowed: it means one has not been chosen yet.
    store.update({ polish: { endpoint: 'http://localhost:1234/v1', model: '' } })
    expect(store.getPublic().polish).toMatchObject({ endpoint: 'http://localhost:1234/v1', model: '' })
    expect(normaliseSettings({ polishEndpoint: 'ftp://x' }).polishEndpoint).toBe('https://api.openai.com/v1')
  })

  it('keeps its key encrypted, out of the window, and apart from the transcription key', () => {
    const store = new SettingsStore(file)
    store.update({ apiKey: 'sk-transcribe', polishKey: 'sk-polish' })
    expect(store.getPublic().polish.keySource).toBe('stored')
    expect(JSON.stringify(store.getPublic())).not.toContain('sk-polish')
    expect(JSON.stringify(store.getInternal())).not.toContain('sk-polish')
    expect(readFileSync(file, 'utf8')).not.toContain('sk-polish')
    expect(store.getPolishKey()).toBe('sk-polish')
    expect(store.getApiKey()).toBe('sk-transcribe')
    expect(new SettingsStore(file).getPolishKey()).toBe('sk-polish')
  })

  it('forgets the key on request, and scrubs the recovery copies', () => {
    const removeCopies = vi.fn(removeJsonRecoveryCopies)
    const refreshBackup = vi.fn(refreshJsonRecoveryBackup)
    const store = new SettingsStore(file, {
      writeJsonAtomic,
      removeJsonRecoveryCopies: removeCopies,
      refreshJsonRecoveryBackup: refreshBackup
    })
    store.update({ polishKey: 'sk-polish' })
    expect(store.clearPolishKey().polish.keySource).toBe('none')
    expect(store.getPolishKey()).toBe('')
    expect(removeCopies).toHaveBeenCalled()
    expect(refreshBackup).toHaveBeenCalled()
  })

  it('will not write its key where secure storage is unfit', () => {
    const store = new SettingsStore(file, {}, { usable: false, reason: 'No keyring here.', backend: 'basic_text' })
    expect(() => store.update({ polishKey: 'sk-plain' })).toThrow('No keyring here.')
    expect(store.getPublic().polish.keySource).toBe('none')
  })
})

describe('the licence', () => {
  const KEY_TEXT = 'MURMUR-1C285B2D-6CE6-4BC7-B8BE-ADB6A7E304DA'
  const activated = {
    key: KEY_TEXT,
    activationId: 'b6724bc8-7ad9-4ca0-b143-7c896fcbb6fe',
    benefitId: '32a8eda4-56cf-4a94-8228-792d324a519e',
    displayKey: '****-E304DA',
    activatedAt: '2026-09-25T13:48:13.251Z'
  }
  const unusable = { usable: false, reason: 'No keyring here.', backend: 'basic_text' }

  it('is kept encrypted where the system can hold it, and read back for a release', () => {
    const store = new SettingsStore(file)
    store.saveLicence(activated)
    const onDisk = readFileSync(file, 'utf8')
    expect(onDisk).not.toContain(KEY_TEXT)
    const written = JSON.parse(onDisk)
    expect(written.licence.keyStorage).toBe('encrypted')
    expect(written.licence.activationId).toBe(activated.activationId)

    const reopened = new SettingsStore(file)
    expect(reopened.getLicenceKey()).toBe(KEY_TEXT)
    expect(reopened.licenceRecord()).toEqual({
      activationId: activated.activationId,
      benefitId: activated.benefitId,
      displayKey: '****-E304DA',
      activatedAt: '2026-09-25T13:48:13.251Z',
      // Activation is Polar confirming the subscription.
      subscription: 'active',
      confirmedAt: '2026-09-25T13:48:13.251Z'
    })
  })

  it('is kept as typed, and says so, where the system has no secure storage', () => {
    const store = new SettingsStore(file, {}, unusable)
    store.saveLicence(activated)
    const written = JSON.parse(readFileSync(file, 'utf8'))
    expect(written.licence.keyStorage).toBe('plain')
    expect(written.licence.encryptedKey).toBe(KEY_TEXT)
    expect(new SettingsStore(file, {}, unusable).getLicenceKey()).toBe(KEY_TEXT)
  })

  it('never reaches the public settings or the internal ones', () => {
    const store = new SettingsStore(file, {}, unusable)
    store.saveLicence(activated)
    const shown = JSON.stringify(store.getPublic())
    expect(shown).not.toContain(KEY_TEXT)
    expect(shown).not.toContain(activated.activationId)
    expect(shown).not.toContain('licence')
    expect(shown).not.toContain('trialStartedAt')
    expect(shown).not.toContain('deviceTag')
    expect(shown).not.toContain('trialEndNoticeDismissed')
    expect('licence' in store.getInternal()).toBe(false)
    expect(JSON.stringify(store.getInternal())).not.toContain(KEY_TEXT)
    expect(JSON.stringify(store.licenceRecord())).not.toContain(KEY_TEXT)
  })

  it('says in a sentence when an encrypted key cannot be read back', async () => {
    const { safeStorage } = await import('electron')
    const store = new SettingsStore(file)
    store.saveLicence(activated)
    const decrypt = vi.spyOn(safeStorage, 'decryptString').mockImplementation(() => {
      throw new Error('DPAPI refused')
    })
    try {
      expect(() => store.getLicenceKey()).toThrow(
        'The saved licence key could not be read on this PC, so it cannot be released from here.'
      )
    } finally {
      decrypt.mockRestore()
    }
  })

  it('is forgotten on this PC, recovery copies and all, and settles the trial notice', () => {
    const store = new SettingsStore(file, {}, unusable)
    store.saveLicence(activated)
    store.update({ autoPaste: false })
    writeFileSync(`${file}.tmp`, 'stale temporary copy')
    writeFileSync(`${file}.corrupt`, 'stale corrupt copy')

    store.clearLicence()
    expect(store.licenceRecord()).toBeNull()
    expect(() => store.getLicenceKey()).toThrow()
    expect(store.getInternal().trialEndNoticeDismissed).toBe(true)
    expect(readFileSync(file, 'utf8')).not.toContain(KEY_TEXT)
    expect(readFileSync(`${file}.bak`, 'utf8')).not.toContain(KEY_TEXT)
    expect(existsSync(`${file}.tmp`)).toBe(false)
    expect(existsSync(`${file}.corrupt`)).toBe(false)
    expect(new SettingsStore(file, {}, unusable).licenceRecord()).toBeNull()
  })

  it('is untouched by settings saves', () => {
    const store = new SettingsStore(file)
    store.saveLicence(activated)
    store.update({ vocabulary: 'Kirinde', playSounds: false })
    expect(new SettingsStore(file).getLicenceKey()).toBe(KEY_TEXT)
  })

  it('is read back only when every field is there, on the load path', () => {
    const record = {
      encryptedKey: KEY_TEXT,
      keyStorage: 'plain',
      activationId: activated.activationId,
      benefitId: activated.benefitId,
      displayKey: '****-E304DA',
      activatedAt: activated.activatedAt
    }
    // A record from before subscriptions counts as confirmed when it was activated.
    expect(normaliseSettings({ licence: record }).licence).toEqual({
      ...record,
      subscription: 'active',
      confirmedAt: activated.activatedAt
    })
    expect(
      normaliseSettings({
        licence: { ...record, subscription: 'ended', confirmedAt: '2026-10-01T08:00:00.000Z' }
      }).licence
    ).toMatchObject({ subscription: 'ended', confirmedAt: '2026-10-01T08:00:00.000Z' })
    expect(
      normaliseSettings({ licence: { ...record, subscription: 'paused', confirmedAt: 'never' } }).licence
    ).toMatchObject({ subscription: 'active', confirmedAt: activated.activatedAt })
    expect(normaliseSettings({}).licence).toBeNull()
    expect(normaliseSettings({ licence: 'MURMUR-KEY' }).licence).toBeNull()
    expect(normaliseSettings({ licence: { ...record, keyStorage: 'rot13' } }).licence).toBeNull()
    expect(normaliseSettings({ licence: { ...record, activationId: '' } }).licence).toBeNull()
    expect(normaliseSettings({ licence: { ...record, activatedAt: 'soon' } }).licence).toBeNull()
    const partial: Record<string, unknown> = { ...record }
    delete partial.benefitId
    expect(normaliseSettings({ licence: partial }).licence).toBeNull()
  })
})

describe('the subscription behind the licence', () => {
  const activated = {
    key: 'VOCETTE-1C285B2D-6CE6-4BC7-B8BE-ADB6A7E304DA',
    activationId: 'b6724bc8-7ad9-4ca0-b143-7c896fcbb6fe',
    benefitId: '32a8eda4-56cf-4a94-8228-792d324a519e',
    displayKey: '****-E304DA',
    activatedAt: '2026-09-25T13:48:13.251Z'
  }

  it('moves the confirmation on when a check finds it active, and survives a restart', () => {
    const store = new SettingsStore(file)
    store.saveLicence(activated)
    store.recordSubscriptionCheck('active', '2026-10-05T10:00:00.000Z')
    expect(new SettingsStore(file).licenceRecord()).toMatchObject({
      subscription: 'active',
      confirmedAt: '2026-10-05T10:00:00.000Z'
    })
  })

  it('keeps the key and the last confirmation when a check finds it ended', () => {
    const store = new SettingsStore(file)
    store.saveLicence(activated)
    store.recordSubscriptionCheck('ended', '2026-10-05T10:00:00.000Z')
    const reopened = new SettingsStore(file)
    expect(reopened.licenceRecord()).toMatchObject({
      subscription: 'ended',
      confirmedAt: activated.activatedAt
    })
    expect(reopened.getLicenceKey()).toBe(activated.key)
    // Subscribing again brings it straight back.
    reopened.recordSubscriptionCheck('active', '2026-10-06T10:00:00.000Z')
    expect(reopened.licenceRecord()?.subscription).toBe('active')
  })

  it('does nothing without a licence, or with a date it cannot read', () => {
    const store = new SettingsStore(file)
    store.recordSubscriptionCheck('active', '2026-10-05T10:00:00.000Z')
    expect(store.licenceRecord()).toBeNull()
    store.saveLicence(activated)
    store.recordSubscriptionCheck('active', 'later')
    expect(store.licenceRecord()?.confirmedAt).toBe(activated.activatedAt)
  })
})
