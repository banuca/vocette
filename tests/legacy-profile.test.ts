import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  migrateLegacyProfile,
  type LegacyProfileFs
} from '../src/main/legacy-profile'

/**
 * The rename must not cost anyone their settings or their transcripts, and a
 * migration that goes wrong must cost them even less. These are the three
 * promises the module makes: never overwrite, never delete, never throw.
 */
const PARENT = join('C:', 'Users', 'someone', 'AppData', 'Roaming')
const CURRENT = join(PARENT, 'Murmur')

function makeFs(files: Record<string, number>) {
  const present = new Map(Object.entries(files))
  const copies: Array<{ from: string; to: string }> = []
  const created: string[] = []
  const fs: LegacyProfileFs = {
    exists: (path) => present.has(path),
    modifiedAt: (path) => present.get(path) ?? null,
    copyFile: (from, to) => {
      copies.push({ from, to })
      present.set(to, 1)
    },
    ensureDirectory: (path) => created.push(path)
  }
  return { fs, copies, created, present }
}

const options = (fs: LegacyProfileFs) => ({
  userData: CURRENT,
  parent: PARENT,
  currentName: 'Murmur',
  fs
})

describe('migrateLegacyProfile', () => {
  it('copies both files from the old folder when the new one is empty', () => {
    const { fs, copies } = makeFs({
      [join(PARENT, 'Voice Hotkey', 'settings.json')]: 1000,
      [join(PARENT, 'Voice Hotkey', 'history.json')]: 1000
    })

    const result = migrateLegacyProfile(options(fs))

    expect(result.from).toBe(join(PARENT, 'Voice Hotkey'))
    expect(result.migrated).toEqual(['settings.json', 'history.json'])
    expect(result.error).toBeNull()
    expect(copies).toHaveLength(2)
  })

  it('leaves an existing profile completely alone', () => {
    const { fs, copies } = makeFs({
      [join(CURRENT, 'settings.json')]: 2000,
      [join(PARENT, 'Voice Hotkey', 'settings.json')]: 1000,
      [join(PARENT, 'Voice Hotkey', 'history.json')]: 1000
    })

    const result = migrateLegacyProfile(options(fs))

    expect(result).toEqual({ from: null, migrated: [], error: null })
    expect(copies).toEqual([])
  })

  it('takes the most recently used profile when several old ones exist', () => {
    const { fs } = makeFs({
      [join(PARENT, 'Voice Hotkey', 'settings.json')]: 1000,
      [join(PARENT, 'voice-hotkey', 'settings.json')]: 5000
    })

    expect(migrateLegacyProfile(options(fs)).from).toBe(join(PARENT, 'voice-hotkey'))
  })

  it('migrates history alone, which is what a profile with no key looks like', () => {
    const { fs } = makeFs({
      [join(PARENT, 'Voice Hotkey', 'history.json')]: 1000
    })

    const result = migrateLegacyProfile(options(fs))
    expect(result.migrated).toEqual(['history.json'])
  })

  it('does nothing at all when there is no previous profile', () => {
    const { fs, created } = makeFs({})
    expect(migrateLegacyProfile(options(fs))).toEqual({
      from: null,
      migrated: [],
      error: null
    })
    expect(created).toEqual([])
  })

  it('never treats the current folder as its own source', () => {
    // The app has been called Murmur before, so its own name is in the list.
    const { fs, copies } = makeFs({
      [join(PARENT, 'Murmur', 'history.json')]: 1000
    })
    // `exists` on the current profile is what stops this, but the name check
    // matters for a system where the profile lives somewhere else entirely.
    migrateLegacyProfile({ ...options(fs), userData: join(PARENT, 'Elsewhere') })
    expect(copies).toEqual([])
  })

  it('reports a copy that failed instead of throwing on the way to a window', () => {
    const { fs } = makeFs({
      [join(PARENT, 'Voice Hotkey', 'settings.json')]: 1000,
      [join(PARENT, 'Voice Hotkey', 'history.json')]: 1000
    })
    const failing: LegacyProfileFs = {
      ...fs,
      copyFile: () => {
        throw new Error('Access is denied.')
      }
    }

    const result = migrateLegacyProfile(options(failing))

    expect(result.error).toBe('Access is denied.')
    expect(result.migrated).toEqual([])
    expect(result.from).toBe(join(PARENT, 'Voice Hotkey'))
  })
})
