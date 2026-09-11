import { UiohookKey, uIOhook } from 'uiohook-napi'
import { ShortcutController } from '../shortcut-controller'
import type { ShortcutBackend, ShortcutBackendOptions } from './types'

/**
 * The keyboard-hook half of the platform layer, in its own module so it can be
 * imported lazily.
 *
 * `uiohook-napi` is a native module. On an architecture it has no prebuild for
 * it throws at load time, and a static import would take the whole main
 * process — and therefore the window — down with it. Every caller reaches this
 * through a dynamic import and treats a null result as "no global input here".
 */
export type PasteModifier = 'ctrl' | 'meta'

export interface HookModule {
  createBackend(options: ShortcutBackendOptions): ShortcutBackend
  /** Injects the platform's paste chord into whatever has focus. */
  paste(modifier: PasteModifier): void
}

export const hookModule: HookModule = {
  createBackend: (options) => new ShortcutController(options),
  paste: (modifier) => {
    uIOhook.keyTap(UiohookKey.V, [modifier === 'meta' ? UiohookKey.Meta : UiohookKey.Ctrl])
  }
}
