import { describe, expect, it } from 'vitest'
import {
  restoreSnapshot,
  takeSnapshot,
  type ClipboardLike
} from '../src/main/clipboard-custody'

/** A picture on the clipboard; only whether it is empty is ever asked. */
class FakeImage {
  constructor(private readonly pixels: string) {}
  isEmpty(): boolean {
    return this.pixels === ''
  }
}

const NO_IMAGE = new FakeImage('')

/**
 * Behaves like Electron's clipboard where it matters here: every write
 * replaces everything that was there, and the formats listed are the ones
 * actually held. `extraFormats` stands in for what the API cannot write back,
 * such as a file list copied in Explorer.
 */
class FakeClipboard implements ClipboardLike {
  text = ''
  html = ''
  rtf = ''
  image: FakeImage = NO_IMAGE
  extraFormats: string[] = []
  reads = 0
  readonly writes: Array<Record<string, unknown>> = []

  availableFormats(): string[] {
    return [
      ...(this.text ? ['text/plain'] : []),
      ...(this.html ? ['text/html'] : []),
      ...(this.rtf ? ['text/rtf'] : []),
      ...(this.image.isEmpty() ? [] : ['image/png']),
      ...this.extraFormats
    ]
  }

  readText(): string {
    this.reads += 1
    return this.text
  }

  readHTML(): string {
    this.reads += 1
    return this.html
  }

  readRTF(): string {
    this.reads += 1
    return this.rtf
  }

  readImage(): FakeImage {
    this.reads += 1
    return this.image
  }

  write(data: { text?: string; html?: string; rtf?: string; image?: unknown }): void {
    this.writes.push({ ...data })
    this.text = data.text ?? ''
    this.html = data.html ?? ''
    this.rtf = data.rtf ?? ''
    this.image = (data.image as FakeImage | undefined) ?? NO_IMAGE
    this.extraFormats = []
  }

  writeText(text: string): void {
    this.write({ text })
  }
}

const TRANSCRIPT = 'Send the report on Friday.'

describe('clipboard custody', () => {
  it('puts text, HTML, RTF and an image back together, in one write', () => {
    const clipboard = new FakeClipboard()
    const picture = new FakeImage('a chart')
    clipboard.text = 'Quarterly figures'
    clipboard.html = '<b>Quarterly figures</b>'
    clipboard.rtf = '{\\rtf1 Quarterly figures}'
    clipboard.image = picture

    const snapshot = takeSnapshot(clipboard)
    expect(snapshot.empty).toBe(false)
    clipboard.writeText(TRANSCRIPT)

    expect(restoreSnapshot(clipboard, snapshot, TRANSCRIPT)).toBe(true)
    expect(clipboard.writes.at(-1)).toEqual({
      text: 'Quarterly figures',
      html: '<b>Quarterly figures</b>',
      rtf: '{\\rtf1 Quarterly figures}',
      image: picture
    })
    expect(clipboard.text).toBe('Quarterly figures')
    // The very image that was read, not a copy of it.
    expect(clipboard.image).toBe(picture)
  })

  it('writes back only the formats that were there', () => {
    const clipboard = new FakeClipboard()
    clipboard.text = 'just words'
    const snapshot = takeSnapshot(clipboard)
    clipboard.writeText(TRANSCRIPT)

    restoreSnapshot(clipboard, snapshot, TRANSCRIPT)
    expect(clipboard.writes.at(-1)).toEqual({ text: 'just words' })

    const pictureOnly = new FakeClipboard()
    const screenshot = new FakeImage('a screenshot')
    pictureOnly.image = screenshot
    const imageSnapshot = takeSnapshot(pictureOnly)
    pictureOnly.writeText(TRANSCRIPT)

    expect(restoreSnapshot(pictureOnly, imageSnapshot, TRANSCRIPT)).toBe(true)
    expect(pictureOnly.writes.at(-1)).toEqual({ image: screenshot })
  })

  it('leaves the clipboard alone once something else has been copied', () => {
    const clipboard = new FakeClipboard()
    clipboard.text = 'what they had'
    const snapshot = takeSnapshot(clipboard)
    clipboard.writeText(TRANSCRIPT)
    // The user copied something new before the transcript was given back.
    clipboard.writeText('what they copied since')
    const writes = clipboard.writes.length

    expect(restoreSnapshot(clipboard, snapshot, TRANSCRIPT)).toBe(false)
    expect(clipboard.writes).toHaveLength(writes)
    expect(clipboard.text).toBe('what they copied since')
  })

  it('gives an empty clipboard back empty, without reading anything', () => {
    const clipboard = new FakeClipboard()
    const snapshot = takeSnapshot(clipboard)
    expect(snapshot.empty).toBe(true)
    expect(clipboard.reads).toBe(0)

    clipboard.writeText(TRANSCRIPT)
    expect(restoreSnapshot(clipboard, snapshot, TRANSCRIPT)).toBe(true)
    // The user had nothing copied, so the transcript does not stay behind.
    expect(clipboard.writes.at(-1)).toEqual({ text: '' })
    expect(clipboard.text).toBe('')
  })

  it('leaves the clipboard empty when nothing it held can be written back', () => {
    // A file list copied in Explorer: listed, but no format this API can
    // round-trip. It is lost either way; the transcript still does not stay.
    const clipboard = new FakeClipboard()
    clipboard.extraFormats = ['text/uri-list']
    const snapshot = takeSnapshot(clipboard)
    expect(snapshot.empty).toBe(true)

    clipboard.writeText(TRANSCRIPT)
    expect(restoreSnapshot(clipboard, snapshot, TRANSCRIPT)).toBe(true)
    expect(clipboard.text).toBe('')
  })

  it('still puts back what it can beside a format it cannot', () => {
    // An application's private format alongside its text: the text comes back.
    const clipboard = new FakeClipboard()
    clipboard.text = 'A1:B4'
    clipboard.html = '<table></table>'
    clipboard.extraFormats = ['application/x-spreadsheet']
    const snapshot = takeSnapshot(clipboard)
    clipboard.writeText(TRANSCRIPT)

    expect(restoreSnapshot(clipboard, snapshot, TRANSCRIPT)).toBe(true)
    expect(clipboard.writes.at(-1)).toEqual({ text: 'A1:B4', html: '<table></table>' })
  })

  it('restores a clipboard that held the same text as the transcript', () => {
    const clipboard = new FakeClipboard()
    clipboard.text = TRANSCRIPT
    clipboard.html = `<p>${TRANSCRIPT}</p>`
    const snapshot = takeSnapshot(clipboard)
    clipboard.writeText(TRANSCRIPT)

    expect(restoreSnapshot(clipboard, snapshot, TRANSCRIPT)).toBe(true)
    expect(clipboard.html).toBe(`<p>${TRANSCRIPT}</p>`)
  })
})
