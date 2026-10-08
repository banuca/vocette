import type { AppliedTheme, PublicSettings, SettingsUpdate, Theme } from '../shared/types'

/**
 * The interface palette and the control that switches it.
 *
 * Applying a theme is one attribute write on `<html>`; every colour in the
 * stylesheet is a custom property, so the whole window re-colours from that
 * single change with no reflow and no second stylesheet to download.
 *
 * The setting starts as `system`: the window follows Windows' own light or
 * dark mode, and keeps following it as it changes, until someone presses the
 * sun or the moon. That choice is a real setting, not a browser-storage
 * convenience: it is saved with everything else, survives a restart, and is
 * what the overlay is told to use so a light window never has a black pill
 * floating over it.
 */

/** Where the operating system's own light or dark mode is read from. */
export interface SystemTheme {
  isDark(): boolean
  /** Calls back whenever the system switches; returns a way to stop. */
  onChange(callback: () => void): () => void
}

/** Windows' setting, as Chromium reports it to every page. */
export function mediaSystemTheme(): SystemTheme {
  const media =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
  return {
    isDark: () => media?.matches ?? true,
    onChange: (callback) => {
      media?.addEventListener('change', callback)
      return () => media?.removeEventListener('change', callback)
    }
  }
}

/** The palette a setting means right now. */
export function resolveTheme(theme: Theme, systemDark: boolean): AppliedTheme {
  if (theme === 'system') return systemDark ? 'dark' : 'light'
  return theme
}

/** Writes the palette onto the document root. Safe to call repeatedly. */
export function applyTheme(
  root: HTMLElement,
  theme: Theme,
  system: SystemTheme = mediaSystemTheme()
): AppliedTheme {
  const applied = resolveTheme(theme, system.isDark())
  root.dataset.theme = applied
  // Native scrollbars, form controls and the window's own backdrop follow this
  // rather than the custom properties, so it has to be set as well.
  root.style.colorScheme = applied
  return applied
}

/** What each half of the switch says, to a screen reader and on hover. */
export function themeButtonLabel(mode: AppliedTheme, theme: Theme): string {
  const name = mode === 'light' ? 'Light theme' : 'Dark theme'
  return theme === 'system' ? `${name} (following Windows until you choose)` : name
}

const SUN = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="3.1" fill="currentColor"/><g stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 1.4v1.8M8 12.8v1.8M1.4 8h1.8M12.8 8h1.8M3.3 3.3l1.3 1.3M11.4 11.4l1.3 1.3M12.7 3.3l-1.3 1.3M4.6 11.4l-1.3 1.3"/></g></svg>`
const MOON = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false"><path fill="currentColor" d="M13.3 9.9A5.6 5.6 0 0 1 6.1 2.7a5.9 5.9 0 1 0 7.2 7.2Z"/></svg>`

export interface ThemeBridge {
  saveSettings(update: SettingsUpdate): Promise<PublicSettings>
}

export interface ThemeToggle {
  /** Re-reads the theme from settings changed somewhere else. */
  apply(theme: Theme): void
}

/**
 * The sidebar switch: a sun and a moon in one pill, the one in force pressed.
 *
 * A press is applied straight away and saved behind it, because waiting on
 * disk to re-colour a window feels broken. A save that fails puts the theme
 * back and says why, rather than leaving the window showing a preference that
 * was never recorded.
 */
export function createThemeToggle(
  host: HTMLElement,
  root: HTMLElement,
  bridge: ThemeBridge,
  initial: Theme,
  onApplied: (settings: PublicSettings) => void,
  system: SystemTheme = mediaSystemTheme()
): ThemeToggle {
  let theme = initial
  const group = document.createElement('div')
  group.className = 'theme-switch'
  group.setAttribute('role', 'group')
  group.setAttribute('aria-label', 'Theme')
  host.appendChild(group)

  const buttons = (['light', 'dark'] as const).map((mode) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.mode = mode
    button.innerHTML = mode === 'light' ? SUN : MOON
    group.appendChild(button)
    return { mode, button }
  })

  const draw = (applied: AppliedTheme): void => {
    for (const { mode, button } of buttons) {
      button.setAttribute('aria-pressed', String(mode === applied))
      button.title = themeButtonLabel(mode, theme)
      button.setAttribute('aria-label', themeButtonLabel(mode, theme))
    }
  }

  const set = (next: Theme): void => {
    theme = next
    draw(applyTheme(root, theme, system))
  }

  for (const { mode, button } of buttons) {
    button.addEventListener('click', () => {
      // A half already chosen does nothing. Pressing the half Windows put in
      // force is still a choice: it is saved, and the window stops following.
      if (theme === mode) return
      const previous = theme
      set(mode)
      group.removeAttribute('data-error')
      void bridge
        .saveSettings({ theme: mode })
        .then((settings) => onApplied(settings))
        .catch((error: unknown) => {
          set(previous)
          group.dataset.error = 'true'
          group.title =
            error instanceof Error
              ? `The theme could not be saved: ${error.message}`
              : 'The theme could not be saved.'
        })
    })
  }

  // Following Windows means following it live, not only at start-up.
  system.onChange(() => {
    if (theme === 'system') set('system')
  })

  set(initial)
  return {
    apply: (next: Theme) => {
      if (next !== theme) set(next)
    }
  }
}
