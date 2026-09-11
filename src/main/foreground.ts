import type { ForegroundState } from './dictation-controller'
import { handleOf, type NativeHandle } from './platform/native-address'
import type { TargetTracker } from './platform/types'

/**
 * Windows foreground-window tracking, used to keep auto-paste honest.
 *
 * Two facts drive it:
 *  - Injected keystrokes cannot reach elevated windows (UIPI), so pasting
 *    into an admin terminal silently does nothing.
 *  - Transcription takes seconds; the user may have switched windows, so the
 *    paste would land somewhere they never intended.
 *
 * The window handle is captured when the take starts and compared when the
 * transcript is ready. If the focus moved, or the focused app runs elevated,
 * the controller falls back to "Copied — paste manually" instead of claiming
 * a paste that never happened.
 *
 * All Win32 calls go through koffi (N-API, no build toolchain). If the module
 * is unavailable for any reason, every method degrades to "unknown" and the
 * controller conservatively leaves the transcript on the clipboard.
 *
 * The loader is injectable so the whole class is testable without the native
 * module; production code uses the bundled `require`.
 */
export type KoffiLoader = () => typeof import('koffi') | null

function defaultKoffiLoader(): typeof import('koffi') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('koffi') as typeof import('koffi') | null
  } catch {
    return null
  }
}

export class ForegroundTracker implements TargetTracker {
  private readonly getForegroundWindow: (() => NativeHandle | null) | null
  private readonly isElevatedWindow: ((window: NativeHandle) => boolean | null) | null
  /** Only the address is retained: the pointer object itself is not reusable. */
  private target: bigint | null = null

  constructor(loadKoffi: KoffiLoader = defaultKoffiLoader) {
    this.getForegroundWindow = null
    this.isElevatedWindow = null
    try {
      const koffi = loadKoffi()
      if (!koffi) return

      const user32 = koffi.load('user32.dll')
      const kernel32 = koffi.load('kernel32.dll')
      const advapi32 = koffi.load('advapi32.dll')

      // Win32 BOOL is a 32-bit int, not the single-byte C `bool` that koffi
      // maps `bool` to, and PHANDLE is a pointer *to* a handle — hence
      // `void **`. Declaring either loosely marshals the wrong width and
      // misreads the result.
      const GetForegroundWindow = user32.func('void * GetForegroundWindow()')
      const GetWindowThreadProcessId = user32.func(
        'uint32 GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *lpdwProcessId)'
      )
      const OpenProcess = kernel32.func(
        'void * OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)'
      )
      const CloseHandle = kernel32.func('int CloseHandle(void *hObject)')
      const OpenProcessToken = advapi32.func(
        'int OpenProcessToken(void *ProcessHandle, uint32 DesiredAccess, _Out_ void **TokenHandle)'
      )
      const GetTokenInformation = advapi32.func(
        'int GetTokenInformation(void *TokenHandle, int TokenInformationClass, _Out_ uint32 *TokenInformation, uint32 TokenInformationLength, _Out_ uint32 *ReturnLength)'
      )

      // Opaque koffi pointers, numeric handles and every failure mode are
      // handled in one place, shared with the macOS and X11 trackers.
      const toHandle = (value: unknown): NativeHandle | null => handleOf(koffi, value)

      this.getForegroundWindow = () => {
        try {
          return toHandle(GetForegroundWindow())
        } catch {
          return null
        }
      }

      this.isElevatedWindow = (window) => {
        const processId = [0]
        try {
          const threadId = GetWindowThreadProcessId(window.value, processId)
          if (!threadId || processId[0] === 0) return null

          const process = toHandle(
            OpenProcess(0x1000 /* QUERY_LIMITED_INFORMATION */, 0, processId[0])
          )
          if (!process) return null
          try {
            const tokenOut = [null]
            if (!OpenProcessToken(process.value, 0x0008 /* TOKEN_QUERY */, tokenOut)) return null
            const token = toHandle(tokenOut[0])
            if (!token) return null
            try {
              const elevated = [0]
              const ok = GetTokenInformation(token.value, 20 /* TokenElevation */, elevated, 4, [0])
              return ok ? elevated[0] !== 0 : null
            } finally {
              CloseHandle(token.value)
            }
          } finally {
            CloseHandle(process.value)
          }
        } catch {
          return null
        }
      }
    } catch {
      // Native dependency unavailable; degrade gracefully.
    }
  }

  isAvailable(): boolean {
    return this.getForegroundWindow !== null
  }

  capture(): void {
    if (!this.getForegroundWindow) return
    try {
      this.target = this.getForegroundWindow()?.address ?? null
    } catch {
      this.target = null
    }
  }

  clear(): void {
    this.target = null
  }

  check(): ForegroundState | null {
    if (!this.getForegroundWindow || !this.isElevatedWindow) return null
    try {
      const current = this.getForegroundWindow()
      if (current === null) return null
      const elevated = this.isElevatedWindow(current)
      if (elevated === null) return null
      return {
        // Compared by address: koffi returns a fresh wrapper object on every
        // call, so object identity would report "focus moved" every time.
        sameWindow: this.target !== null && current.address === this.target,
        elevated
      }
    } catch {
      return null
    }
  }
}
