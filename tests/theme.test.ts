import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  createThemeToggle,
  resolveTheme,
  themeButtonLabel,
  type SystemTheme
} from '../src/renderer/theme'
import type { PublicSettings, Theme } from '../src/shared/types'

/**
 * The palette is one attribute on the document root, so these tests are about
 * what can actually go wrong: the attribute not matching the setting, the
 * window not following Windows while it is meant to, and a failed save
 * leaving the window showing a preference that was never recorded.
 */

/** Just enough of an element for the switch to render into and be clicked. */
class FakeElement {
  innerHTML = ''
  title = ''
  type = ''
  className = ''
  readonly dataset: Record<string, string> = {}
  readonly style: { colorScheme?: string } = {}
  readonly attributes = new Map<string, string>()
  readonly children: FakeElement[] = []
  private readonly listeners: Array<() => void> = []

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
    if (name === 'data-error') delete this.dataset.error
  }

  appendChild(child: FakeElement): void {
    this.children.push(child)
  }

  click(): void {
    this.listeners.forEach((listener) => listener())
  }
}

/** A stand-in for Windows' light or dark mode that a test can flip. */
function fakeSystem(dark: boolean): SystemTheme & { flip(next: boolean): void } {
  let isDark = dark
  const callbacks: Array<() => void> = []
  return {
    isDark: () => isDark,
    onChange: (callback) => {
      callbacks.push(callback)
      return () => undefined
    },
    flip: (next) => {
      isDark = next
      callbacks.forEach((callback) => callback())
    }
  }
}

const settings = (theme: Theme): PublicSettings =>
  ({ theme, apiKeySource: 'stored' }) as unknown as PublicSettings

function harness(
  initial: Theme,
  options: { systemDark?: boolean; save?: () => Promise<PublicSettings> } = {}
) {
  vi.stubGlobal('document', { createElement: () => new FakeElement() })
  const host = new FakeElement()
  const root = new FakeElement()
  const system = fakeSystem(options.systemDark ?? true)
  const applied: PublicSettings[] = []
  const saveSettings = vi.fn(
    options.save ?? (async (update: { theme?: Theme }) => settings(update.theme!))
  )
  const toggle = createThemeToggle(
    host as unknown as HTMLElement,
    root as unknown as HTMLElement,
    { saveSettings } as never,
    initial,
    (next) => applied.push(next),
    system
  )
  const group = host.children[0]!
  const [sun, moon] = group.children as [FakeElement, FakeElement]
  const pressed = (): string[] =>
    [sun, moon].filter((b) => b.attributes.get('aria-pressed') === 'true').map((b) => b.dataset.mode!)
  return { toggle, group, sun, moon, root, system, saveSettings, applied, pressed }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveTheme and applyTheme', () => {
  it('follows the system for "system", and the choice otherwise', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('writes both the attribute the stylesheet reads and the native colour scheme', () => {
    const root = new FakeElement()
    expect(applyTheme(root as unknown as HTMLElement, 'system', fakeSystem(false))).toBe('light')
    expect(root.dataset.theme).toBe('light')
    expect(root.style.colorScheme).toBe('light')
    applyTheme(root as unknown as HTMLElement, 'dark', fakeSystem(false))
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
  })
})

describe('labels', () => {
  it('names each half, and says when the window is following Windows', () => {
    expect(themeButtonLabel('light', 'dark')).toBe('Light theme')
    expect(themeButtonLabel('dark', 'system')).toBe('Dark theme (following Windows until you choose)')
  })
})

describe('the sun and moon switch', () => {
  it('opens in Windows’ mode, with that half pressed', () => {
    const { root, pressed, sun } = harness('system', { systemDark: false })
    expect(root.dataset.theme).toBe('light')
    expect(pressed()).toEqual(['light'])
    expect(sun.title).toBe('Light theme (following Windows until you choose)')
  })

  it('keeps following Windows until someone chooses', () => {
    const { root, system, pressed, saveSettings } = harness('system', { systemDark: true })
    expect(root.dataset.theme).toBe('dark')
    system.flip(false)
    expect(root.dataset.theme).toBe('light')
    expect(pressed()).toEqual(['light'])
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('saves a press, and stops following Windows after it', async () => {
    const { moon, root, system, saveSettings, applied } = harness('system', { systemDark: false })
    moon.click()
    expect(root.dataset.theme).toBe('dark')
    expect(saveSettings).toHaveBeenCalledWith({ theme: 'dark' })
    await vi.waitFor(() => expect(applied).toHaveLength(1))
    system.flip(false)
    expect(root.dataset.theme).toBe('dark')
  })

  it('records pressing the half Windows already put in force as a choice', () => {
    const { sun, saveSettings } = harness('system', { systemDark: false })
    sun.click()
    expect(saveSettings).toHaveBeenCalledWith({ theme: 'light' })
  })

  it('does nothing for the half already chosen', () => {
    const { sun, saveSettings } = harness('light')
    sun.click()
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('puts the theme back when the save fails, and says why', async () => {
    const { moon, root, group } = harness('light', {
      save: async () => {
        throw new Error('Settings could not be written.')
      }
    })
    moon.click()
    expect(root.dataset.theme).toBe('dark')
    await vi.waitFor(() => expect(root.dataset.theme).toBe('light'))
    expect(group.dataset.error).toBe('true')
    expect(group.title).toContain('Settings could not be written.')
  })

  it('follows a theme changed somewhere else without saving it again', () => {
    const { toggle, root, saveSettings } = harness('dark')
    toggle.apply('light')
    expect(root.dataset.theme).toBe('light')
    expect(saveSettings).not.toHaveBeenCalled()
  })
})
