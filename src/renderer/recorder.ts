import type {
  RecorderCancelRequest,
  RecorderStartRequest,
  RecorderStopRequest
} from '../shared/types'
import { prepareForTranscription } from './audio-prep'

/** getUserMedia can hang indefinitely on a wedged audio driver. */
const MIC_OPEN_TIMEOUT_MS = 6000

type TakeState = 'opening' | 'recording' | 'preparing' | 'settled' | 'cancelled'

interface RecorderTake {
  readonly requestId: string
  state: TakeState
  stream: MediaStream | null
  recorder: MediaRecorder | null
  chunks: Blob[]
  startedAt: number
  openTimer: number | undefined
  cancelOpen: (() => void) | null
  cleaned: boolean
}

let activeTake: RecorderTake | null = null

function preferredMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}

/** Idempotently releases only resources owned by this take. */
function cleanupTake(take: RecorderTake): void {
  if (take.cleaned) return
  take.cleaned = true
  if (take.openTimer !== undefined) {
    window.clearTimeout(take.openTimer)
    take.openTimer = undefined
  }
  take.cancelOpen?.()
  take.cancelOpen = null
  try {
    if (take.recorder?.state === 'recording') take.recorder.stop()
  } catch {
    // Already stopped.
  }
  stopStream(take.stream)
  take.stream = null
  take.recorder = null
  take.chunks = []
  if (activeTake === take) activeTake = null
}

function failTake(take: RecorderTake, message: string): void {
  if (take.state === 'settled' || take.state === 'cancelled') return
  if (activeTake !== take) {
    cleanupTake(take)
    return
  }
  take.state = 'settled'
  cleanupTake(take)
  window.recorder.sendError({ requestId: take.requestId, message })
}

function cancelTake(take: RecorderTake): void {
  if (take.state === 'settled' || take.state === 'cancelled') return
  take.state = 'cancelled'
  cleanupTake(take)
}

/**
 * Opens this take's microphone with timeout and cancellation races. A device
 * promise cannot itself be aborted, so a stream arriving late closes itself.
 */
async function openMicrophone(take: RecorderTake, microphoneId: string): Promise<MediaStream> {
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1
  }
  if (microphoneId) audio.deviceId = { exact: microphoneId }

  const request = navigator.mediaDevices.getUserMedia({ audio, video: false })
  const guardedRequest = request.then((stream) => {
    if (take.state === 'cancelled' || activeTake !== take) stopStream(stream)
    return stream
  })
  const cancelled = new Promise<never>((_resolve, reject) => {
    take.cancelOpen = () => reject(new DOMException('Microphone open cancelled', 'AbortError'))
  })
  const timeout = new Promise<never>((_resolve, reject) => {
    take.openTimer = window.setTimeout(() => {
      take.openTimer = undefined
      reject(new DOMException('Microphone open timed out', 'TimeoutError'))
    }, MIC_OPEN_TIMEOUT_MS)
  })

  try {
    return await Promise.race([guardedRequest, cancelled, timeout])
  } finally {
    if (take.openTimer !== undefined) window.clearTimeout(take.openTimer)
    take.openTimer = undefined
    take.cancelOpen = null
  }
}

async function start(request: RecorderStartRequest): Promise<void> {
  if (activeTake) {
    window.recorder.sendError({
      requestId: request.requestId,
      message: 'The microphone is already recording.'
    })
    return
  }

  const take: RecorderTake = {
    requestId: request.requestId,
    state: 'opening',
    stream: null,
    recorder: null,
    chunks: [],
    startedAt: 0,
    openTimer: undefined,
    cancelOpen: null,
    cleaned: false
  }
  activeTake = take

  try {
    const stream = await openMicrophone(take, request.microphoneId)
    if (take.state === 'cancelled' || activeTake !== take) {
      stopStream(stream)
      cleanupTake(take)
      return
    }
    take.stream = stream

    const mimeType = preferredMimeType()
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 48_000
    })
    take.recorder = recorder

    recorder.addEventListener('dataavailable', (event) => {
      if (take.state === 'recording' && event.data.size > 0) take.chunks.push(event.data)
    })

    recorder.addEventListener('error', () => {
      failTake(take, 'The microphone stopped unexpectedly.')
    })

    recorder.addEventListener(
      'stop',
      () => {
        if (take.state !== 'recording' || activeTake !== take) return
        take.state = 'preparing'
        const durationMs = Math.max(0, Date.now() - take.startedAt)
        const blob = new Blob(take.chunks, {
          type: recorder.mimeType || mimeType || 'audio/webm'
        })
        stopStream(take.stream)
        take.stream = null
        take.recorder = null
        take.chunks = []

        if (blob.size === 0) {
          failTake(take, 'No microphone audio was captured.')
          return
        }

        void prepareForTranscription(blob, blob.type || 'audio/webm')
          .then((prepared) => {
            const audio = new Uint8Array(prepared.buffer)
            if (take.state === 'cancelled' || activeTake !== take) {
              audio.fill(0)
              cleanupTake(take)
              return
            }
            take.state = 'settled'
            try {
              window.recorder.sendAudio({
                requestId: take.requestId,
                audio,
                mimeType: prepared.mimeType,
                durationMs
              })
            } finally {
              audio.fill(0)
              cleanupTake(take)
            }
          })
          .catch(() => {
            if (take.state === 'cancelled' || activeTake !== take) {
              cleanupTake(take)
              return
            }
            failTake(take, 'The captured microphone audio could not be read.')
          })
      },
      { once: true }
    )

    take.state = 'recording'
    recorder.start(150)
    take.startedAt = Date.now()
    window.recorder.sendStarted({ requestId: take.requestId })
  } catch (error) {
    if (take.state === 'cancelled' || activeTake !== take) {
      cleanupTake(take)
      return
    }
    const message =
      error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone access is blocked. Enable microphone access in Windows Privacy settings.'
        : error instanceof DOMException && error.name === 'NotFoundError'
          ? 'The selected microphone is unavailable. Choose another microphone in Settings.'
          : error instanceof DOMException && error.name === 'TimeoutError'
            ? 'The microphone did not respond. Check it is connected and try again.'
            : 'The microphone could not be started.'
    failTake(take, message)
  }
}

window.recorder.onStart((request) => void start(request))

window.recorder.onStop((request: RecorderStopRequest) => {
  const take = activeTake
  if (!take || request.requestId !== take.requestId) {
    window.recorder.sendError({
      requestId: request.requestId,
      message: 'That recording was no longer active.'
    })
    return
  }
  // The first stop is already preparing the one eventual reply.
  if (take.state === 'preparing') return
  if (take.state !== 'recording' || !take.recorder || take.recorder.state === 'inactive') {
    failTake(take, 'The recording had already stopped.')
    return
  }
  take.recorder.stop()
})

window.recorder.onCancel((request: RecorderCancelRequest) => {
  const take = activeTake
  if (!take || request.requestId !== take.requestId) return
  cancelTake(take)
})
