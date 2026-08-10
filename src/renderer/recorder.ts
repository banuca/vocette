import type { RecorderStartRequest, RecorderStopRequest } from '../shared/types'

/** getUserMedia can hang indefinitely on a wedged audio driver. */
const MIC_OPEN_TIMEOUT_MS = 6000

let activeRequestId = ''
let recorder: MediaRecorder | null = null
let stream: MediaStream | null = null
let chunks: Blob[] = []
let startedAt = 0
/** Guarantees exactly one audio-or-error reply per request. */
let settled = false

function preferredMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
}

function stopTracks(): void {
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
}

function teardown(): void {
  try {
    if (recorder?.state === 'recording') recorder.stop()
  } catch {
    // Already stopped.
  }
  stopTracks()
  recorder = null
  chunks = []
  activeRequestId = ''
}

function fail(requestId: string, message: string): void {
  if (settled) return
  settled = true
  teardown()
  window.recorder.sendError({ requestId, message })
}

/**
 * Opens the microphone with a timeout. If the promise resolves after we have
 * given up, the stream is closed so the mic indicator does not stay lit.
 */
async function openMicrophone(microphoneId: string): Promise<MediaStream> {
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1
  }
  if (microphoneId) audio.deviceId = { exact: microphoneId }

  const request = navigator.mediaDevices.getUserMedia({ audio, video: false })
  let timer: number | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = window.setTimeout(() => {
      request
        .then((late) => late.getTracks().forEach((track) => track.stop()))
        .catch(() => undefined)
      reject(new DOMException('Microphone open timed out', 'TimeoutError'))
    }, MIC_OPEN_TIMEOUT_MS)
  })

  try {
    return await Promise.race([request, timeout])
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

async function start(request: RecorderStartRequest): Promise<void> {
  if (activeRequestId) {
    window.recorder.sendError({
      requestId: request.requestId,
      message: 'The microphone is already recording.'
    })
    return
  }

  activeRequestId = request.requestId
  settled = false
  chunks = []

  try {
    stream = await openMicrophone(request.microphoneId)
    const mimeType = preferredMimeType()
    recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 48_000
    })

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    })

    recorder.addEventListener('error', () => {
      fail(request.requestId, 'The microphone stopped unexpectedly.')
    })

    recorder.addEventListener(
      'stop',
      () => {
        if (settled) return
        settled = true
        const finishedRecorder = recorder
        const durationMs = Math.max(0, Date.now() - startedAt)
        const blob = new Blob(chunks, {
          type: finishedRecorder?.mimeType || mimeType || 'audio/webm'
        })
        stopTracks()
        recorder = null
        chunks = []
        activeRequestId = ''

        if (blob.size === 0) {
          window.recorder.sendError({
            requestId: request.requestId,
            message: 'No microphone audio was captured.'
          })
          return
        }

        void blob
          .arrayBuffer()
          .then((buffer) => {
            const audio = new Uint8Array(buffer)
            // ipcRenderer.send serialises synchronously, so zeroing our copy
            // straight after is safe.
            window.recorder.sendAudio({
              requestId: request.requestId,
              audio,
              mimeType: blob.type || 'audio/webm',
              durationMs
            })
            audio.fill(0)
          })
          .catch(() => {
            window.recorder.sendError({
              requestId: request.requestId,
              message: 'The captured microphone audio could not be read.'
            })
          })
      },
      { once: true }
    )

    recorder.start(150)
    startedAt = Date.now()
    window.recorder.sendStarted({ requestId: request.requestId })
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone access is blocked. Enable microphone access in Windows Privacy settings.'
        : error instanceof DOMException && error.name === 'NotFoundError'
          ? 'The selected microphone is unavailable. Choose another microphone in Settings.'
          : error instanceof DOMException && error.name === 'TimeoutError'
            ? 'The microphone did not respond. Check it is connected and try again.'
            : 'The microphone could not be started.'
    fail(request.requestId, message)
  }
}

window.recorder.onStart((request) => void start(request))

window.recorder.onStop((request: RecorderStopRequest) => {
  // Every stop must produce a reply. Silently ignoring a mismatched stop left
  // the main process waiting forever with the hotkey dead.
  if (request.requestId !== activeRequestId) {
    window.recorder.sendError({
      requestId: request.requestId,
      message: 'That recording was no longer active.'
    })
    return
  }
  if (!recorder || recorder.state === 'inactive') {
    fail(request.requestId, 'The recording had already stopped.')
    return
  }
  recorder.stop()
})
