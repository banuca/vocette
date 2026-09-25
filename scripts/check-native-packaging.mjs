#!/usr/bin/env node
/**
 * Checks that the native modules survived packaging, for the architecture
 * that was actually built.
 *
 * This exists because every failure mode is silent. koffi and uiohook-napi
 * load a `.node` file from disk at require time; if `asarUnpack` stops matching
 * them they end up inside the archive, and the app still starts — it just
 * quietly loses the global shortcut and every paste-target check, which is
 * exactly the class of defect that shipped once already. The speech engine is
 * the same: packed into the archive, it only fails when the first on-device
 * dictation tries to load it.
 *
 * Run after `electron-builder`. It inspects the unpacked application directory
 * rather than the installer, so it works the same on all three platforms.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { argv, exit, platform, arch } from 'node:process'

const DIST = argv[2] ?? 'dist'

/** koffi names its prebuild directories `<platform>_<arch>`. */
const KOFFI_DIRECTORY = `${platform === 'win32' ? 'win32' : platform}_${arch}`
/** uiohook-napi uses `<platform>-<arch>`. */
const UIOHOOK_DIRECTORY = `${platform}-${arch}`

/** Every unpacked app root electron-builder may have produced. */
function unpackedRoots() {
  if (!existsSync(DIST)) return []
  const roots = []
  for (const entry of readdirSync(DIST)) {
    const path = join(DIST, entry)
    if (!statSync(path).isDirectory()) continue

    // Windows and Linux: dist/win-unpacked, dist/linux-unpacked, and the
    // arch-suffixed variants.
    if (entry.endsWith('-unpacked')) roots.push(path)

    // macOS: dist/mac/Voice Hotkey.app/Contents/Resources
    if (entry === 'mac' || entry.startsWith('mac-')) {
      for (const bundle of readdirSync(path)) {
        if (bundle.endsWith('.app')) roots.push(join(path, bundle, 'Contents'))
      }
    }
  }
  return roots
}

function resourcesOf(root) {
  // Windows and Linux keep resources beside the executable; macOS nests them.
  return root.endsWith('Contents') ? join(root, 'Resources') : join(root, 'resources')
}

const REQUIRED = [
  {
    label: 'koffi',
    relative: join(
      'app.asar.unpacked',
      'node_modules',
      'koffi',
      'build',
      'koffi',
      KOFFI_DIRECTORY,
      'koffi.node'
    )
  },
  {
    label: 'uiohook-napi',
    relative: join(
      'app.asar.unpacked',
      'node_modules',
      'uiohook-napi',
      'prebuilds',
      UIOHOOK_DIRECTORY,
      'uiohook-napi.node'
    )
  },
  // The speech engine: the addon and the ONNX Runtime it loads beside it.
  // Windows x64 only for now — the only platform the engine has been run on.
  // The macOS and Linux packages (sherpa-onnx-darwin-*, sherpa-onnx-linux-*)
  // ship differently named libraries that have not been checked, so they are
  // not guessed at here.
  ...(platform === 'win32' && arch === 'x64'
    ? ['sherpa-onnx.node', 'onnxruntime.dll'].map((file) => ({
        label: `sherpa-onnx-win-x64 ${file}`,
        relative: join('app.asar.unpacked', 'node_modules', 'sherpa-onnx-win-x64', file)
      }))
    : [])
]

const roots = unpackedRoots()
if (!roots.length) {
  console.error(`No unpacked application found under ${DIST}. Run electron-builder first.`)
  exit(1)
}

let failures = 0
for (const root of roots) {
  const resources = resourcesOf(root)
  for (const { label, relative } of REQUIRED) {
    const path = join(resources, relative)
    if (existsSync(path)) {
      console.log(`ok    ${label} (${platform}-${arch}) in ${root}`)
    } else {
      failures += 1
      console.error(`FAIL  ${label} (${platform}-${arch}) missing: ${path}`)
    }
  }

  // A `.node` left inside the archive is the silent failure this guards
  // against, so say so explicitly rather than only reporting the absence.
  const asar = join(resources, 'app.asar')
  if (!existsSync(asar)) {
    failures += 1
    console.error(`FAIL  no app.asar in ${resources}`)
  }
}

console.log(failures === 0 ? 'Native packaging looks correct.' : `${failures} problem(s).`)
exit(failures === 0 ? 0 : 1)
