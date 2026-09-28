import { describe, expect, it, vi } from 'vitest'
import { PARAKEET_V3 } from '../src/main/engine/models'
import {
  commandFailure,
  createModelRow,
  localLanguageNote,
  modelRowState,
  type ModelDownloadBridge
} from '../src/renderer/model-download'
import {
  REMOVE_WHILE_DICTATING,
  type EngineStatus,
  type ModelState,
  type ModelStatus
} from '../src/shared/engine'
import { LOCAL_MODEL_INFO } from '../src/shared/speech-model'
import { LANGUAGE_OPTIONS } from '../src/shared/types'

/**
 * The download row is the first thing a new user acts on, and History and
 * Settings both draw it from `modelRowState`. These cases are what it
 * promises in each state the main process can report.
 */

const TOTAL = 670_478_772

function status(state: ModelState, patch: Partial<ModelStatus> = {}): EngineStatus {
  return {
    engine: 'local',
    model: {
      id: 'parakeet-tdt-0.6b-v3-int8',
      state,
      receivedBytes: state === 'installed' ? TOTAL : 0,
      totalBytes: TOTAL,
      error: null,
      ...patch
    },
    ready: state === 'installed',
    notReadyReason: state === 'installed' ? null : 'Download the speech model first.'
  }
}

describe('modelRowState', () => {
  it('names the model and its size from the manifest', () => {
    const row = modelRowState(status('missing'))
    expect(row.name).toBe('Parakeet v3 · 25 European languages')
    expect(row.size).toBe('670 MB')
  })

  it('offers the download when nothing is on disk', () => {
    expect(modelRowState(status('missing'))).toMatchObject({
      badge: 'Not downloaded',
      badgeTone: 'idle',
      downloadLabel: 'Download',
      progress: null,
      detail: null,
      cancelVisible: false,
      removeVisible: false
    })
  })

  it('counts the download in megabytes, with a way to stop it', () => {
    const row = modelRowState(status('downloading', { receivedBytes: 412_000_000 }))
    expect(row.detail).toBe('412 of 670 MB')
    expect(row.badge).toBe('Downloading · 61%')
    expect(row.badgeTone).toBe('busy')
    expect(row.progress).toBeCloseTo(412_000_000 / TOTAL, 6)
    expect(row.cancelVisible).toBe(true)
    // One download at a time: there is nothing to start while it runs.
    expect(row.downloadLabel).toBeNull()
    expect(row.removeVisible).toBe(false)
  })

  it('never claims 100% before the last byte is in', () => {
    const row = modelRowState(status('downloading', { receivedBytes: TOTAL - 1 }))
    expect(row.badge).toBe('Downloading · 99%')
    expect(row.progress).toBeLessThan(1)
  })

  it('says it is checking while what is already here is verified', () => {
    const row = modelRowState(status('verifying', { receivedBytes: 200_000_000 }))
    expect(row.detail).toBe('Checking the download…')
    expect(row.detailIsError).toBe(false)
    expect(row.cancelVisible).toBe(true)
    expect(row.progress).toBeGreaterThan(0)
  })

  it('reads Ready once installed, and offers to remove it', () => {
    expect(modelRowState(status('installed'))).toMatchObject({
      badge: 'Ready',
      badgeTone: 'ready',
      downloadLabel: null,
      cancelVisible: false,
      removeVisible: true,
      removeEnabled: true,
      note: null,
      progress: null
    })
  })

  it('will not remove the model mid-dictation, and says why', () => {
    const row = modelRowState(status('installed'), true)
    expect(row.removeVisible).toBe(true)
    expect(row.removeEnabled).toBe(false)
    expect(row.note).toBe(REMOVE_WHILE_DICTATING)
  })

  it('shows a failure in its own words, with Try again', () => {
    const error = 'Could not reach the download server. Check your internet connection.'
    expect(modelRowState(status('failed', { error }))).toMatchObject({
      badge: 'Download failed',
      badgeTone: 'failed',
      detail: error,
      detailIsError: true,
      downloadLabel: 'Try again'
    })
  })

  it('still explains a failure that arrives without a reason', () => {
    expect(modelRowState(status('failed')).detail).toBe('The download failed. Try again.')
  })

  it('offers to resume a download that was stopped part-way', () => {
    expect(modelRowState(status('partial'))).toMatchObject({
      badge: 'Partly downloaded',
      downloadLabel: 'Resume download',
      removeVisible: false
    })
  })

  it('does not divide by zero if the size is ever unknown', () => {
    const row = modelRowState(status('downloading', { totalBytes: 0 }))
    expect(row.progress).toBe(0)
    expect(row.badge).toBe('Downloading · 0%')
  })
})

