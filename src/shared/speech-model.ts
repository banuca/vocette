/**
 * What the window may say about the on-device speech model.
 *
 * Only the facts a person reads — its name, the languages it recognises, its
 * licence and the attribution that licence asks for. How it is fetched (URLs,
 * sizes, hashes) stays in the main process's manifest, which takes these
 * values from here, so the Settings row, the About page and the manifest
 * cannot drift apart.
 */
export interface SpeechModelInfo {
  id: 'parakeet-tdt-0.6b-v3-int8'
  /** How the Settings row names it. */
  displayName: string
  /** The family name, for a sentence about what it can and cannot do. */
  shortName: string
  /** ISO-639-1 codes. Recognised automatically; the model does not report which one it heard. */
  languages: readonly string[]
  licence: string
  attribution: string
}

/** NVIDIA Parakeet TDT 0.6B v3, int8, as exported to ONNX by sherpa-onnx. */
export const PARAKEET_V3_INFO: SpeechModelInfo = {
  id: 'parakeet-tdt-0.6b-v3-int8',
  displayName: 'Parakeet v3',
  shortName: 'Parakeet',
  languages: [
    'bg', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'de', 'el', 'hu', 'it',
    'lv', 'lt', 'mt', 'pl', 'pt', 'ro', 'sk', 'sl', 'es', 'sv', 'ru', 'uk'
  ],
  licence: 'CC-BY-4.0',
  attribution:
    'Speech model: NVIDIA Parakeet TDT 0.6B v3, CC-BY-4.0; ONNX export by the ' +
    'sherpa-onnx project (k2-fsa).'
}

/** The model the on-device engine loads, as the window describes it. */
export const LOCAL_MODEL_INFO = PARAKEET_V3_INFO
