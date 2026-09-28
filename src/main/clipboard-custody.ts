/**
 * Borrowing the user's clipboard for a paste, and giving it back.
 *
 * Automatic paste works by putting the transcript on the clipboard and sending
 * the paste chord, which throws away whatever the user had copied. Dictation
 * tools generally leave the transcript there for good. Murmur takes a copy of
 * the clipboard first, so it can be put back once the paste has landed.
 *
 * Pure logic behind a narrow interface: Electron's `clipboard` satisfies it in
 * production, and a plain object does in the tests.
 *
 * Only text, HTML, RTF and an image can be put back: they are the formats
 * Electron's clipboard API can write together in one go. Anything else — a
 * file list copied in Explorer, an application's own private format beside its
 * text — cannot be round-tripped through it. Where the clipboard held one of
 * those, what can be restored is restored and the rest is lost, exactly as all
 * of it was lost, for good, before this module existed.
 */

/** The slice of Electron's `clipboard` this needs. */
export interface ClipboardLike {
  availableFormats(): string[]
  readText(): string
  readHTML(): string
  readRTF(): string
  /** A `NativeImage` in production; only whether it is empty matters here. */
  readImage(): { isEmpty(): boolean }
  write(data: { text?: string; html?: string; rtf?: string; image?: unknown }): void
  writeText(text: string): void
}

/** What the user had on the clipboard, in the formats that can be put back. */
export interface ClipboardSnapshot {
  text: string
  html: string
  rtf: string
  /** Handed back to `write` exactly as it was read; null when there was none. */
  image: unknown | null
  /** Nothing that can be put back: restoring leaves the clipboard empty. */
  empty: boolean
}

const NOTHING: ClipboardSnapshot = { text: '', html: '', rtf: '', image: null, empty: true }

/** Copies the clipboard. Call it before the transcript is written, never after. */
export function takeSnapshot(clipboard: ClipboardLike): ClipboardSnapshot {
  // An empty clipboard has nothing to read, and restoring it means emptying it.
  if (clipboard.availableFormats().length === 0) return { ...NOTHING }

  const text = clipboard.readText()
  const html = clipboard.readHTML()
  const rtf = clipboard.readRTF()
  const picture = clipboard.readImage()
  const image = picture.isEmpty() ? null : picture
  return {
    text,
    html,
    rtf,
    image,
    // Formats were listed, but none of them is one that can be written back —
    // a file list, say. The transcript was never the user's either, so it goes
    // rather than stays: the clipboard is left empty, as for an empty snapshot.
    empty: !text && !html && !rtf && image === null
  }
}

/**
 * Puts a snapshot back, but only while the clipboard still holds `ours`.
 *
 * Returns false, and writes nothing, once anything else has gone onto the
 * clipboard since the transcript did: the user copied something new, or the
 * app the text was pasted into rewrote it. That is theirs now.
 */
export function restoreSnapshot(
  clipboard: ClipboardLike,
  snapshot: ClipboardSnapshot,
  ours: string
): boolean {
  if (clipboard.readText() !== ours) return false

  if (snapshot.empty) {
    // The user had nothing copied, so leaving the transcript there would be a
    // change they did not make.
    clipboard.writeText('')
    return true
  }

  // One write, so every format goes back together, as a single clipboard
  // entry. Formats that were not there are left out rather than written empty.
  const data: { text?: string; html?: string; rtf?: string; image?: unknown } = {}
  if (snapshot.text) data.text = snapshot.text
  if (snapshot.html) data.html = snapshot.html
  if (snapshot.rtf) data.rtf = snapshot.rtf
  if (snapshot.image !== null) data.image = snapshot.image
  clipboard.write(data)
  return true
}
