/**
 * The on-device speech model Vocette can download.
 *
 * Every byte count and hash here was verified locally against the files the
 * URLs serve (docs/research/engine-spike.md). The URLs name a commit, never
 * `main`, so a later upload to the repository can neither change nor break
 * what an installed copy of Vocette fetches: a file that no longer matches its
 * hash is refused, not loaded.
 */
import { PARAKEET_V3_INFO } from '../../shared/speech-model'

export interface ModelFile {
  name: string
  url: string
  bytes: number
  sha256: string
}

export interface ModelManifest {
  id: 'parakeet-tdt-0.6b-v3-int8'
  displayName: string
  languages: readonly string[]
  licence: string
  attribution: string
  files: readonly ModelFile[]
  totalBytes: number
}

const BASE_URL =
  'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/' +
  '2bda32ec70b097a55adaa07d9a7173915b43cc78/'

/** The file roles the recogniser is configured with, by name. */
export const PARAKEET_FILES = {
  encoder: 'encoder.int8.onnx',
  decoder: 'decoder.int8.onnx',
  joiner: 'joiner.int8.onnx',
  tokens: 'tokens.txt'
} as const

const files: readonly ModelFile[] = [
  {
    name: PARAKEET_FILES.encoder,
    url: `${BASE_URL}${PARAKEET_FILES.encoder}`,
    bytes: 652_184_281,
    sha256: 'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247'
  },
  {
    name: PARAKEET_FILES.decoder,
    url: `${BASE_URL}${PARAKEET_FILES.decoder}`,
    bytes: 11_845_275,
    sha256: '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e'
  },
  {
    name: PARAKEET_FILES.joiner,
    url: `${BASE_URL}${PARAKEET_FILES.joiner}`,
    bytes: 6_355_277,
    sha256: '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3'
  },
  {
    name: PARAKEET_FILES.tokens,
    url: `${BASE_URL}${PARAKEET_FILES.tokens}`,
    bytes: 93_939,
    sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d'
  }
]

/**
 * NVIDIA Parakeet TDT 0.6B v3, int8, as exported to ONNX by sherpa-onnx. What
 * the window says about it — name, languages, licence, attribution — is
 * shared with the renderer, so it is written once, in `shared/speech-model`.
 */
export const PARAKEET_V3: ModelManifest = {
  id: PARAKEET_V3_INFO.id,
  displayName: PARAKEET_V3_INFO.displayName,
  // Recognised automatically; the model does not report which one it heard.
  languages: PARAKEET_V3_INFO.languages,
  licence: PARAKEET_V3_INFO.licence,
  attribution: PARAKEET_V3_INFO.attribution,
  files,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0)
}

/** The model the on-device engine loads. One for now; the store takes any id. */
export const LOCAL_MODEL = PARAKEET_V3

const MANIFESTS: readonly ModelManifest[] = [PARAKEET_V3]

export function modelManifest(id: string): ModelManifest | null {
  return MANIFESTS.find((manifest) => manifest.id === id) ?? null
}
