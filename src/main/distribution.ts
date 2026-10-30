/**
 * How this copy of Vocette reached the computer, which decides who updates it
 * and how it starts with Windows.
 *
 * The Microsoft Store build is the same app packaged as MSIX (electron-builder's
 * appx target: `npm run pack:store`, see docs/store.md). Electron marks a
 * process running from an MSIX package with `process.windowsStore`; nothing
 * else about the build differs, so that flag is the whole test.
 */

export interface ProcessFacts {
  platform: string
  windowsStore?: boolean
}

/** True when this process runs from the Microsoft Store (MSIX) package. */
export function isStoreInstall(facts: ProcessFacts): boolean {
  return facts.platform === 'win32' && facts.windowsStore === true
}

export interface UpdateInstallFacts {
  platform: string
  /** From `isStoreInstall`. */
  store: boolean
  /** `app.isPackaged`. */
  packaged: boolean
  /** MURMUR_UPDATE_FEED: a local test feed, which also lets a development run try. */
  testFeed?: string
  /** APPIMAGE, which an AppImage sets for itself at runtime. */
  appImage?: string
}

/**
 * Whether "Download and install" can replace this copy in place: the Windows
 * installer and a Linux AppImage can. The Store build never does, whatever
 * else is true: the Store installs its updates, and electron-updater would put
 * a second, unpackaged copy beside it.
 */
export function canInstallUpdates(facts: UpdateInstallFacts): boolean {
  if (facts.store) return false
  if (!facts.packaged && !facts.testFeed) return false
  return facts.platform === 'win32' || (facts.platform === 'linux' && Boolean(facts.appImage))
}
