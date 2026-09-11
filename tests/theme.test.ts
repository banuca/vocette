import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, createThemeToggle, otherTheme, themeToggleLabel } from '../src/renderer/theme'
import type { PublicSettings, Theme } from '../src/shared/types'

/**
 * The palette is one attribute on the document root, so these tests are about
 * the two things that can actually go wrong: the attribute not matching what
 * was saved, and a failed save leaving the window showing a preference that
 * was never recorded.
 */

/** Just enough of an element for the toggle to render into and be clicked. */
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
  }

  appendChild(child: FakeElement): void {
    this.children.push(child)
  }

  click(): void {
    this.listeners.forEach((listener) => listener())
  }
}

const settings = (theme: Theme): PublicSettings =>
  ({ theme, apiKeySource: 'stored' }) as unknown as PublicSettings

function harness(initial: Theme, save?: () => Promise<PublicSettings>) {
  const button = new FakeElement()
  vi.stubGlobal('document', { createElement: () => button })

  const host = new FakeElement()
  const root = new FakeElement()
  const applied: PublicSettings[] = []
  const saveSettings = vi.fn(save ?? (async (update: { theme?: Theme }) => settings(update.theme!)))

  const toggle = createThemeToggle(
    host as unknown as HTMLElement,
    root as unknown as HTMLElement,
    { saveSettings } as never,
    initial,
    (next) => applied.push(next)
  )
  return { toggle, button, root, saveSettings, applied }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('applyTheme', () => {
  it('writes both the attribute the stylesheet reads and the native colour scheme', () => {
    const root = new FakeElement()
    applyTheme(root as unknown as HTMLElement, 'light')
    expect(root.dataset.theme).toBe('light')
    expect(root.style.colorScheme).toBe('light')

    applyTheme(root as unknown as HTMLElement, 'dark')
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
  })
})

describe('labels', () => {
  it('names the theme being moved to, not the one in force', () => {
    expect(otherTheme('dark')).toBe('light')
    expect(otherTheme('light')).toBe('dark')
    expect(themeToggleLabel('dark')).toBe('Switch to the light theme')
    expect(themeToggleLabel('light')).toBe('Switch to the dark theme')
  })
})

describe('createThemeToggle', () => {
  it('applies the stored theme as soon as it is created', () => {
    const { root, button } = harness('light')
    expect(root.dataset.theme).toBe('light')
    expect(button.title).toBe('Switch to the dark theme')
  })

  it('switches the document and saves the choice', async () => {
    const { button, root, saveSettings, applied } = harness('dark')

    button.click()
    expect(root.dataset.theme).toBe('light')
    expect(saveSettings).toHaveBeenCalledWith({ theme: 'light' })

    await vi.waitFor(() => expect(applied).toHaveLength(1))
    expect(applied[0]?.theme).toBe('light')
  })

  it('puts the theme back when the save fails, and says why', async () => {
    const { button, root } = harness('dark', async () => {
      throw new Error('Settings could not be written.')
    })

    button.click()
    expect(root.dataset.theme).toBe('light')

    await vi.waitFor(() => expect(root.dataset.theme).toBe('dark'))
    expect(button.dataset.error).toBe('true')
    expect(button.title).toContain('Settings could not be written.')
  })

  it('follows a theme changed somewhere else without saving it again', () => {
    const { toggle, root, saveSettings } = harness('dark')
    toggle.apply('light')
    expect(root.dataset.theme).toBe('light')
    expect(saveSettings).not.toHaveBeenCalled()
  })
})
