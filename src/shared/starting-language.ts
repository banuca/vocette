import { LOCAL_MODEL_INFO } from './speech-model'
import { LANGUAGE_OPTIONS } from './types'

/**
 * The language a new profile starts in: the system's own, when the
 * on-device model hears it and Settings can show it; English otherwise
 * (owner, 15 Oct 2026). The model recognises its languages either way, so
 * this only tunes clean-up and tells a cloud engine what to expect.
 *
 * `systemLanguages` is the system's preferred list, most wanted first, as
 * tags such as "fr-CH" or "de".
 */
export function startingLanguage(systemLanguages: readonly string[]): string {
  const offered = new Set<string>(LANGUAGE_OPTIONS.map((option) => option.code))
  const heard = new Set(LOCAL_MODEL_INFO.languages)
  for (const tag of systemLanguages) {
    if (typeof tag !== 'string') continue
    const code = tag.trim().toLowerCase().split(/[-_]/u)[0] ?? ''
    if (offered.has(code) && heard.has(code)) return code
  }
  return 'en'
}