describe('localLanguageNote', () => {
  it('says the setting only tunes cleanup for a language the model knows', () => {
    expect(localLanguageNote('fr')).toEqual({
      text: 'The on-device model recognises its 25 languages by itself; this setting only tunes cleanup.',
      warning: false
    })
    expect(localLanguageNote('auto').warning).toBe(false)
  })

  it('warns, by name, about a language the model cannot recognise', () => {
    expect(localLanguageNote('ja')).toEqual({
      text: 'Parakeet does not support Japanese. Choose Cloud for Japanese.',
      warning: true
    })
  })

  it('warns for exactly the offered languages the manifest leaves out', () => {
    const warned = LANGUAGE_OPTIONS.filter((option) => localLanguageNote(option.code).warning).map(
      (option) => option.code
    )
    expect(warned).toEqual(['ar', 'zh', 'he', 'hi', 'id', 'ja', 'ko', 'no', 'th', 'tr', 'vi'])
  })
})

describe('the model facts the window shows', () => {
  it('are the ones the download manifest carries', () => {
    expect(PARAKEET_V3.displayName).toBe(LOCAL_MODEL_INFO.displayName)
    expect(PARAKEET_V3.languages).toEqual(LOCAL_MODEL_INFO.languages)
    expect(PARAKEET_V3.attribution).toBe(LOCAL_MODEL_INFO.attribution)
    expect(PARAKEET_V3.totalBytes).toBe(TOTAL)
  })
})

describe('commandFailure', () => {
  it("unwraps Electron's invoke error to the main process's own sentence", () => {
    const wrapped = new Error(
      `Error invoking remote method 'engine:remove-model': Error: ${REMOVE_WHILE_DICTATING}`
    )
    expect(commandFailure(wrapped)).toBe(REMOVE_WHILE_DICTATING)
  })

  it('keeps a plain error as it is, and explains a missing one', () => {
    expect(commandFailure(new Error('Forbidden.'))).toBe('Forbidden.')
    expect(commandFailure(undefined)).toBe('That did not work. Try again.')
  })
})

/** Just enough of an element for the row to draw into and be clicked. */
class FakeElement {
  textContent: string | null = ''
  hidden = false
  disabled = false
  className = ''
  readonly style = { width: '' }
  readonly attributes = new Map<string, string>()
  private readonly listeners: Array<() => void> = []

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener)
  }

  click(): void {
    if (this.disabled) return
    this.listeners.forEach((listener) => listener())
  }
}

/** A host that holds only the parts its markup actually has. */
class FakeHost {
  innerHTML = ''
  private readonly parts = new Map<string, FakeElement>()

  querySelector(selector: string): FakeElement | null {
    const name = /^\[data-model="([a-z]+)"\]$/u.exec(selector)?.[1]
    if (!name || !this.innerHTML.includes(`data-model="${name}"`)) return null
    const existing = this.parts.get(name)
    if (existing) return existing
    const created = new FakeElement()
    this.parts.set(name, created)
    return created
  }

  at(name: string): FakeElement {
    const element = this.querySelector(`[data-model="${name}"]`)
    if (!element) throw new Error(`the row has no ${name}`)
    return element
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

const flush = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve))

function makeBridge(overrides: Partial<ModelDownloadBridge> = {}) {
  return {
    downloadModel: vi.fn(overrides.downloadModel ?? (async () => status('downloading'))),
    cancelModelDownload: vi.fn(overrides.cancelModelDownload ?? (async () => status('partial'))),
    removeModel: vi.fn(overrides.removeModel ?? (async () => status('missing')))
  }
}

