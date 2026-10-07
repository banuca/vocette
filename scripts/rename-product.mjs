#!/usr/bin/env node
/**
 * Renames the product everywhere a person reads its name, and nowhere else.
 *
 *   node scripts/rename-product.mjs "<New Name>" <new.app.id> [--dry-run]
 *
 * Replaces the whole word of the current name — `PRODUCT_NAME` in
 * src/shared/product.ts, so the script works again after a rename — in the
 * source, the tests, the packaging configuration and the user-facing
 * documents, and sets the new `appId`. Every
 * change is printed. Without --dry-run it refuses to run on a working tree
 * with uncommitted changes, so the rename is one reviewable commit.
 *
 * Left alone on purpose:
 * - `app.setName('Murmur')`, the models folder (`%LOCALAPPDATA%\Murmur\models`)
 *   and the legacy-profile list: they name folders on users' disks. Renaming
 *   them would strand every existing profile and the downloaded model; the
 *   legacy-profile migration can move the folder in a later release instead.
 * - Identifiers and machinery: `window.murmur`, `MurmurApi`, `MURMUR_*`
 *   variables, `murmur.desktop`, the npm package name — none of them are read
 *   by a user, and the whole-word, case-sensitive match never reaches them.
 * - CHANGELOG.md, which is history, and the working documents under docs/.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The name in use now, as `src/shared/product.ts` declares it. */
export function currentName(root) {
  const source = readFileSync(join(root, 'src', 'shared', 'product.ts'), 'utf8')
  const match = /export const PRODUCT_NAME = '([^']+)'/u.exec(source)
  if (!match?.[1]) throw new Error('PRODUCT_NAME was not found in src/shared/product.ts.')
  return match[1]
}

/**
 * Lines that name folders on disk; they keep the name the folders were
 * created with, whatever the product is called now.
 */
export const PROTECTED_LINES = [
  /app\.setName\(/u,
  /LEGACY_PROFILE_NAMES/u,
  /join\(localAppData, 'Murmur', 'models'\)/u
]

/** Tests about those folders, which must keep matching them. */
const PROTECTED_FILES = new Set(['tests/model-store.test.ts', 'tests/legacy-profile.test.ts'])

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9 ]{1,29}$/u
const APP_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u

function walk(directory, extensions, found = []) {
  if (!existsSync(directory)) return found
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) walk(path, extensions, found)
    else if (extensions.some((extension) => entry.endsWith(extension))) found.push(path)
  }
  return found
}

/** Every file a rename may touch. */
function candidates(root) {
  return [
    ...walk(join(root, 'src'), ['.ts', '.html']),
    ...walk(join(root, 'tests'), ['.ts']),
    ...walk(join(root, 'site'), ['.html']),
    ...['electron-builder.yml', 'package.json', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'docs/release.md', 'resources/eula.txt']
      .map((file) => join(root, file))
      .filter((file) => existsSync(file))
  ]
}

/**
 * What the rename would change, line by line, without writing anything.
 * Throws for a name or app id that could not be used safely.
 */
export function planRename({ root, name, appId }) {
  if (!NAME_PATTERN.test(name)) {
    throw new Error('The name must be 2–30 letters, digits or spaces, starting with a letter.')
  }
  if (!APP_ID_PATTERN.test(appId)) {
    throw new Error('The app id must be reverse-DNS in lower case, like app.vocette or com.example.vocette.')
  }
  const current = currentName(root)
  if (name === current) throw new Error(`The product is already called ${current}.`)
  // The whole word, but not inside a folder path — `%APPDATA%\Murmur`,
  // `Murmur\models`, `~/.config/Murmur` keep the name the folder has on disk.
  // Two exceptions are renamed: the executable, which packaging renames with
  // the product, and a `Name/1.2.3` product token such as the User-Agent.
  const word = new RegExp(
    `(?<![\\\\/])\\b${current}\\b(?!\\\\|/(?!\\d))|(?<=[\\\\/])${current}(?=\\.exe\\b)`,
    'gu'
  )
  const changes = []
  for (const path of candidates(root)) {
    const file = relative(root, path).split('\\').join('/')
    if (PROTECTED_FILES.has(file)) continue
    const lines = readFileSync(path, 'utf8').split('\n')
    lines.forEach((before, index) => {
      let after = before
      if (file === 'electron-builder.yml' && /^appId:/u.test(before)) after = `appId: ${appId}`
      else if (!PROTECTED_LINES.some((pattern) => pattern.test(before))) after = before.replace(word, name)
      if (after !== before) changes.push({ file, line: index + 1, before, after })
    })
  }
  return changes
}

/** Writes a plan to disk. */
export function applyRename(root, changes) {
  const byFile = new Map()
  for (const change of changes) byFile.set(change.file, [...(byFile.get(change.file) ?? []), change])
  for (const [file, fileChanges] of byFile) {
    const path = join(root, file)
    const lines = readFileSync(path, 'utf8').split('\n')
    for (const change of fileChanges) lines[change.line - 1] = change.after
    writeFileSync(path, lines.join('\n'))
  }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const [name, appId] = args.filter((arg) => !arg.startsWith('--'))
  if (!name || !appId) {
    console.error('Usage: node scripts/rename-product.mjs "<New Name>" <new.app.id> [--dry-run]')
    process.exit(1)
  }
  const root = resolve(import.meta.dirname, '..')
  if (!dryRun) {
    const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd: root,
      encoding: 'utf8'
    }).stdout.trim()
    if (status) {
      console.error('Commit or stash these first, so the rename is a commit of its own:\n' + status)
      process.exit(1)
    }
  }
  let changes
  try {
    changes = planRename({ root, name, appId })
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
  let lastFile = ''
  for (const change of changes) {
    if (change.file !== lastFile) console.log(`\n${change.file}`)
    lastFile = change.file
    console.log(`  ${change.line}: ${change.before.trim()}\n  ${' '.repeat(String(change.line).length)}→ ${change.after.trim()}`)
  }
  const files = new Set(changes.map((change) => change.file)).size
  if (dryRun) {
    console.log(`\nDry run: ${changes.length} lines in ${files} files would change. Nothing was written.`)
    return
  }
  applyRename(root, changes)
  console.log(`\n${changes.length} lines changed in ${files} files. Check them, run the tests, and commit.`)
  console.log('Still yours to do by hand: the screenshots, the icon, the website domain and the repository name.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
