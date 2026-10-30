/**
 * Putting a transcript on the Windows clipboard without it being kept in
 * clipboard history (Win + V) or synced to the user's other devices.
 *
 * Vocette delivers every transcript through the clipboard. Windows keeps each
 * clipboard item in its history, and with cloud clipboard on, uploads it,
 * unless the writer adds three registered formats in the same write
 * (Microsoft Learn, "Clipboard Formats": Cloud Clipboard and Clipboard History
 * Formats):
 *  - ExcludeClipboardContentFromMonitorProcessing, any data: keeps the item
 *    out of history and sync, and tells clipboard monitors to leave it;
 *  - CanIncludeInClipboardHistory, a DWORD 0: not in history;
 *  - CanUploadToCloudClipboard, a DWORD 0: not synced.
 *
 * Electron's clipboard API cannot write a registered format beside the text:
 * every write empties the clipboard first, and adding the formats in a second
 * write would come after history had already taken the text. So the text and
 * the three formats go in one Win32 transaction here, through koffi like the
 * rest of the Win32 code. Anything that fails leaves the caller to write the
 * text the ordinary way: a transcript is never lost to a privacy flag.
 */
import type { KoffiLoader } from '../foreground'
import { addressOf } from './native-address'

export const PRIVACY_FORMATS = {
  exclude: 'ExcludeClipboardContentFromMonitorProcessing',
  history: 'CanIncludeInClipboardHistory',
  cloud: 'CanUploadToCloudClipboard'
} as const

/** CF_UNICODETEXT: UTF-16 text, ending in a NUL. */
const CF_UNICODETEXT = 13
const GMEM_MOVEABLE = 0x0002
/** Another app may hold the clipboard for a moment; Chromium waits the same way. */
const OPEN_ATTEMPTS = 5
const OPEN_RETRY_MS = 5

/** The Win32 calls the write needs, so the sequence can be tested without them. */
export interface ClipboardApi {
  open(owner: bigint): boolean
  empty(): boolean
  /** Places a copy of `bytes` on the clipboard in `format`. */
  set(format: number, bytes: Uint8Array): boolean
  register(name: string): number
  close(): void
}

/** The text as CF_UNICODETEXT wants it: UTF-16LE with its terminating NUL. */
export function unicodeTextBytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(`${text}\0`, 'utf16le'))
}

/** A DWORD of zero, as CanIncludeInClipboardHistory and CanUploadToCloudClipboard take it. */
const DWORD_ZERO = new Uint8Array(4)

/**
 * Writes `text` and the three formats as one clipboard item, owned by the
 * window `owner`. True only when the text went on; then the item carries the
 * formats too, unless Windows refused one of them.
 */
export function writePrivateText(
  api: ClipboardApi,
  owner: bigint,
  text: string,
  wait: (ms: number) => void = sleepSync
): boolean {
  const formats = [PRIVACY_FORMATS.exclude, PRIVACY_FORMATS.history, PRIVACY_FORMATS.cloud].map((name) =>
    api.register(name)
  )
  if (formats.some((format) => !format)) return false

  let opened = false
  for (let attempt = 0; attempt < OPEN_ATTEMPTS && !opened; attempt += 1) {
    if (attempt > 0) wait(OPEN_RETRY_MS)
    opened = api.open(owner)
  }
  if (!opened) return false
  try {
    // Emptying makes `owner` the clipboard's owner, which SetClipboardData needs.
    if (!api.empty()) return false
    if (!api.set(CF_UNICODETEXT, unicodeTextBytes(text))) return false
    for (const format of formats) api.set(format, DWORD_ZERO)
    return true
  } finally {
    api.close()
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function defaultKoffiLoader(): typeof import('koffi') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('koffi') as typeof import('koffi') | null
  } catch {
    return null
  }
}

/** The Win32 clipboard through koffi; null when it cannot be loaded. */
export function loadClipboardApi(loadKoffi: KoffiLoader = defaultKoffiLoader): ClipboardApi | null {
  try {
    const koffi = loadKoffi()
    if (!koffi) return null
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    // Win32 BOOL is a 32-bit int, and an HWND is passed by value: a
    // pointer-sized integer, which is what Electron hands over.
    const OpenClipboard = user32.func('int OpenClipboard(uintptr_t hWndNewOwner)')
    const EmptyClipboard = user32.func('int EmptyClipboard()')
    const CloseClipboard = user32.func('int CloseClipboard()')
    const SetClipboardData = user32.func('void * SetClipboardData(uint32 uFormat, void *hMem)')
    const RegisterClipboardFormatW = user32.func('uint32 RegisterClipboardFormatW(str16 lpszFormat)')
    const GlobalAlloc = kernel32.func('void * GlobalAlloc(uint32 uFlags, uintptr_t dwBytes)')
    const GlobalLock = kernel32.func('void * GlobalLock(void *hMem)')
    const GlobalUnlock = kernel32.func('int GlobalUnlock(void *hMem)')
    const GlobalFree = kernel32.func('void * GlobalFree(void *hMem)')
    const RtlMoveMemory = kernel32.func('void RtlMoveMemory(void *Destination, const void *Source, uintptr_t Length)')
    const live = (pointer: unknown): boolean => addressOf(koffi, pointer) !== null

    return {
      open: (owner) => OpenClipboard(owner) !== 0,
      empty: () => EmptyClipboard() !== 0,
      close: () => void CloseClipboard(),
      register: (name) => Number(RegisterClipboardFormatW(name)) || 0,
      set: (format, bytes) => {
        const memory: unknown = GlobalAlloc(GMEM_MOVEABLE, bytes.length)
        if (!live(memory)) return false
        const target: unknown = GlobalLock(memory)
        if (!live(target)) {
          GlobalFree(memory)
          return false
        }
        try {
          RtlMoveMemory(target, bytes, bytes.length)
        } finally {
          GlobalUnlock(memory)
        }
        // Once the clipboard has it, the memory is the system's to free.
        if (live(SetClipboardData(format, memory))) return true
        GlobalFree(memory)
        return false
      }
    }
  } catch {
    return null
  }
}

export interface TranscriptWriterOptions {
  /** The window that will own the clipboard item, as its native handle; null when there is none. */
  owner(): bigint | null
  /** The ordinary write, for when the private one cannot be made. */
  fallback(text: string): void
  /** Loads the Win32 calls; injected in tests. */
  load?: () => ClipboardApi | null
}

/**
 * The clipboard writer for transcripts on Windows: privately when it can,
 * otherwise as before. The Win32 calls are loaded on first use.
 */
export function createTranscriptWriter(options: TranscriptWriterOptions): (text: string) => void {
  let api: ClipboardApi | null | undefined
  return (text) => {
    try {
      if (api === undefined) api = (options.load ?? loadClipboardApi)()
      const owner = options.owner()
      if (api && owner !== null && writePrivateText(api, owner, text)) return
    } catch {
      // Whatever failed, the transcript still goes on the clipboard below.
    }
    options.fallback(text)
  }
}

/** A window's handle as Electron gives it (`getNativeWindowHandle`), as a number. */
export function windowHandle(buffer: Buffer | null | undefined): bigint | null {
  if (!buffer) return null
  const value =
    buffer.length >= 8 ? buffer.readBigUInt64LE(0) : buffer.length >= 4 ? BigInt(buffer.readUInt32LE(0)) : 0n
  return value === 0n ? null : value
}