function settingsRow(bridge = makeBridge(), confirm = vi.fn(() => true)) {
  const host = new FakeHost()
  const onStatus = vi.fn<(status: EngineStatus) => void>()
  const view = createModelRow(host as unknown as HTMLElement, {
    variant: 'settings',
    bridge,
    onStatus,
    confirm
  })
  return { host, view, bridge, onStatus, confirm }
}

describe('createModelRow in Settings', () => {
  it('draws the state it is given', () => {
    const { host, view } = settingsRow()
    view.apply(status('missing'))
    expect(host.at('name').textContent).toBe('Parakeet v3 · 25 European languages')
    expect(host.at('size').textContent).toBe('670 MB')
    expect(host.at('badge').textContent).toBe('Not downloaded')
    expect(host.at('download').textContent).toBe('Download')
    expect(host.at('download').hidden).toBe(false)
    expect(host.at('cancel').hidden).toBe(true)
    expect(host.at('remove').hidden).toBe(true)
    expect(host.at('progress').hidden).toBe(true)
  })

  it('starts the download and hands the answer on at once', async () => {
    const { host, view, bridge, onStatus } = settingsRow()
    view.apply(status('missing'))
    host.at('download').click()
    await flush()
    expect(bridge.downloadModel).toHaveBeenCalledTimes(1)
    expect(onStatus).toHaveBeenCalledWith(status('downloading'))
    expect(host.at('download').hidden).toBe(true)
    expect(host.at('cancel').hidden).toBe(false)
  })

  it('follows the progress it is sent, bar and count together', () => {
    const { host, view } = settingsRow()
    view.apply(status('downloading', { receivedBytes: 412_000_000 }))
    expect(host.at('progress').hidden).toBe(false)
    expect(host.at('bar').style.width).toBe('61%')
    expect(host.at('progress').attributes.get('aria-valuenow')).toBe('61')
    expect(host.at('detail').textContent).toBe('412 of 670 MB')
    expect(host.at('badge').textContent).toBe('Downloading · 61%')
    // Read out on every tick, the count would drown everything else.
    expect(host.at('detail').attributes.get('aria-live')).toBe('off')
    view.apply(status('failed', { error: 'The download was damaged. Try again.' }))
    expect(host.at('detail').attributes.get('aria-live')).toBe('polite')
  })

  it('cancels a running download', async () => {
    const { host, view, bridge } = settingsRow()
    view.apply(status('downloading', { receivedBytes: 1 }))
    host.at('cancel').click()
    await flush()
    expect(bridge.cancelModelDownload).toHaveBeenCalledTimes(1)
    expect(host.at('download').textContent).toBe('Resume download')
  })

  it('disables its buttons while a command is on its way', async () => {
    const answer = deferred<EngineStatus>()
    const bridge = makeBridge({ downloadModel: () => answer.promise })
    const { host, view } = settingsRow(bridge)
    view.apply(status('missing'))
    host.at('download').click()
    expect(host.at('download').disabled).toBe(true)
    host.at('download').click()
    await flush()
    expect(bridge.downloadModel).toHaveBeenCalledTimes(1)
    answer.resolve(status('downloading'))
    await flush()
    expect(host.at('cancel').disabled).toBe(false)
  })

  it('is never left disabled by a command that throws outright', async () => {
    const bridge = makeBridge({
      downloadModel: () => {
        throw new Error('The bridge is not there.')
      }
    })
    const { host, view } = settingsRow(bridge)
    view.apply(status('missing'))
    host.at('download').click()
    await flush()
    expect(host.at('note').textContent).toBe('The bridge is not there.')
    expect(host.at('download').disabled).toBe(false)
  })

  it('asks before removing the model, and does nothing if told no', async () => {
    const confirm = vi.fn(() => false)
    const { host, view, bridge } = settingsRow(makeBridge(), confirm)
    view.apply(status('installed'))
    host.at('remove').click()
    await flush()
    expect(confirm).toHaveBeenCalledWith(
      'Remove the speech model from this PC? Dictating on this PC will need it downloaded again (670 MB).'
    )
    expect(bridge.removeModel).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    host.at('remove').click()
    await flush()
    expect(bridge.removeModel).toHaveBeenCalledTimes(1)
    expect(host.at('badge').textContent).toBe('Not downloaded')
  })

  it("shows the main process's sentence when removing is refused", async () => {
    const bridge = makeBridge({
      removeModel: () =>
        Promise.reject(
          new Error(
            `Error invoking remote method 'engine:remove-model': Error: ${REMOVE_WHILE_DICTATING}`
          )
        )
    })
    const { host, view } = settingsRow(bridge)
    view.apply(status('installed'))
    host.at('remove').click()
    await flush()
    expect(host.at('note').textContent).toBe(REMOVE_WHILE_DICTATING)
    expect(host.at('note').hidden).toBe(false)

    // The model moving on supersedes the refusal.
    view.apply(status('missing'))
    expect(host.at('note').hidden).toBe(true)
  })

  it('disables Remove while dictating, and says why beside it', () => {
    const { host, view } = settingsRow()
    view.apply(status('installed'))
    view.setDictating(true)
    expect(host.at('remove').disabled).toBe(true)
    expect(host.at('note').textContent).toBe(REMOVE_WHILE_DICTATING)
    view.setDictating(false)
    expect(host.at('remove').disabled).toBe(false)
    expect(host.at('note').hidden).toBe(true)
  })

  it('marks a failure as an error, and retries from the same button', async () => {
    const { host, view, bridge } = settingsRow()
    view.apply(status('failed', { error: 'The download was damaged. Try again.' }))
    expect(host.at('detail').textContent).toBe('The download was damaged. Try again.')
    expect(host.at('detail').className).toContain('is-error')
    expect(host.at('badge').className).toContain('is-failed')
    expect(host.at('download').textContent).toBe('Try again')
    host.at('download').click()
    await flush()
    expect(bridge.downloadModel).toHaveBeenCalledTimes(1)
  })
})

