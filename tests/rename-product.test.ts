import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROTECTED_LINES, planRename } from '../scripts/rename-product.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const plan = planRename({ root: ROOT, name: 'Vocette', appId: 'app.vocette' })
const changed = (file: string) => plan.filter((change) => change.file === file)

describe('renaming the product (dry run)', () => {
  it('changes the one source of the display name, and the packaging names', () => {
    expect(changed('src/shared/product.ts').map((change) => change.after)).toContain(
      "export const PRODUCT_NAME = 'Vocette'"
    )
    const builder = changed('electron-builder.yml').map((change) => change.after)
    expect(builder).toContain('appId: app.vocette')
    expect(builder).toContain('productName: Vocette')
    expect(builder).toContain('  shortcutName: Vocette')
  })

  it('reaches what people read: window titles, messages, documents', () => {
    expect(changed('src/renderer/index.html').length).toBeGreaterThan(0)
    expect(changed('README.md').length).toBeGreaterThan(0)
    expect(plan.some((change) => change.after.includes('That does not look like a Vocette licence key.'))).toBe(true)
  })

  it('never touches the folders on disk, the identifiers, or history', () => {
    for (const change of plan) {
      expect(PROTECTED_LINES.some((pattern) => pattern.test(change.before))).toBe(false)
      expect(change.after).not.toMatch(/window\.vocette|VocetteApi|VOCETTE_/u)
    }
    const files = new Set(plan.map((change) => change.file))
    expect(files.has('CHANGELOG.md')).toBe(false)
    expect(files.has('tests/model-store.test.ts')).toBe(false)
    expect(files.has('tests/legacy-profile.test.ts')).toBe(false)
    expect([...files].some((file) => file.startsWith('docs/briefs/'))).toBe(false)
    // The profile folder keeps its name, so no one's settings or model are stranded.
    expect(readFileSync(join(ROOT, 'src/main/index.ts'), 'utf8')).toContain("app.setName('Murmur')")
    expect(changed('src/main/index.ts').some((change) => change.before.includes('app.setName'))).toBe(false)
  })

  it('changes only whole words', () => {
    for (const change of plan) {
      expect(change.after).not.toMatch(/Vocette[A-Za-z]/u)
    }
  })

  it('writes nothing', () => {
    expect(readFileSync(join(ROOT, 'src/shared/product.ts'), 'utf8')).toContain(
      "export const PRODUCT_NAME = 'Murmur'"
    )
  })

  it('refuses a name or app id that could break the code', () => {
    expect(() => planRename({ root: ROOT, name: "Murmur's", appId: 'app.vocette' })).toThrow()
    expect(() => planRename({ root: ROOT, name: 'V', appId: 'app.vocette' })).toThrow()
    expect(() => planRename({ root: ROOT, name: 'Vocette', appId: 'Vocette' })).toThrow()
    expect(() => planRename({ root: ROOT, name: 'Vocette', appId: 'app.Vocette' })).toThrow()
  })
})
