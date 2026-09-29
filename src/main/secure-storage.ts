/**
 * Whether the operating system offers storage fit to hold an API key.
 *
 * Electron's `safeStorage` always encrypts *something*, but on Linux it falls
 * back to `basic_text` when no keyring is available — a hard-coded key, which
 * is obfuscation, not encryption. Writing a credential there while calling it
 * encrypted would be a lie, so that case is treated as unavailable and the app
 * offers an explicitly labelled session-only key instead.
 */
export interface SecureStorageProbe {
  isEncryptionAvailable(): boolean
  /** Linux only in Electron; absent elsewhere. */
  getSelectedStorageBackend?(): string
}

export interface SecureStorageAssessment {
  /** Safe to persist a credential. */
  usable: boolean
  /** Why not, in one sentence. Empty when usable. */
  reason: string
  /** The backend name, for diagnostics. Never contains key material. */
  backend: string
}

const NO_ENCRYPTION =
  'This system has no working secure storage, so Vocette will not write ' +
  'your API key to disk. You can use a key for this session only.'

const PLAINTEXT_BACKEND =
  'Your desktop has no unlocked keyring, so Vocette would only be able to ' +
  'obfuscate your API key rather than encrypt it. It will not write the key to ' +
  'disk. You can use a key for this session only, or unlock a keyring ' +
  '(GNOME Keyring, KWallet) and try again.'

/** Backends that are not real encryption. */
const UNSAFE_BACKENDS = new Set(['basic_text', 'unknown'])

export function assessSecureStorage(probe: SecureStorageProbe): SecureStorageAssessment {
  let encryption: boolean
  try {
    encryption = probe.isEncryptionAvailable()
  } catch {
    encryption = false
  }
  if (!encryption) return { usable: false, reason: NO_ENCRYPTION, backend: 'none' }

  let backend: string
  try {
    backend = probe.getSelectedStorageBackend?.() ?? 'os'
  } catch {
    backend = 'unknown'
  }
  if (UNSAFE_BACKENDS.has(backend)) {
    return { usable: false, reason: PLAINTEXT_BACKEND, backend }
  }
  return { usable: true, reason: '', backend }
}
