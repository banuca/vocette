import { describe, expect, it, vi } from 'vitest'
import { AppUpdater, type UpdaterLike } from '../src/main/app-updater'
import { installText, type UpdateInstall } from '../src/shared/update'

type Listener = (value: never) => void

function fakeUpdater(options: { available?: boolean; version?: string; downloadFails?: boolean } = {}) {
  const listeners = new Map<string, Listener[]>()
  const emit = (event: string, value: unknown): void => {
    for (const listener of listeners.get(event) ?? []) listener(value as never)
  }
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(async () => ({
      isUpdateAvailable: options.available ?? true,
      updateInfo: { version: options.version ?? '1.0.1' }
    })),
    downloadUpdate: vi.fn(async () => {
      emit('download-progress', { percent: 42.4 })
      if (options.downloadFails) throw new Error('net::ERR_INTERNET_DISCONNECTED')
      emit('update-downloaded', { version: options.version ?? '1.0.1' })
      return []
    }),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return updater
    })
  }
  return updater
}

function makeUpdater(updater: ReturnType<typeof fakeUpdater>, supported = true) {
  const changes: UpdateInstall[] = []
  const load = vi.fn(async () => updater as unknown as UpdaterLike)
  const appUpdater = new AppUpdater({ supported, load, onChange: (install) => changes.push(install) })
  return { appUpdater, changes, load }
}

describe('installing an update from inside the app', () => {
  it('loads nothing until asked', () => {
    const { appUpdater, load } = makeUpdater(fakeUpdater())
    expect(appUpdater.getInstall()).toEqual({
      supported: true,
      state: 'idle',
      percent: 0,
      version: null,
      error: null
    })
    expect(load).not.toHaveBeenCalled()
  })

  it('downloads only when asked, shows progress, and is then ready', async () => {
    const updater = fakeUpdater()
    const { appUpdater, changes } = makeUpdater(updater)
    const install = await appUpdater.download()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(true)
    expect(changes.map((change) => change.state)).toContain('downloading')
    expect(changes.some((change) => change.percent === 42.4)).toBe(true)
    expect(install).toMatchObject({ state: 'ready', percent: 100, version: '1.0.1', error: null })
  })

  it('never installs on quit from a test feed', async () => {
    const updater = fakeUpdater()
    const appUpdater = new AppUpdater({
      supported: true,
      installOnQuit: false,
      load: async () => updater as unknown as UpdaterLike,
      onChange: () => undefined
    })
    await appUpdater.download()
    expect(updater.autoInstallOnAppQuit).toBe(false)
  })

  it('restarts into the installer only once it is ready', async () => {
    const updater = fakeUpdater()
    const { appUpdater } = makeUpdater(updater)
    expect(appUpdater.installNow()).toBe(false)
    await appUpdater.download()
    expect(appUpdater.installNow()).toBe(true)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('says so when there is nothing newer', async () => {
    const { appUpdater } = makeUpdater(fakeUpdater({ available: false }))
    expect(await appUpdater.download()).toMatchObject({
      state: 'error',
      error: 'No newer version was found to install.'
    })
  })

  it('says plainly when the download fails, and can try again', async () => {
    const updater = fakeUpdater({ downloadFails: true })
    const { appUpdater } = makeUpdater(updater)
    expect(await appUpdater.download()).toMatchObject({
      state: 'error',
      percent: 0,
      error: 'The update could not be downloaded. Check your internet connection and try again.'
    })
    await appUpdater.download()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('sends one download for two presses', async () => {
    const updater = fakeUpdater()
    const { appUpdater } = makeUpdater(updater)
    await Promise.all([appUpdater.download(), appUpdater.download()])
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('does nothing where the app cannot replace itself', async () => {
    const updater = fakeUpdater()
    const { appUpdater, load } = makeUpdater(updater, false)
    expect(await appUpdater.download()).toMatchObject({ supported: false, state: 'idle' })
    expect(load).not.toHaveBeenCalled()
  })

  it('words each state for the window', () => {
    const base: UpdateInstall = { supported: true, state: 'idle', percent: 0, version: null, error: null }
    expect(installText(base)).toBe('')
    expect(installText({ ...base, state: 'downloading', percent: 42.4 })).toBe('Downloading… 42%')
    expect(installText({ ...base, state: 'ready', version: 'v1.0.1' })).toBe(
      'Vocette 1.0.1 is ready. It installs when you restart or quit Vocette.'
    )
    expect(installText({ ...base, state: 'error', error: 'No newer version was found to install.' })).toBe(
      'No newer version was found to install.'
    )
  })
})
