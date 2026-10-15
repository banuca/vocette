import type { UpdateInstall } from '../shared/update'

/**
 * Downloads and installs an update, through electron-updater, only when the
 * user asks (see `UpdateInstall`). Nothing is fetched on its own: the daily
 * check (`update-check.ts`) only says that a version exists.
 *
 * The updater reads the release's `latest.yml` from GitHub, downloads the
 * installer it names, and checks its SHA-512 before running it. Once the
 * installer is signed, it also checks the signature's publisher.
 */

/** The part of electron-updater's `autoUpdater` this uses, so tests can stand in for it. */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<{ isUpdateAvailable?: boolean; updateInfo?: { version?: string } } | null>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: 'download-progress', listener: (progress: { percent?: number }) => void): unknown
  on(event: 'update-downloaded', listener: (info: { version?: string }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

export interface AppUpdaterOptions {
  /** This build can replace itself: the Windows installer, or an AppImage. */
  supported: boolean
  /** Made on first use, so nothing is loaded for a user who never updates. */
  load(): Promise<UpdaterLike>
  /**
   * A downloaded update installs when Vocette quits. False only for a test
   * feed, so a check run on a developer's PC never installs over their own copy.
   */
  installOnQuit?: boolean
  onChange(install: UpdateInstall): void
}

const NOTHING_NEWER = 'No newer version was found to install.'
const DOWNLOAD_FAILED =
  'The update could not be downloaded. Check your internet connection and try again.'

export class AppUpdater {
  private install: UpdateInstall
  private updater: UpdaterLike | null = null
  private inFlight: Promise<UpdateInstall> | null = null

  constructor(private readonly options: AppUpdaterOptions) {
    this.install = { supported: options.supported, state: 'idle', percent: 0, version: null, error: null }
  }

  getInstall(): UpdateInstall {
    return { ...this.install }
  }

  /** "Download and install": finds the newest version and fetches it. */
  download(): Promise<UpdateInstall> {
    if (!this.options.supported) return Promise.resolve(this.getInstall())
    if (this.install.state === 'ready') return Promise.resolve(this.getInstall())
    if (this.inFlight) return this.inFlight
    this.set({ state: 'downloading', percent: 0, error: null })
    this.inFlight = this.run()
      .catch((error: unknown): UpdateInstall => {
        console.error('Vocette could not download the update:', error)
        this.set({ state: 'error', percent: 0, error: DOWNLOAD_FAILED })
        return this.getInstall()
      })
      .finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }

  /** "Restart to update": closes Vocette and runs the downloaded installer. */
  installNow(): boolean {
    if (this.install.state !== 'ready' || !this.updater) return false
    // Not silent, so the installer shows its progress; Vocette starts again after.
    this.updater.quitAndInstall(false, true)
    return true
  }

  private async run(): Promise<UpdateInstall> {
    const updater = await this.loaded()
    const result = await updater.checkForUpdates()
    if (!result || result.isUpdateAvailable === false) {
      this.set({ state: 'error', percent: 0, error: NOTHING_NEWER })
      return this.getInstall()
    }
    const version = result.updateInfo?.version ?? null
    this.set({ version })
    await updater.downloadUpdate()
    this.set({ state: 'ready', percent: 100, error: null })
    return this.getInstall()
  }

  private async loaded(): Promise<UpdaterLike> {
    if (this.updater) return this.updater
    const updater = await this.options.load()
    updater.autoDownload = false
    // Downloaded and not restarted for: it installs when Vocette quits.
    updater.autoInstallOnAppQuit = this.options.installOnQuit ?? true
    updater.on('download-progress', (progress) => {
      if (this.install.state !== 'downloading') return
      const percent = Number(progress?.percent)
      if (Number.isFinite(percent)) this.set({ percent })
    })
    updater.on('update-downloaded', (info) => {
      this.set({ state: 'ready', percent: 100, version: info?.version ?? this.install.version })
    })
    updater.on('error', () => {
      // A failure during a download is reported by `download`'s own catch;
      // one afterwards (the install step) leaves the ready state as it is.
    })
    this.updater = updater
    return updater
  }

  private set(change: Partial<UpdateInstall>): void {
    this.install = { ...this.install, ...change }
    this.options.onChange(this.getInstall())
  }
}
