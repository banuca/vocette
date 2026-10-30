import { describe, expect, it, vi } from 'vitest'
import {
  PRIVACY_FORMATS,
  createTranscriptWriter,
  loadClipboardApi,
  unicodeTextBytes,
  windowHandle,
  writePrivateText,
  type ClipboardApi
} from '../src/main/platform/private-clipboard'

/**
 * A transcript goes on the Windows clipboard as one item: the text and the
 * three formats that keep it out of clipboard history and cloud sync. When
 * that cannot be done, it still goes on, the ordinary way.
 */

const FORMAT_IDS: Record<string, number> = {
  [PRIVACY_FORMATS.exclude]: 0xc101,
  [PRIVACY_FORMATS.history]: 0xc102,
  [PRIVACY_FORMATS.cloud]: 0xc103
}

function fakeApi(overrides: Partial<ClipboardApi> = {}) {
  const calls: string[] = []
  const placed: Array<{ format: number; bytes: number[] }> = []
  const api: ClipboardApi = {
    open: vi.fn((owner: bigint) => {
      calls.push(`open ${owner}`)
      return true
    }),
    empty: vi.fn(() => {
      calls.push('empty')
      return true
    }),
    set: vi.fn((format: number, bytes: Uint8Array) => {
      calls.push(`set ${format}`)
      placed.push({ format, bytes: [...bytes] })
      return true
    }),
    register: vi.fn((name: string) => FORMAT_IDS[name] ?? 0),
    close: vi.fn(() => {
      calls.push('close')
    }),
    ...overrides
  }
  return { api, calls, placed }
}

const noWait = (): void => undefined

describe('writePrivateText', () => {
  it('puts the text and the three formats on in one item, owned by the window', () => {
    const { api, calls, placed } = fakeApi()
    expect(writePrivateText(api, 0x1234n, 'Send the draft.', noWait)).toBe(true)
    expect(calls).toEqual(['open 4660', 'empty', 'set 13', 'set 49409', 'set 49410', 'set 49411', 'close'])
    expect(Buffer.from(placed[0]?.bytes ?? []).toString('utf16le')).toBe('Send the draft.\0')
    // Each privacy format holds a DWORD of zero.
    for (const entry of placed.slice(1)) expect(entry.bytes).toEqual([0, 0, 0, 0])
    expect(api.register).toHaveBeenCalledWith('ExcludeClipboardContentFromMonitorProcessing')
    expect(api.register).toHaveBeenCalledWith('CanIncludeInClipboardHistory')
    expect(api.register).toHaveBeenCalledWith('CanUploadToCloudClipboard')
  })

  it('waits a moment for a clipboard another app is holding, then gives up', () => {
    const waits: number[] = []
    let attempts = 0
    const busy = fakeApi({
      open: () => {
        attempts += 1
        return attempts === 3
      }
    })
    expect(writePrivateText(busy.api, 1n, 'Hi.', (ms) => waits.push(ms))).toBe(true)
    expect(waits).toEqual([5, 5])

    const held = fakeApi({ open: () => false })
    expect(writePrivateText(held.api, 1n, 'Hi.', noWait)).toBe(false)
    expect(held.api.close).not.toHaveBeenCalled()
    expect(held.api.set).not.toHaveBeenCalled()
  })

  it('reports failure, and still closes the clipboard, when the text cannot go on', () => {
    const noEmpty = fakeApi({ empty: () => false })
    expect(writePrivateText(noEmpty.api, 1n, 'Hi.', noWait)).toBe(false)
    expect(noEmpty.api.close).toHaveBeenCalledTimes(1)

    const noText = fakeApi({ set: () => false })
    expect(writePrivateText(noText.api, 1n, 'Hi.', noWait)).toBe(false)
    expect(noText.api.close).toHaveBeenCalledTimes(1)
  })

  it('does not touch the clipboard when a format cannot be registered', () => {
    const { api } = fakeApi({ register: () => 0 })
    expect(writePrivateText(api, 1n, 'Hi.', noWait)).toBe(false)
    expect(api.open).not.toHaveBeenCalled()
  })
})

describe('unicodeTextBytes', () => {
  it('is UTF-16LE with a terminating NUL, whatever the script', () => {
    const bytes = unicodeTextBytes('Zürich 😀\nnext')
    expect(Buffer.from(bytes).toString('utf16le')).toBe('Zürich 😀\nnext\0')
    expect(bytes.length).toBe(('Zürich 😀\nnext'.length + 1) * 2)
  })
})

describe('createTranscriptWriter', () => {
  it('writes privately when it can, loading the Win32 calls once', () => {
    const { api } = fakeApi()
    const load = vi.fn(() => api)
    const fallback = vi.fn()
    const write = createTranscriptWriter({ owner: () => 7n, fallback, load })
    write('One.')
    write('Two.')
    expect(load).toHaveBeenCalledTimes(1)
    expect(api.empty).toHaveBeenCalledTimes(2)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('falls back to the ordinary write whenever the private one cannot be made', () => {
    const cases: Array<Parameters<typeof createTranscriptWriter>[0]> = [
      { owner: () => 7n, fallback: vi.fn(), load: () => null },
      { owner: () => null, fallback: vi.fn(), load: () => fakeApi().api },
      { owner: () => 7n, fallback: vi.fn(), load: () => fakeApi({ open: () => false }).api },
      {
        owner: () => {
          throw new Error('window gone')
        },
        fallback: vi.fn(),
        load: () => fakeApi().api
      },
      {
        owner: () => 7n,
        fallback: vi.fn(),
        load: () => {
          throw new Error('koffi missing')
        }
      }
    ]
    for (const options of cases) {
      createTranscriptWriter(options)('Still delivered.')
      expect(options.fallback).toHaveBeenCalledWith('Still delivered.')
    }
  })
})

describe('windowHandle', () => {
  it('reads the handle Electron gives as a number, and refuses none', () => {
    const handle = Buffer.alloc(8)
    handle.writeBigUInt64LE(0x5e0a2cn)
    expect(windowHandle(handle)).toBe(0x5e0a2cn)
    const narrow = Buffer.alloc(4)
    narrow.writeUInt32LE(0x1234)
    expect(windowHandle(narrow)).toBe(0x1234n)
    expect(windowHandle(Buffer.alloc(8))).toBeNull()
    expect(windowHandle(null)).toBeNull()
  })
})

describe('loadClipboardApi', () => {
  it('is null when the native module cannot be loaded', () => {
    expect(loadClipboardApi(() => null)).toBeNull()
    expect(
      loadClipboardApi(() => {
        throw new Error('no koffi')
      })
    ).toBeNull()
  })
})
