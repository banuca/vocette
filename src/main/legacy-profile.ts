import { join } from 'node:path'

/**
 * Carries a profile across the rename from Voice Hotkey to Vocette.
 *
 * The storage folder is named after the application, so renaming it would
 * otherwise orphan the user's settings and transcripts in a directory nothing
 * reads any more. This runs once, before either store opens.
 *
 * Three rules, all of them about not making things worse:
 *
 * 1. **Never overwrite.** If the new profile already holds either file, there
 *    is nothing to migrate and the old folder is left alone.
 * 2. **Never delete.** The originals stay where they are, so a migration that
 *    goes wrong costs nothing and can simply be repeated.
 * 3. **Never block startup.** Every failure is returned, not thrown. A profile
 *    that could not be copied is a worse first run, not a broken application.
 *
 * A saved API key survives this on Windows, where `safeStorage` encrypts with
 * DPAPI against the user account rather than the path. It does not survive on
 * macOS or Linux, where the secret lives in a keychain entry named after the
 * application: there the key has to be entered again. That is a property of
 * the platform, not something this module can paper over.
 */

/** Folder names the app has used, newest naming first. */
export const LEGACY_PROFILE_NAMES: readonly string[] = ['Murmur', 'Voice Hotkey', 'voice-hotkey']

/** Only these are carried across. Caches and crash dumps are not worth it. */
export const MIGRATED_FILES: readonly string[] = ['settings.json', 'history.json']

export interface LegacyProfileFs {
  exists(path: string): boolean
  /** Last modification time in milliseconds, or null when unknown. */
  modifiedAt(path: string): number | null
  copyFile(from: string, to: string): void
  ensureDirectory(path: string): void
}

export interface LegacyProfileOptions {
  /** Where the app stores its profile now. */
  userData: string
  /** The directory those profile folders sit in. */
  parent: string
  /** The current folder name, so it is never treated as its own source. */
  currentName: string
  fs: LegacyProfileFs
}

export interface LegacyProfileResult {
  /** The folder the files came from, or null when nothing was migrated. */
  from: string | null
  /** File names actually copied. */
  migrated: string[]
  /** Why a migration that should have happened did not. */
  error: string | null
}

/**
 * Copies a previous version's profile into this one, if and only if this one
 * is empty. Returns what happened rather than reporting it: the caller decides
 * whether that is worth telling the user about.
 */
export function migrateLegacyProfile(options: LegacyProfileOptions): LegacyProfileResult {
  const { fs, parent, userData, currentName } = options
  const nothing: LegacyProfileResult = { from: null, migrated: [], error: null }

  // Rule 1: an existing profile is never touched, whatever is lying around
  // under an old name.
  const alreadyInUse = MIGRATED_FILES.some((file) => fs.exists(join(userData, file)))
  if (alreadyInUse) return nothing

  let source: string | null = null
  let newest = -1
  for (const name of LEGACY_PROFILE_NAMES) {
    if (name === currentName) continue
    const candidate = join(parent, name)
    if (candidate === userData) continue
    const present = MIGRATED_FILES.filter((file) => fs.exists(join(candidate, file)))
    if (present.length === 0) continue
    // Someone may have run both the packaged app and a development build; the
    // most recently written profile is the one they were actually using.
    const stamp = Math.max(
      ...present.map((file) => fs.modifiedAt(join(candidate, file)) ?? 0)
    )
    if (stamp > newest) {
      newest = stamp
      source = candidate
    }
  }

  if (!source) return nothing

  const migrated: string[] = []
  try {
    fs.ensureDirectory(userData)
    for (const file of MIGRATED_FILES) {
      const from = join(source, file)
      if (!fs.exists(from)) continue
      fs.copyFile(from, join(userData, file))
      migrated.push(file)
    }
  } catch (error) {
    return {
      from: source,
      migrated,
      error: error instanceof Error ? error.message : 'The previous profile could not be copied.'
    }
  }

  return { from: source, migrated, error: null }
}
