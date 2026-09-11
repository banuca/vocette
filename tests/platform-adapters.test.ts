import { afterEach, describe, expect, it } from 'vitest'
import { createFallbackAdapter, createPlatformAdapter } from '../src/main/platform'
import { createLinuxAdapter, detectLinuxSession } from '../src/main/platform/linux'
import { createMacAdapter } from '../src/main/platform/macos'
import { createWindowsAdapter } from '../src/main/platform/windows'
import type { DesktopServices } from '../src/main/platform/desktop'
import type { HookModule } from '../src/main/platform/hook-backend'
import type { MacBindings } from '../src/main/platform/macos-native'
import type { CapabilityContext, ShortcutBackend } from '../src/main/platform/types'
import type { ShortcutChord } from '../src/shared/shortcuts'

/**
 * The adapters are the promise the app makes about what this computer can do.
 * Every branch below exists because getting it wrong means either a dead
 * shortcut with no explanation, or a paste into the wrong window.
 */

const CHORD: ShortcutChord = { keys: [0x001d, 0x002a] }

interface LoginCall {
  openAtLogin: boolean
  args?: string[]
  path?: string
}

function services(): DesktopServices & { login: LoginCall[]; opened: string[] } {
  const login: LoginCall[] = []
  const opened: string[] = []
  return {
    login,
    opened,
    setLoginItemSettings: (settings) => login.push(settings),
    openExternal: async (url) => {
      opened.push(url)
    },
    globalShortcut: {
      register: () => true,
      unregister: () => {},
      isRegistered: () => true
    }
  }
}

function hookModule(): HookModule & { pastes: string[] } {
  const pastes: string[] = []
  return {
    pastes,
    createBackend: (options): ShortcutBackend => ({
      supportsHold: true,
      supportsCapture: true,
      start: () => {},
      stop: () => {},
      setChord: () => {},
      setHoldDelay: () => {},
      setTapToFire: () => {},
      setEnabled: () => {},
      isEnabled: () => true,
      isCapturing: () => false,
      beginCapture: () => options.onCapture([], true),
      cancelCapture: () => {},
      resetKeyState: () => {},
      suppressSyntheticInput: () => {},
      registrationError: () => null
    }),
    paste: (modifier) => pastes.push(modifier)
  }
}

const verifiableTarget = {
  isAvailable: () => true,
  capture: () => {},
  clear: () => {},
  check: () => null
}

const unverifiableTarget = { ...verifiableTarget, isAvailable: () => false }

function context(overrides: Partial<CapabilityContext> = {}): CapabilityContext {
  return {
    shortcuts: null,
    target: verifiableTarget,
    secureStorage: { usable: true, reason: '' },
    ...overrides
  }
}

const options = {
  chord: CHORD,
  holdDelayMs: 250,
  onPress: () => {},
  onRelease: () => {},
  onError: () => {},
  onCapture: () => {}
}

describe('Windows adapter', () => {
  it('reports every capability available with a working hook', () => {
    const adapter = createWindowsAdapter(hookModule(), services())
    const map = adapter.capabilities(context())
    expect(map.globalHold.state).toBe('available')
    expect(map.autoPaste.state).toBe('available')
    expect(map.targetVerification.state).toBe('available')
    expect(adapter.pasteLabel).toBe('Ctrl + V')
  })

  it('injects Ctrl and not Command', () => {
    const hook = hookModule()
    createWindowsAdapter(hook, services()).paste()
    expect(hook.pastes).toEqual(['ctrl'])
  })

  it('degrades to a reported capability when the hook is missing', () => {
    const adapter = createWindowsAdapter(null, services())
    const map = adapter.capabilities(context())
    expect(map.globalHold.state).toBe('unavailable')
    expect(map.globalHold.reason).toContain('record from the Murmur window')
    expect(map.autoPaste.state).toBe('unavailable')
    expect(adapter.canPaste()).toBe(false)
    // Nothing here may throw: the window still has to open.
    expect(adapter.createTargetTracker().isAvailable()).toBe(false)
    expect(adapter.createShortcutBackend(options).supportsHold).toBe(false)
  })

  it('reports a hook that started but could not register', () => {
    const backend = { registrationError: () => 'Another app owns that shortcut.' }
    const map = createWindowsAdapter(hookModule(), services()).capabilities(
      context({ shortcuts: backend as ShortcutBackend })
    )
    expect(map.globalHold.reason).toBe('Another app owns that shortcut.')
  })

  it('reports an unverifiable target without blaming the hook', () => {
    const map = createWindowsAdapter(hookModule(), services()).capabilities(
      context({ target: unverifiableTarget })
    )
    expect(map.targetVerification.state).toBe('unavailable')
    expect(map.autoPaste.state).toBe('available')
  })

  it('passes secure-storage unsuitability straight through', () => {
    const map = createWindowsAdapter(hookModule(), services()).capabilities(
      context({ secureStorage: { usable: false, reason: 'No keyring here.' } })
    )
    expect(map.secureKeyStorage).toEqual({
      state: 'unavailable',
      reason: 'No keyring here.',
      pane: null
    })
  })

  it('opens only the microphone privacy page', async () => {
    const desktop = services()
    const adapter = createWindowsAdapter(hookModule(), desktop)
    await adapter.openSettingsPane('microphone')
    await adapter.openSettingsPane('accessibility')
    expect(desktop.opened).toEqual(['ms-settings:privacy-microphone'])
  })

  it('starts in the background when launched at login', () => {
    const desktop = services()
    createWindowsAdapter(hookModule(), desktop).setLaunchAtLogin(true)
    expect(desktop.login).toEqual([{ openAtLogin: true, args: ['--background'] }])
  })
})

