#!/usr/bin/env node
/**
 * Builds the Windows release, outside this folder, and proves the native
 * parts survived packaging. One command: `npm run release:win`.
 *
 *   1. Refuses to build from uncommitted changes to tracked files (untracked
 *      files are not part of the build), unless `--allow-dirty`.
 *   2. Type-checks, tests, lints and bundles, stopping at the first failure.
 *   3. Packages with electron-builder for Windows x64 into `--out`, by default
 *      %LOCALAPPDATA%\vocette-release\<version>. Inside a synced folder (the
 *      Desktop) electron-builder fails with EBUSY and EPERM, and on this machine
 *      it also fails renaming its fresh extraction under %USERPROFILE%; under
 *      %LOCALAPPDATA% it does not.
 *   4. Runs the native packaging check against that output.
 *   5. Writes SHA256SUMS.txt beside the artifacts and lists them with sizes.
 *
 * Signing is opt-in and left to electron-builder: with WIN_CSC_LINK (or
 * CSC_LINK) and CSC_KEY_PASSWORD set to a PFX certificate the installer and the
 * executable are signed, and this script says whether they were. Azure Trusted
 * Signing (`win.azureSignOptions` in electron-builder.yml) is the better route
 * for a new publisher; see docs/release.md. Nothing here publishes anything.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { argv, exit, platform } from 'node:process'

const args = argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}

const ROOT = resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const LOCAL = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
/** The product's name as the app shows it, from src/shared/product.ts. */
const PRODUCT = /export const PRODUCT_NAME = '([^']+)'/u.exec(
  readFileSync(join(ROOT, 'src', 'shared', 'product.ts'), 'utf8')
)?.[1] ?? 'app'
const OUT = resolve(option('out') ?? join(LOCAL, `${PRODUCT.toLowerCase()}-release`, version))

function run(label, command, commandArgs, env = {}) {
  console.log(`\n▶ ${label}`)
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: platform === 'win32',
    env: { ...process.env, ...env }
  })
  if (result.status !== 0) {
    console.error(`\n✖ ${label} failed (exit ${result.status ?? 'none'}). Nothing was released.`)
    exit(result.status ?? 1)
  }
}

if (platform !== 'win32') {
  console.error('Build the Windows release on Windows x64: the native prebuilds are per platform.')
  exit(1)
}

// 1. Only committed code is released.
const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
  cwd: ROOT,
  encoding: 'utf8'
})
const changes = status.stdout.trim()
if (changes && !flag('allow-dirty')) {
  console.error('These tracked files have uncommitted changes:\n' + changes)
  console.error('\nCommit them, or pass --allow-dirty to build anyway (not for a release).')
  exit(1)
}
const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
  .stdout.trim()

// Electron must start as Electron in the steps below, not as plain Node.
const { ELECTRON_RUN_AS_NODE: _dropped, ...cleanEnv } = process.env
process.env = cleanEnv

// 2. The same gates as every change.
run('Type-check', 'npm', ['run', 'typecheck'])
run('Tests', 'npx', ['vitest', 'run'])
run('Lint', 'npm', ['run', 'lint'])
run('Bundle', 'npx', ['electron-vite', 'build'])

// 3. Package, outside any synced folder.
const signed = Boolean((process.env.WIN_CSC_LINK || process.env.CSC_LINK) && process.env.CSC_KEY_PASSWORD)
run('Package (electron-builder, Windows x64)', 'npx', [
  'electron-builder',
  '--win',
  '--x64',
  `--config.directories.output=${OUT}`
], signed ? {} : { CSC_IDENTITY_AUTO_DISCOVERY: 'false' })

// 4. The native modules and the speech engine are outside the archive.
run('Native packaging check', 'node', [join('scripts', 'check-native-packaging.mjs'), OUT])

// 5. Checksums for everything a user downloads.
function sha256(path) {
  return new Promise((done, fail) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', fail)
      .on('end', () => done(hash.digest('hex')))
  })
}

const artifacts = readdirSync(OUT)
  .filter((name) => /\.(exe|zip|blockmap)$/iu.test(name))
  .map((name) => ({ name, path: join(OUT, name), bytes: statSync(join(OUT, name)).size }))
if (!artifacts.length) {
  console.error(`\n✖ No installer or archive found in ${OUT}.`)
  exit(1)
}
const lines = []
for (const artifact of artifacts) lines.push(`${await sha256(artifact.path)}  ${artifact.name}`)
writeFileSync(join(OUT, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`)

console.log(`\n✔ Murmur ${version} (commit ${commit}${changes ? ', with uncommitted changes' : ''})`)
console.log(`  ${signed ? 'Signed with the certificate in WIN_CSC_LINK / CSC_LINK.' : 'Not signed: no certificate was configured. Windows SmartScreen will warn on download.'}`)
console.log(`  Output: ${OUT}`)
for (const artifact of artifacts) {
  console.log(`  ${artifact.name}  ${(artifact.bytes / 1_000_000).toFixed(1)} MB`)
}
console.log(`  SHA256SUMS.txt written. Unpacked app: ${existsSync(join(OUT, 'win-unpacked')) ? join(OUT, 'win-unpacked') : '(none)'}`)
