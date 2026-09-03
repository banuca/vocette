import type { ForegroundState } from './dictation-controller'

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
 * app behaves exactly like before: it pastes and hopes for the best.
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

export class ForegroundTracker {
  private readonly getForegroundWindow: (() => bigint | null) | null
  private readonly isElevatedWindow: ((hwnd: bigint) => boolean) | null
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

      const GetForegroundWindow = user32.func('void * GetForegroundWindow()')
      const GetWindowThreadProcessId = user32.func(
        'uint32 GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *lpdwProcessId)'
      )
      const OpenProcess = kernel32.func(
        'void * OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)'
      )
      const CloseHandle = kernel32.func('bool CloseHandle(void *hObject)')
      const OpenProcessToken = advapi32.func(
        'bool OpenProcessToken(void *ProcessHandle, uint32 DesiredAccess, _Out_ void *TokenHandle)'
      )
      const GetTokenInformation = advapi32.func(
        'bool GetTokenInformation(void *TokenHandle, int TokenInformationClass, _Out_ uint32 *TokenInformation, uint32 TokenInformationLength, _Out_ uint32 *ReturnLength)'
      )

      const asHandle = (value: unknown): bigint | null => {
        if (typeof value === 'bigint') return value === 0n ? null : value
        if (typeof value === 'number') return value === 0 ? null : BigInt(value)
        return null
      }

      this.getForegroundWindow = () => {
        try {
          return asHandle(GetForegroundWindow()) as bigint | null
        } catch {
          return null
        }
      }

      this.isElevatedWindow = (hwnd) => {
        const processId = [0]
        try {
          const threadId = GetWindowThreadProcessId(hwnd, processId)
          if (!threadId || processId[0] === 0) return false

          const process = asHandle(OpenProcess(0x1000 /* QUERY_LIMITED_INFORMATION */, 0, processId[0]))
          if (!process) return false
          try {
            const token = [null]
            if (!OpenProcessToken(process, 0x0008 /* TOKEN_QUERY */, token)) return false
            const tokenHandle = asHandle(token[0])
            if (!tokenHandle) return false
            try {
              const elevated = [0]
              const ok = GetTokenInformation(tokenHandle, 20 /* TokenElevation */, elevated, 4, [0])
              return ok && elevated[0] !== 0
            } finally {
              CloseHandle(tokenHandle)
            }
          } finally {
            CloseHandle(process)
          }
        } catch {
          return false
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
      this.target = this.getForegroundWindow()
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
      return {
        sameWindow: current === this.target,
        elevated: this.isElevatedWindow(current)
      }
    } catch {
      return null
    }
  }
}