describe('createModelRow on the setup card', () => {
  function setupRow(bridge = makeBridge()) {
    const host = new FakeHost()
    const onChooseCloud = vi.fn()
    const view = createModelRow(host as unknown as HTMLElement, {
      variant: 'setup',
      title: 'Download the speech model',
      detail: 'The model is 670 MB and downloads once.',
      bridge,
      onStatus: vi.fn(),
      onChooseCloud
    })
    return { host, view, bridge, onChooseCloud }
  }

  it('carries the step, a primary Download, and the way out to the cloud', () => {
    const { host, view, onChooseCloud } = setupRow()
    view.apply(status('missing'))
    expect(host.at('title').textContent).toBe('Download the speech model')
    expect(host.at('explain').textContent).toBe('The model is 670 MB and downloads once.')
    expect(host.innerHTML).toContain('class="primary-button" data-model="download"')
    expect(host.at('download').textContent).toBe('Download')
    expect(host.innerHTML).toContain('Prefer a cloud provider?')
    expect(host.innerHTML).toContain('Use your own API key instead')
    host.at('cloud').click()
    expect(onChooseCloud).toHaveBeenCalledTimes(1)
  })

  it('has no Remove and no badge: the step only exists until the model does', () => {
    const { host } = setupRow()
    expect(host.querySelector('[data-model="remove"]')).toBeNull()
    expect(host.querySelector('[data-model="badge"]')).toBeNull()
  })

  it('shows the same progress, check and failure as Settings', () => {
    const { host, view } = setupRow()
    view.apply(status('downloading', { receivedBytes: 412_000_000 }))
    expect(host.at('detail').textContent).toBe('412 of 670 MB')
    expect(host.at('cancel').hidden).toBe(false)
    expect(host.at('download').hidden).toBe(true)

    view.apply(status('verifying', { receivedBytes: 1 }))
    expect(host.at('detail').textContent).toBe('Checking the download…')

    view.apply(status('failed', { error: 'Not enough free disk space — about 700 MB is needed.' }))
    expect(host.at('detail').textContent).toBe(
      'Not enough free disk space — about 700 MB is needed.'
    )
    expect(host.at('download').textContent).toBe('Try again')
  })
})
