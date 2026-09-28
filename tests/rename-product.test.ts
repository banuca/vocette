import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROTECTED_LINES, currentName, planRename } from '../scripts/rename-product.mjs'

const ROOT = resolve(import.meta.dirname, '..')
// Written against whatever the product is called, so it still holds after a rename.
const CURRENT = currentName(ROOT)
const TARGET = CURRENT === 'Vocette' ? 'Quietword' : 'Vocette'
const APP_ID = `app.${TARGET.toLowerCase()}`
const plan = planRename({ root: ROOT, name: TARGET, appId: APP_ID })
const changed = (file: string) => plan.filter((change) => change.file === file)

describe('renaming the product (dry run)', () => {
  it('changes the one source of the display name, and the packaging names', () => {
    expect(changed('src/shared/product.ts').map((change) => change.after)).toContain(
      `export const PRODUCT_NAME = '${TARGET}'`
    )
    const builder = changed('electron-builder.yml').map((change) => change.after)
    expect(builder).toContain(`appId: ${APP_ID}`)
    expect(builder).toContain(`productName: ${TARGET}`)
    expect(builder).toContain(`  shortcutName: ${TARGET}`)
  })

  it('reaches what people read: window titles, messages, documents', () => {
    expect(changed('src/renderer/index.html').length).toBeGreaterThan(0)
    expect(changed('README.md').length).toBeGreaterThan(0)
    expect(
      plan.some((change) => change.after.includes(`That does not look like a ${TARGET} licence key.`))
    ).toBe(true)
  })

  it('never touches the folders on disk, the identifiers, or history', () => {
    const lower = TARGET.toLowerCase()
    for (const change of plan) {
      expect(PROTECTED_LINES.some((pattern) => pattern.test(change.before))).toBe(false)
      expect(change.after).not.toContain(`window.${lower}`)
      expect(change.after).not.toContain(`${TARGET}Api`)
      expect(change.after).not.toContain(`${TARGET.toUpperCase()}_`)
    }
    const files = new Set(plan.map((change) => change.file))
    expect(files.has('CHANGELOG.md')).toBe(false)
    expect(files.has('tests/model-store.test.ts')).toBe(false)
    expect(files.has('tests/legacy-profile.test.ts')).toBe(false)
    expect([...files].some((file) => file.startsWith('docs/briefs/'))).toBe(false)
    // The profile folder keeps the name it was created with, so no one's
    // settings or model are stranded by a rename.
    expect(readFileSync(join(ROOT, 'src/main/index.ts'), 'utf8')).toContain("app.setName('Murmur')")
    expect(changed('src/main/index.ts').some((change) => change.before.includes('app.setName'))).toBe(false)
  })

  it('changes only whole words', () => {
    for (const change of plan) {
      expect(change.after).not.toMatch(new RegExp(`${TARGET}[A-Za-z]`, 'u'))
    }
  })

  it('writes nothing', () => {
    expect(readFileSync(join(ROOT, 'src/shared/product.ts'), 'utf8')).toContain(
      `export const PRODUCT_NAME = '${CURRENT}'`
    )
  })

  it('refuses a name or app id that could break the code, or the name already in use', () => {
    expect(() => planRename({ root: ROOT, name: `${TARGET}'s`, appId: APP_ID })).toThrow()
    expect(() => planRename({ root: ROOT, name: 'V', appId: APP_ID })).toThrow()
    expect(() => planRename({ root: ROOT, name: TARGET, appId: TARGET })).toThrow()
    expect(() => planRename({ root: ROOT, name: TARGET, appId: `app.${TARGET}` })).toThrow()
    expect(() => planRename({ root: ROOT, name: CURRENT, appId: APP_ID })).toThrow(
      `The product is already called ${CURRENT}.`
    )
  })
})
