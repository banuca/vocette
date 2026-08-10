const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 120_000
const TRANSCRIPTION_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions'

export interface TranscribeInput {
  audio: Uint8Array
  mimeType: string
  apiKey: string
  model: string
  language: string
}

function filenameForMimeType(mimeType: string): string {
  if (mimeType.includes('wav')) return 'dictation.wav'
  if (mimeType.includes('ogg')) return 'dictation.ogg'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'dictation.m4a'
  return 'dictation.webm'
}

function humanApiError(status: number, apiMessage: string): string {
  if (status === 401) return 'The API key was rejected. Open Settings and add a valid key.'
  if (status === 413) return 'That recording was too large to transcribe.'
  if (status === 429) return 'The API rate limit or account spending limit was reached.'
  if (status >= 500) return 'The transcription service is temporarily unavailable.'
  return apiMessage || `Transcription failed with HTTP ${status}.`
}

export class TranscriptionService {
  async transcribe(input: TranscribeInput): Promise<string> {
    if (!input.apiKey) throw new Error('Add an API key in Settings before recording.')
    if (input.audio.byteLength === 0) throw new Error('The microphone returned an empty recording.')
    if (input.audio.byteLength > MAX_AUDIO_BYTES) {
      throw new Error('The recording exceeded the 25 MB transcription limit.')
    }

    const audioCopy = input.audio.slice()
    const body = new FormData()
    body.append(
      'file',
      new Blob([audioCopy], { type: input.mimeType }),
      filenameForMimeType(input.mimeType)
    )
    body.append('model', input.model)
    body.append(
      'prompt',
      'English dictation. Use natural punctuation and capitalisation. Preserve the speaker’s wording.'
    )
    if (input.language !== 'auto') {
      // gpt-transcribe takes a list of candidate languages; the older models
      // take a single ISO-639-1 code.
      if (input.model === 'gpt-transcribe') {
        body.append('languages[]', input.language)
      } else {
        body.append('language', input.language)
      }
    }

    try {
      let response: Response
      try {
        response = await fetch(TRANSCRIPTION_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${input.apiKey}` },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          throw new Error(
            'Transcription timed out. Check your internet connection and try again.',
            { cause: error }
          )
        }
        throw new Error(
          'Could not reach the transcription service. Check your internet connection.',
          { cause: error }
        )
      }

      const payload = (await response.json().catch(() => ({}))) as {
        text?: unknown
        error?: { message?: unknown }
      }

      if (!response.ok) {
        const apiMessage = typeof payload.error?.message === 'string' ? payload.error.message : ''
        throw new Error(humanApiError(response.status, apiMessage))
      }
      if (typeof payload.text !== 'string' || !payload.text.trim()) {
        throw new Error('The transcription service returned no speech.')
      }
      return payload.text.trim()
    } finally {
      // Only safe once the response body has been read — the request body is
      // backed by this buffer.
      audioCopy.fill(0)
    }
  }
}
