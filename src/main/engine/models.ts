/**
 * The on-device speech model Vocette can download.
 *
 * Every byte count and hash here was verified locally against the files the
 * URLs serve (docs/plan-model-q8.md). The URLs name a release tag that is
 * never reused, so a later upload can neither change nor break what an
 * installed copy of Vocette fetches: a file that no longer matches its hash is
 * refused, not loaded.
 */
import { PARAKEET_V3_INFO } from '../../shared/speech-model'

export interface ModelFile {
  name: string
  url: string
  bytes: number
  sha256: string
}

export interface ModelManifest {
  id: 'parakeet-tdt-0.6b-v3-q8'
  displayName: string
  languages: readonly string[]
  licence: string
  attribution: string
  files: readonly ModelFile[]
  totalBytes: number
}

/**
 * Vocette's own int8 build of the full-precision sherpa-onnx export
 * (`e2e/bench/to-int8.py`), published as assets of a pre-release so the
 * update check never mistakes it for a version of the app.
 */
const BASE_URL =
  'https://github.com/banuca/vocette/releases/download/model-parakeet-v3-q8-1/'

/**
 * Models earlier versions downloaded. Their folders are deleted once the
 * current model is installed, so an update doesn't leave 650 MB behind.
 */
export const RETIRED_MODEL_IDS: readonly string[] = ['parakeet-tdt-0.6b-v3-int8']

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
    bytes: 881_498_555,
    sha256: 'c5cdff28d4ac8690b3e3f7780ac5089586d87a2800cebf0ed5d5a128e94f2b86'
  },
  {
    name: PARAKEET_FILES.decoder,
    url: `${BASE_URL}${PARAKEET_FILES.decoder}`,
    bytes: 47_235_689,
    sha256: '167873a811f683e6ce94204887954297e77a2c6604a5121dcc234394a7fbfe3e'
  },
  {
    name: PARAKEET_FILES.joiner,
    url: `${BASE_URL}${PARAKEET_FILES.joiner}`,
    bytes: 6_402_684,
    sha256: '2de5c9796ae6d01e075161d6d25416fa9b19dcac130715401470545ddc51191b'
  },
  {
    name: PARAKEET_FILES.tokens,
    url: `${BASE_URL}${PARAKEET_FILES.tokens}`,
    bytes: 93_939,
    sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d'
  }
]

/**
 * NVIDIA Parakeet TDT 0.6B v3, int8. What the window says about it — name,
 * languages, licence, attribution — is shared with the renderer, so it is
 * written once, in `shared/speech-model`.
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