function macBindings(overrides: Partial<MacBindings> = {}): MacBindings {
  return {
    frontmostPid: () => 42,
    secureInputEnabled: () => false,
    accessibilityTrusted: () => true,
    inputMonitoringGranted: () => true,
    requestInputMonitoring: () => {},
    ...overrides
  }
}

describe('macOS adapter', () => {
  it('injects Command and labels the chord accordingly', () => {
    const hook = hookModule()
    const adapter = createMacAdapter(hook, services(), macBindings())
    adapter.paste()
    expect(hook.pastes).toEqual(['meta'])
    expect(adapter.pasteLabel).toBe('Command + V')
    expect(adapter.primaryModifierLabel).toBe('Command')
  })

  it('asks for Input Monitoring before blaming the hook', () => {
    const map = createMacAdapter(
      hookModule(),
      services(),
      macBindings({ inputMonitoringGranted: () => false })
    ).capabilities(context())
    expect(map.globalHold.state).toBe('needs-permission')
    expect(map.globalHold.pane).toBe('input-monitoring')
    expect(map.globalHold.reason).toContain('Input Monitoring')
  })

  it('asks for Accessibility before it will claim it can paste', () => {
    const map = createMacAdapter(
      hookModule(),
      services(),
      macBindings({ accessibilityTrusted: () => false })
    ).capabilities(context())
    expect(map.autoPaste.state).toBe('needs-permission')
    expect(map.autoPaste.pane).toBe('accessibility')
  })

  it('treats an unknown permission answer as no obstacle of its own', () => {
    const map = createMacAdapter(
      hookModule(),
      services(),
      macBindings({ inputMonitoringGranted: () => null, accessibilityTrusted: () => null })
    ).capabilities(context())
    expect(map.globalHold.state).toBe('available')
    expect(map.autoPaste.state).toBe('available')
  })

  it('verifies the frontmost application and refuses during secure input', () => {
    const secure = { value: false }
    const tracker = createMacAdapter(
      hookModule(),
      services(),
      macBindings({ secureInputEnabled: () => secure.value })
    ).createTargetTracker()
    tracker.capture()
    expect(tracker.check()).toEqual({
      sameWindow: true,
      elevated: false,
      blockedReason: 'macOS secure input is active'
    })
    secure.value = true
    expect(tracker.check()?.elevated).toBe(true)
  })

  it('has no target tracker when the runtime could not be bound', () => {
    const adapter = createMacAdapter(hookModule(), services(), null)
    expect(adapter.createTargetTracker().isAvailable()).toBe(false)
    expect(adapter.createTargetTracker().check()).toBeNull()
  })

  it('opens the right privacy pane for each permission', async () => {
    const desktop = services()
    const adapter = createMacAdapter(hookModule(), desktop, macBindings())
    await adapter.openSettingsPane('accessibility')
    await adapter.openSettingsPane('input-monitoring')
    await adapter.openSettingsPane('microphone')
    expect(desktop.opened).toEqual([
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
    ])
  })
})

