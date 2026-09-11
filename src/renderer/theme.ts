import type { PublicSettings, SettingsUpdate, Theme } from '../shared/types'

/**
 * The interface palette and the control that switches it.
 *
 * Applying a theme is one attribute write on `<html>`; every colour in the
 * stylesheet is a custom property, so the whole window re-colours from that
 * single change with no reflow and no second stylesheet to download.
 *
 * The choice is a real setting, not a browser-storage convenience: it is saved
 * with everything else, survives a restart, and is what the overlay is told to
 * use so a light window never has a black pill floating over it.
 */

/** Writes the theme onto the document root. Safe to call repeatedly. */
export function applyTheme(root: HTMLElement, theme: Theme): void {
  root.dataset.theme = theme
  // Native scrollbars, form controls and the window's own backdrop follow this
  // rather than the custom properties, so it has to be set as well.
  root.style.colorScheme = theme === 'light' ? 'light' : 'dark'
}

export function otherTheme(theme: Theme): Theme {
  return theme === 'light' ? 'dark' : 'light'
}

/** What the control says it will do, which is the opposite of what is on. */
export function themeToggleLabel(theme: Theme): string {
  return theme === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme'
}

/** The icon shows the theme you would move to, matching the label. */
const SUN = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="3.1" fill="currentColor"/><g stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 1.4v1.8M8 12.8v1.8M1.4 8h1.8M12.8 8h1.8M3.3 3.3l1.3 1.3M11.4 11.4l1.3 1.3M12.7 3.3l-1.3 1.3M4.6 11.4l-1.3 1.3"/></g></svg>`
const MOON = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M13.3 9.9A5.6 5.6 0 0 1 6.1 2.7a5.9 5.9 0 1 0 7.2 7.2Z"/></svg>`

export interface ThemeBridge {
  saveSettings(update: SettingsUpdate): Promise<PublicSettings>
}

export interface ThemeToggle {
  /** Re-reads the theme from settings changed somewhere else. */
  apply(theme: Theme): void
}

/**
 * The sidebar control.
 *
 * The theme is applied straight away and saved behind it, because waiting on
 * disk to re-colour a window feels broken. A save that fails puts the theme
 * back and says why, rather than leaving the window showing a preference that
 * was never recorded.
 */
export function createThemeToggle(
  host: HTMLElement,
  root: HTMLElement,
  bridge: ThemeBridge,
  initial: Theme,
  onApplied: (settings: PublicSettings) => void
): ThemeToggle {
  let theme = initial
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'theme-toggle'
  host.appendChild(button)

  const draw = (): void => {
    const next = otherTheme(theme)
    button.innerHTML = `${next === 'light' ? SUN : MOON}<span>${next === 'light' ? 'Light' : 'Dark'}</span>`
    button.title = themeToggleLabel(theme)
    button.setAttribute('aria-label', themeToggleLabel(theme))
  }

  const set = (next: Theme): void => {
    theme = next
    applyTheme(root, theme)
    draw()
  }

  button.addEventListener('click', () => {
    const previous = theme
    const next = otherTheme(previous)
    set(next)
    button.removeAttribute('data-error')
    void bridge
      .saveSettings({ theme: next })
      .then((settings) => onApplied(settings))
      .catch((error: unknown) => {
        set(previous)
        button.dataset.error = 'true'
        button.title =
          error instanceof Error
            ? `The theme could not be saved: ${error.message}`
            : 'The theme could not be saved.'
      })
  })

  set(initial)
  return {
    apply: (next: Theme) => {
      if (next !== theme) set(next)
    }
  }
}
