import { describe, expect, it } from 'vitest'
import { canInstallUpdates, isStoreInstall } from '../src/main/distribution'

/**
 * The Store build is the same app with one runtime flag. Getting the flag's
 * consequences wrong means either a Store copy that installs a second,
 * unpackaged copy of itself, or an installer copy that can no longer update.
 */

describe('isStoreInstall', () => {
  it('is true only for a Windows process Electron says runs from an MSIX package', () => {
    expect(isStoreInstall({ platform: 'win32', windowsStore: true })).toBe(true)
    expect(isStoreInstall({ platform: 'win32' })).toBe(false)
    expect(isStoreInstall({ platform: 'win32', windowsStore: false })).toBe(false)
  })

  it('never claims the Store anywhere else', () => {
    expect(isStoreInstall({ platform: 'darwin', windowsStore: true })).toBe(false)
    expect(isStoreInstall({ platform: 'linux', windowsStore: true })).toBe(false)
  })
})

describe('canInstallUpdates', () => {
  const installer = { platform: 'win32', store: false, packaged: true }

  it('lets the Windows installer copy replace itself', () => {
    expect(canInstallUpdates(installer)).toBe(true)
  })

  it('never lets the Store copy replace itself, whatever else is set', () => {
    expect(canInstallUpdates({ ...installer, store: true })).toBe(false)
    expect(
      canInstallUpdates({ ...installer, store: true, testFeed: 'http://127.0.0.1:8080/' })
    ).toBe(false)
  })

  it('keeps a development run on the download page unless a test feed is set', () => {
    expect(canInstallUpdates({ ...installer, packaged: false })).toBe(false)
    expect(canInstallUpdates({ ...installer, packaged: false, testFeed: '' })).toBe(false)
    expect(
      canInstallUpdates({ ...installer, packaged: false, testFeed: 'http://127.0.0.1:8080/' })
    ).toBe(true)
  })

  it('updates an AppImage but not other Linux installs, and never the Mac build', () => {
    expect(
      canInstallUpdates({ ...installer, platform: 'linux', appImage: '/home/a/Vocette.AppImage' })
    ).toBe(true)
    expect(canInstallUpdates({ ...installer, platform: 'linux' })).toBe(false)
    expect(canInstallUpdates({ ...installer, platform: 'darwin' })).toBe(false)
  })
})