describe('detectLinuxSession', () => {
  it('trusts the declared session type first', () => {
    expect(detectLinuxSession({ XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' })).toBe('wayland')
    expect(detectLinuxSession({ XDG_SESSION_TYPE: 'X11' })).toBe('x11')
  })

  it('falls back to the display variables', () => {
    expect(detectLinuxSession({ WAYLAND_DISPLAY: 'wayland-0' })).toBe('wayland')
    expect(detectLinuxSession({ DISPLAY: ':0' })).toBe('x11')
  })

  it('says unknown rather than guessing', () => {
    expect(detectLinuxSession({})).toBe('unknown')
  })
})

describe('Linux adapter on Wayland', () => {
  const wayland = (desktop = services()) => createLinuxAdapter(hookModule(), desktop, 'wayland', null)

  it('refuses to claim hold-to-talk, and says why', () => {
    const map = wayland().capabilities(context())
    expect(map.globalHold.state).toBe('unavailable')
    expect(map.globalHold.reason).toContain('starts and stops recording')
    expect(map.globalToggle.state).toBe('available')
  })

  it('is clipboard-only, with both halves explained', () => {
    const map = wayland().capabilities(context())
    expect(map.targetVerification.state).toBe('unavailable')
    expect(map.autoPaste.state).toBe('unavailable')
    expect(map.autoPaste.reason).toContain('copied to your clipboard')
  })

  it('never injects a keystroke', () => {
    const hook = hookModule()
    const adapter = createLinuxAdapter(hook, services(), 'wayland', null)
    adapter.paste()
    expect(hook.pastes).toEqual([])
    expect(adapter.canPaste()).toBe(false)
    expect(adapter.createTargetTracker().isAvailable()).toBe(false)
  })

  it('uses a desktop-registered shortcut, which cannot hold', () => {
    expect(wayland().createShortcutBackend(options).supportsHold).toBe(false)
  })

  it('reports a shortcut the desktop would not register', () => {
    const backend = { registrationError: () => 'That shortcut is taken.' }
    const map = wayland().capabilities(context({ shortcuts: backend as ShortcutBackend }))
    expect(map.globalToggle.reason).toBe('That shortcut is taken.')
  })
})

describe('Linux adapter on X11', () => {
  it('behaves like a hook platform', () => {
    const map = createLinuxAdapter(hookModule(), services(), 'x11', {
      focusedWindow: () => 7n
    }).capabilities(context())
    expect(map.globalHold.state).toBe('available')
    expect(map.autoPaste.state).toBe('available')
    expect(map.targetVerification.state).toBe('available')
  })

  it('verifies the target through the X server', () => {
    const focus = { id: 7n }
    const tracker = createLinuxAdapter(hookModule(), services(), 'x11', {
      focusedWindow: () => focus.id
    }).createTargetTracker()
    tracker.capture()
    expect(tracker.check()).toEqual({ sameWindow: true, elevated: false })
    focus.id = 9n
    expect(tracker.check()).toEqual({ sameWindow: false, elevated: false })
  })

  it('falls back to clipboard-only when the X display cannot be opened', () => {
    const adapter = createLinuxAdapter(hookModule(), services(), 'x11', null)
    const target = adapter.createTargetTracker()
    expect(target.isAvailable()).toBe(false)
    expect(adapter.capabilities(context({ target })).targetVerification.state).toBe('unavailable')
  })
})

describe('Linux launch at login', () => {
  const original = process.env.APPIMAGE
  afterEach(() => {
    if (original === undefined) delete process.env.APPIMAGE
    else process.env.APPIMAGE = original
  })

  it('points at the AppImage, not the temporary mount it runs from', () => {
    process.env.APPIMAGE = '/home/user/Apps/VoiceHotkey.AppImage'
    const desktop = services()
    createLinuxAdapter(hookModule(), desktop, 'x11', null).setLaunchAtLogin(true)
    expect(desktop.login[0]?.path).toBe('/home/user/Apps/VoiceHotkey.AppImage')
  })

  it('leaves the path alone for a normal install', () => {
    delete process.env.APPIMAGE
    const desktop = services()
    createLinuxAdapter(hookModule(), desktop, 'x11', null).setLaunchAtLogin(false)
    expect(desktop.login[0]).toEqual({ openAtLogin: false, args: ['--background'] })
  })
})

describe('platform selection', () => {
  it('routes each operating system to its own adapter', async () => {
    const desktop = services()
    const hook = hookModule()
    expect((await createPlatformAdapter(desktop, { platform: 'win32', hook })).id).toBe('windows')
    expect((await createPlatformAdapter(desktop, { platform: 'darwin', hook })).id).toBe('macos')
    expect((await createPlatformAdapter(desktop, { platform: 'linux', hook })).id).toBe('linux')
  })

  it('falls back to a working, honest adapter on an unknown system', async () => {
    const adapter = await createPlatformAdapter(services(), { platform: 'aix', hook: null })
    expect(adapter.id).toBe('unknown')
    const map = adapter.capabilities(context())
    expect(map.globalHold.state).toBe('unavailable')
    expect(map.launchAtLogin.state).toBe('unavailable')
    adapter.paste()
    adapter.setLaunchAtLogin(true)
    await adapter.openSettingsPane('microphone')
    expect(adapter.createShortcutBackend(options).registrationError()).toContain(
      'no system integration'
    )
  })

  it('keeps the fallback adapter honest about secure storage', () => {
    const map = createFallbackAdapter().capabilities(
      context({ secureStorage: { usable: false, reason: 'Nothing to encrypt with.' } })
    )
    expect(map.secureKeyStorage.reason).toBe('Nothing to encrypt with.')
  })
})
