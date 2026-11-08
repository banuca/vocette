import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * Vocette is free for everyone. Nothing in the app may show a price, a trial,
 * a Pro tier or a limit to run into, and nothing may talk to the payment
 * provider. Every source file the app is built from is read, so a sentence
 * like that cannot come back unnoticed, in a page, the pill or the tray.
 */

const ROOT = resolve(import.meta.dirname, '..')

/** Every TypeScript and HTML file under `src/`, as a path from the repository root. */
const SOURCES = readdirSync(join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
  .filter((file) => /\.(?:ts|html)$/u.test(file))
  .map((file) => `src/${file.split('\\').join('/')}`)

/**
 * The files allowed one of the words, and why. Nothing else is.
 * - The settings store reads an old profile's trial date and finds its licence
 *   key, to keep the date as the first run and take the key off the disk.
 * - Cleanup tidies prices the user dictates, such as "US$49".
 */
const STORE = 'src/main/settings-store.ts'
const FORBIDDEN: ReadonlyArray<{ what: string; pattern: RegExp; allowed: readonly string[] }> = [
  {
    what: 'a price',
    pattern: /\b(?:US|A|C|NZ)\$\s?\d|[€£]\s?\d|\b(?:a|per) (?:month|year)\b|two months free/iu,
    allowed: ['src/shared/cleanup.ts']
  },
  { what: 'a trial', pattern: /\btrial\b/iu, allowed: [STORE] },
  { what: 'a Pro tier', pattern: /\bPro\b/u, allowed: [] },
  {
    what: 'a subscription, a checkout or a licence key',
    pattern: /\bSubscribe\b|\bsubscription\b|\bcheckout\b|customer portal|licen[cs]e key/iu,
    allowed: [STORE]
  },
  { what: 'the payment provider', pattern: /polar/iu, allowed: [STORE] },
  {
    what: 'a word limit',
    pattern: /free words|words? (?:a|per|this) month|word limit|monthly limit|10,000 words|used up|\bupgrade\b/iu,
    allowed: []
  }
]

describe('free for everyone', () => {
  it('reads the whole app', () => {
    expect(SOURCES.length).toBeGreaterThan(50)
    for (const file of ['src/main/index.ts', 'src/renderer/main.ts', 'src/renderer/index.html']) {
      expect(SOURCES).toContain(file)
    }
  })

  for (const { what, pattern, allowed } of FORBIDDEN) {
    it(`shows nowhere ${what}`, () => {
      const found = SOURCES.filter((file) => !allowed.includes(file))
        .flatMap((file) =>
          readFileSync(join(ROOT, file), 'utf8')
            .split('\n')
            .map((line, index) => ({ file, line: index + 1, text: line.trim() }))
        )
        .filter(({ text }) => pattern.test(text))
        .map(({ file, line, text }) => `${file}:${line}: ${text}`)
      expect(found).toEqual([])
    })
  }

  it('has three pages in the window, and no Pro page', () => {
    const shell = readFileSync(join(ROOT, 'src/renderer/main.ts'), 'utf8')
    const pages = [...shell.matchAll(/data-page="([a-z]+)"/gu)].map((match) => match[1])
    expect(pages).toEqual(['history', 'settings', 'about'])
    expect(SOURCES).not.toContain('src/renderer/pages/pro.ts')
  })

  it('gives the window no call about a licence, a plan, a trial or a subscription', async () => {
    const exposed: Record<string, Record<string, unknown>> = {}
    vi.resetModules()
    vi.doMock('electron', () => ({
      contextBridge: {
        exposeInMainWorld: (name: string, api: Record<string, unknown>) => {
          exposed[name] = api
        }
      },
      ipcRenderer: { invoke: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() }
    }))
    try {
      await import('../src/preload/index')
    } finally {
      vi.doUnmock('electron')
    }
    const calls = Object.keys(exposed.murmur ?? {})
    expect(calls).toContain('getSettings')
    expect(calls.filter((name) => /licen|plan|trial|subscri|checkout|allowance/iu.test(name))).toEqual([])
  })
})
