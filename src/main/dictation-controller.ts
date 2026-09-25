import { randomUUID } from 'node:crypto'
import { cleanupTranscript } from '../shared/cleanup'
import type { RecordingMode } from '../shared/capabilities'
import type {
  Page,
  RecorderAudioPayload,
  RecorderErrorPayload,
  RecorderStartedPayload,
  TranscriptionEngine,
  WorkflowStatus
} from '../shared/types'

/** Hard stop for a single take. */
const MAX_RECORDING_MS = 5 * 60 * 1000
/** The microphone must report back within this long, or the take is abandoned. */
const START_WATCHDOG_MS = 8000
/** A stop request must produce audio or an error within this long. */
const STOP_WATCHDOG_MS = 10_000
/** How long a success/error status lingers before the overlay hides. */
const SUCCESS_RESET_MS = 1600
const ERROR_RESET_MS = 4500
/** Cancellation is an acknowledgement, not news; it clears quickly. */
const CANCELLED_RESET_MS = 1200
/** Small settle delay before the synthetic Ctrl+V, so clipboard writes propagate. */
const PASTE_DELAY_MS = 80

export type SoundKind = 'start' | 'success' | 'error'

/**
 * Where a dictation was started from.
 *
 * It decides delivery. A take started from the Murmur window has no
 * external target — this app has focus — so it is delivered to the clipboard
 * and nothing is typed anywhere. Only a take started by the global shortcut
 * has a target worth capturing and verifying.
 */
export type DictationSource = 'shortcut' | 'ui'

/** The settings fields the workflow needs, read fresh at decision time. */
export interface WorkflowSettings {
  /** Already resolved against platform capability by the caller. */
  recordingMode: RecordingMode
  autoPaste: boolean
  /** Whether this platform can verify a target and type into it at all. */
  pasteAvailable: boolean
  removeFillers: boolean
  spokenCorrections: boolean
  spokenFormatting: boolean
  playSounds: boolean
  /** Which engine transcribes this take. */
  engine: TranscriptionEngine
  /** The model that will transcribe, as History records it. */
  model: string
  language: string
  /** Parsed once by the caller; the controller only forwards it. */
  vocabulary: string[]
  microphoneId: string
  /** Whether the chosen engine has what it needs: its model, or a key. */
  transcriptionReady: boolean
  /** What to tell the user when it has not, already a sentence. */
  notReadyReason: string | null
}

/** Foreground-window verdict taken at paste time (null = tracking unavailable). */
export interface ForegroundState {
  /** The focused window is the one that had focus when the take started. */
  sameWindow: boolean
  /**
   * Injected keystrokes cannot reach the focused app. On Windows that means
   * the process runs elevated (UIPI); other platforms have their own barrier
   * and supply their own wording in `blockedReason`.
   */
  elevated: boolean
  /** Platform wording for `elevated`. Windows keeps the default phrasing. */
  blockedReason?: string
}

export interface TranscriptionPayload {
  /**
   * Taken from the same settings read as everything else in this take, so a
   * take is transcribed by the engine History will name.
   */
  engine: TranscriptionEngine
  audio: Uint8Array
  mimeType: string
  durationMs: number
  model: string
  language: string
  vocabulary: string[]
}

export interface DictationDeps {
  /** Sends a message to the hidden recorder window. */
  sendToRecorder(
    channel: 'recorder:start' | 'recorder:stop' | 'recorder:cancel',
    payload: unknown
  ): void
  getSettings(): WorkflowSettings
  transcribe(payload: TranscriptionPayload, signal: AbortSignal): Promise<string>
  writeClipboard(text: string): void
  /** Injects Ctrl+V into the focused app. */
  paste(): void
  playSound(kind: SoundKind): void
  /** Shows the overlay/main window status. Reset timing is owned here. */
  broadcastStatus(status: WorkflowStatus): void
  showMain(page: Page): void
  recordHistory(text: string, durationMs: number, model: string): void
  /** Remembers which window has focus, for the paste-target check. */
  captureForeground(): void
  /** Forgets any captured target, so nothing can be pasted into it. */
  clearForeground(): void
  getForegroundState(): ForegroundState | null
  /** Display label of the configured chord, for the overlay's release hint. */
  shortcutLabel(): string
  /** Fired when a failed take becomes retryable (or stops being retryable). */
  onRetryChanged?(available: boolean): void
}

interface RetryTake {
  audio: Uint8Array
  mimeType: string
  durationMs: number
  /** This take was started from the app window, so it is never pasted. */
  clipboardOnly: boolean
}

interface ProcessingAttempt {
  readonly controller: AbortController
  readonly take: RetryTake
  /** Normal takes own their audio; Retry borrows the retained retry take. */
  readonly releaseAudioOnCancel: boolean
}

function clearTimer(timer: NodeJS.Timeout | null): null {
  if (timer) clearTimeout(timer)
  return null
}

/**
 * The dictation phase machine: hold → starting → recording → processing →
 * success/error → idle, with watchdogs on every step where a peer (the
 * recorder window or the network) has to respond.
 *
 * Extracted from the app entry point so every transition is unit-testable,
 * because the two most damaging bugs in the previous build (a lost stop
 * request and a tray reset wedging the recorder) lived exactly here.
 */
export class DictationController {
  private currentStatus: WorkflowStatus = { phase: 'idle', message: 'Ready' }
  private currentRequestId = ''
  private releaseRequested = false
  private stopRequested = false

  private statusResetTimer: NodeJS.Timeout | null = null
  private maximumRecordingTimer: NodeJS.Timeout | null = null
  private startWatchdog: NodeJS.Timeout | null = null
  private stopWatchdog: NodeJS.Timeout | null = null

  /** The last take that failed during transcription, kept for "Retry last dictation". */
  private retryTake: RetryTake | null = null
  /** The only attempt currently allowed to produce user-visible side effects. */
  private activeAttempt: ProcessingAttempt | null = null
  /** Set when the current take was started from the app's own window. */
  private clipboardOnly = false

  constructor(private readonly deps: DictationDeps) {}

  getStatus(): WorkflowStatus {
    return this.currentStatus
  }

  canRetry(): boolean {
    return this.retryTake !== null
  }

  /** True while a take is being opened, recorded or transcribed. */
  isBusy(): boolean {
    const phase = this.currentStatus.phase
    return phase === 'starting' || phase === 'recording' || phase === 'processing'
  }

  /** True while audio is actually being captured, so a Stop button applies. */
  isRecording(): boolean {
    const phase = this.currentStatus.phase
    return phase === 'starting' || phase === 'recording'
  }

  /**
   * Starts a take. The only entry point that opens the microphone: the
   * shortcut, the window buttons and the tray all arrive here, so there is
   * never a second owner of the device or a second transcription pipeline.
   */
  startDictation(source: DictationSource): void {
    if (this.isBusy()) return

    // `success`, `error` and `cancelled` linger on screen for a few seconds.
    // Starting again during that window used to be ignored, forcing a wait of
    // up to 4.5s between dictations.
    this.statusResetTimer = clearTimer(this.statusResetTimer)

    const settings = this.deps.getSettings()
    if (!settings.transcriptionReady) {
      // The reason names what is missing — the speech model, or a key — so
      // the user is not sent looking for the wrong thing.
      this.fail(settings.notReadyReason ?? 'Transcription is not set up yet.', true)
      return
    }

    // A new take replaces any retryable one; its audio is zeroed and released.
    this.setRetryTake(null)
    // Started from this app's own window, there is no external target to
    // paste into, so none is captured and delivery stays on the clipboard.
    this.clipboardOnly = source === 'ui'
    if (this.clipboardOnly) this.deps.clearForeground()
    else this.deps.captureForeground()

    this.currentRequestId = randomUUID()
    this.releaseRequested = false
    this.stopRequested = false
    this.clearDictationTimers()

    this.broadcast({
      phase: 'starting',
      message: 'Starting microphone…',
      detail: this.startingHint(settings, source)
    })

    this.startWatchdog = setTimeout(() => {
      this.startWatchdog = null
      this.fail('The microphone did not start in time. Check it is connected and try again.')
    }, START_WATCHDOG_MS)

    this.deps.sendToRecorder('recorder:start', {
      requestId: this.currentRequestId,
      microphoneId: settings.microphoneId
    })
  }

  /** Ends the recording and sends it for transcription. */
  stopDictation(): void {
    if (this.currentStatus.phase === 'starting') {
      // The microphone has not answered yet; stop as soon as it does.
      this.releaseRequested = true
      return
    }
    if (this.currentStatus.phase === 'recording') this.requestStop()
  }

  /**
   * Abandons the take outright: no transcription, no history, no paste, and
   * the audio zeroed. Deliberately not an error — the user asked for this, so
   * it is acknowledged and cleared rather than reported as a failure.
   */
  cancelDictation(): void {
    if (!this.isBusy()) return
    this.cancelActiveAttempt()
    this.abandonRecorder()
    this.currentRequestId = ''
    this.releaseRequested = false
    this.stopRequested = false
    this.clipboardOnly = false
    this.clearDictationTimers()
    // A cancelled take is not offered for retry: the user did not want it.
    this.setRetryTake(null)
    this.broadcast({ phase: 'cancelled', message: 'Dictation cancelled' }, CANCELLED_RESET_MS)
  }

  /** One shortcut press, used where the platform cannot report a key release. */
  toggleDictation(source: DictationSource): void {
    if (this.isRecording()) {
      this.stopDictation()
      return
    }
    this.startDictation(source)
  }

  onShortcutPressed(): void {
    if (this.deps.getSettings().recordingMode === 'toggle') {
      this.toggleDictation('shortcut')
      return
    }
    this.startDictation('shortcut')
  }

  onShortcutReleased(): void {
    // In toggle mode the release is meaningless: the next press stops it.
    if (this.deps.getSettings().recordingMode === 'toggle') return
    this.stopDictation()
  }

  private startingHint(settings: WorkflowSettings, source: DictationSource): string {
    if (source === 'ui') return 'Press Stop when you have finished'
    return settings.recordingMode === 'toggle'
      ? `Press ${this.deps.shortcutLabel()} again to finish`
      : 'Keep holding the shortcut'
  }

  onRecorderStarted(payload: RecorderStartedPayload): void {
    if (payload.requestId !== this.currentRequestId || this.currentStatus.phase !== 'starting') {
      return
    }
    this.startWatchdog = clearTimer(this.startWatchdog)
    this.broadcast({
      phase: 'recording',
      message: 'Listening…',
      detail: `Release ${this.deps.shortcutLabel()} to finish`,
      startedAt: Date.now()
    })
    this.deps.playSound('start')
    this.maximumRecordingTimer = setTimeout(this.forceStop, MAX_RECORDING_MS)
    if (this.releaseRequested) this.requestStop()
  }

  async onRecorderAudio(payload: RecorderAudioPayload): Promise<void> {
    if (payload.requestId !== this.currentRequestId) return
    if (this.currentStatus.phase !== 'recording' && this.currentStatus.phase !== 'starting') {
      return
    }
    this.clearDictationTimers()

    // The payload arrives over IPC as a structured clone: this process is the
    // sole owner, so it is safe (and thriftier) to use it directly and zero
    // it in place once the take settles.
    const audio = payload.audio
    const take: RetryTake = {
      audio,
      mimeType: payload.mimeType,
      durationMs: Math.max(0, payload.durationMs),
      clipboardOnly: this.clipboardOnly
    }
    const attempt = this.beginProcessingAttempt(take, true)
    await this.processTake(attempt, 'Your audio is being converted to text', false)
  }

  onRecorderError(payload: RecorderErrorPayload): void {
    if (payload.requestId !== this.currentRequestId) return
    this.fail(payload.message)
  }

  /** Shows a dictation error from outside the workflow (e.g. a hook fault). */
  reportError(message: string): void {
    this.fail(message)
  }

  /**
   * Tray recovery for a missed key-up (e.g. the chord was released while an
   * elevated window had focus). Also used by tests to hard-reset the machine.
   */
  resetKeyState(): void {
    this.fail('Dictation cancelled.', false, true)
  }

  /** Re-runs transcription on the last failed take without touching the mic. */
  async retryLast(): Promise<void> {
    const take = this.retryTake
    // Allowed while the error message still lingers: retrying is exactly what
    // a user wants to do the moment they see it.
    if (!take || this.isBusy()) return

    // A fresh id invalidates any stale recorder events still in flight.
    this.currentRequestId = randomUUID()
    this.clipboardOnly = take.clipboardOnly
    // A retry of a window-started take still has no target to capture.
    if (take.clipboardOnly) this.deps.clearForeground()
    else this.deps.captureForeground()
    const attempt = this.beginProcessingAttempt(take, false)
    await this.processTake(attempt, 'Retrying your last recording', true)
  }

  private beginProcessingAttempt(
    take: RetryTake,
    releaseAudioOnCancel: boolean
  ): ProcessingAttempt {
    this.cancelActiveAttempt()
    const attempt: ProcessingAttempt = {
      controller: new AbortController(),
      take,
      releaseAudioOnCancel
    }
    this.activeAttempt = attempt
    return attempt
  }

  private ownsAttempt(attempt: ProcessingAttempt): boolean {
    return this.activeAttempt === attempt && !attempt.controller.signal.aborted
  }

  private cancelActiveAttempt(): void {
    const attempt = this.activeAttempt
    if (!attempt) return
    this.activeAttempt = null
    attempt.controller.abort()
    if (attempt.releaseAudioOnCancel) attempt.take.audio.fill(0)
  }

  private manualPasteMessage(foreground: ForegroundState | null): string | null {
    if (!foreground) return 'Copied — paste manually (focus could not be verified)'
    if (foreground.elevated) {
      return `Copied — paste manually (${foreground.blockedReason ?? 'focused app runs elevated'})`
    }
    if (!foreground.sameWindow) return 'Copied — paste manually (focus moved)'
    return null
  }

  private async pasteOrExplain(
    attempt: ProcessingAttempt,
    settings: WorkflowSettings
  ): Promise<string | null> {
    // Three separate reasons to deliver to the clipboard and stop there: the
    // user turned automatic paste off, this platform cannot paste safely at
    // all, or the take was started from this app's own window and so has no
    // target. None of them is a failure.
    if (!settings.autoPaste || !settings.pasteAvailable || attempt.take.clipboardOnly) {
      return 'Copied to clipboard'
    }
    if (!this.ownsAttempt(attempt)) return null

    let message = this.manualPasteMessage(this.deps.getForegroundState())
    if (!this.ownsAttempt(attempt)) return null
    if (message) return message

    await new Promise((resolve) => setTimeout(resolve, PASTE_DELAY_MS))
    if (!this.ownsAttempt(attempt)) return null

    message = this.manualPasteMessage(this.deps.getForegroundState())
    if (!this.ownsAttempt(attempt)) return null
    if (message) return message

    this.deps.paste()
    return 'Copied and pasted'
  }

  private async processTake(
    attempt: ProcessingAttempt,
    detail: string,
    isRetry: boolean
  ): Promise<void> {
    this.broadcast({ phase: 'processing', message: 'Transcribing…', detail })

    try {
      const settings = this.deps.getSettings()
      // Only the audio, its shape and the engine that should hear it leave
      // here; how this take is to be delivered afterwards is nobody else's
      // business.
      const rawText = await this.deps.transcribe(
        {
          engine: settings.engine,
          audio: attempt.take.audio,
          mimeType: attempt.take.mimeType,
          durationMs: attempt.take.durationMs,
          model: settings.model,
          language: settings.language,
          vocabulary: settings.vocabulary
        },
        attempt.controller.signal
      )
      if (!this.ownsAttempt(attempt)) return

      // Every language gets the rules that cannot change a word; the English
      // ones also run for Automatic when the text reads as English. The old
      // gate cleaned explicit English only, so Automatic got nothing while
      // the switch showed as on.
      const text = cleanupTranscript(rawText, {
        language: settings.language,
        removeFillers: settings.removeFillers,
        spokenCorrections: settings.spokenCorrections,
        spokenFormatting: settings.spokenFormatting
      })
      if (!text) throw new Error('Only filler words or silence were detected.')
      if (!this.ownsAttempt(attempt)) return

      this.deps.recordHistory(text, attempt.take.durationMs, settings.model)
      if (!this.ownsAttempt(attempt)) return

      this.deps.writeClipboard(text)
      if (!this.ownsAttempt(attempt)) return

      const message = await this.pasteOrExplain(attempt, settings)
      if (!message || !this.ownsAttempt(attempt)) return

      this.broadcast(
        {
          phase: 'success',
          message,
          detail: text.length > 68 ? `${text.slice(0, 68)}…` : text
        },
        SUCCESS_RESET_MS
      )
      if (!this.ownsAttempt(attempt)) return

      this.deps.playSound('success')
      if (!this.ownsAttempt(attempt)) return

      attempt.take.audio.fill(0)
      if (!this.ownsAttempt(attempt)) return
      this.setRetryTake(null)
    } catch (error) {
      if (!this.ownsAttempt(attempt)) return

      // Transfer a normal take to Retry only for a genuine processing error.
      // Explicit cancellation invalidates the attempt before this catch runs.
      this.activeAttempt = null
      if (!isRetry) this.setRetryTake(attempt.take)
      this.fail(error instanceof Error ? error.message : 'An unexpected error occurred.')
    } finally {
      // A stale attempt must not reset flags belonging to a newer recording.
      if (this.activeAttempt === attempt) {
        this.activeAttempt = null
        this.releaseRequested = false
        this.stopRequested = false
      }
    }
  }

  /** Stops timers and releases memory. Call before quitting. */
  shutdown(): void {
    this.cancelActiveAttempt()
    this.clearDictationTimers()
    this.statusResetTimer = clearTimer(this.statusResetTimer)
    this.setRetryTake(null)
  }

  private broadcast(status: WorkflowStatus, resetAfterMs = 0): void {
    this.currentStatus = status
    this.deps.broadcastStatus(status)

    this.statusResetTimer = clearTimer(this.statusResetTimer)
    if (resetAfterMs > 0) {
      this.statusResetTimer = setTimeout(() => {
        this.statusResetTimer = null
        this.goIdle()
      }, resetAfterMs)
    }
  }

  private clearDictationTimers(): void {
    this.maximumRecordingTimer = clearTimer(this.maximumRecordingTimer)
    this.startWatchdog = clearTimer(this.startWatchdog)
    this.stopWatchdog = clearTimer(this.stopWatchdog)
  }

  private setRetryTake(take: RetryTake | null): void {
    const hadRetry = this.retryTake !== null
    if (this.retryTake && this.retryTake !== take) this.retryTake.audio.fill(0)
    this.retryTake = take
    if (hadRetry !== (take !== null)) this.deps.onRetryChanged?.(take !== null)
  }

  /**
   * Tells the recorder to abandon a take it may still be working on. Without
   * this, a watchdog firing while the recorder window was still opening the
   * microphone left it recording forever — the mic stayed hot and every later
   * dictation failed with "The microphone is already recording."
   */
  private abandonRecorder(): void {
    const phase = this.currentStatus.phase
    if (
      this.currentRequestId &&
      (phase === 'starting' || phase === 'recording' || phase === 'processing')
    ) {
      this.deps.sendToRecorder('recorder:cancel', { requestId: this.currentRequestId })
    }
  }

  private goIdle(): void {
    this.abandonRecorder()
    this.currentRequestId = ''
    this.releaseRequested = false
    this.stopRequested = false
    this.clearDictationTimers()
    this.broadcast({ phase: 'idle', message: 'Ready' })
  }

  private fail(message: string, openSettings = false, silent = false): void {
    this.cancelActiveAttempt()
    this.abandonRecorder()
    this.currentRequestId = ''
    this.releaseRequested = false
    this.stopRequested = false
    this.clearDictationTimers()
    if (silent) {
      // Still show something: a silent phase change would strand the overlay.
      this.broadcast({ phase: 'idle', message: 'Ready' })
    } else {
      this.broadcast({ phase: 'error', message: 'Dictation failed', detail: message }, ERROR_RESET_MS)
    }
    if (openSettings) this.deps.showMain('settings')
  }

  private requestStop(): void {
    if (!this.currentRequestId || this.currentStatus.phase !== 'recording' || this.stopRequested) {
      return
    }
    this.stopRequested = true
    this.deps.sendToRecorder('recorder:stop', { requestId: this.currentRequestId })
    this.armStopWatchdog()
  }

  /**
   * Used by the maximum-duration timer. Unlike `requestStop` this ignores
   * `stopRequested`: if the first stop request was lost, retrying is the only
   * way to finish the take. The previous build shared one guarded function
   * between both paths, so a lost stop wedged the app in `recording` forever.
   */
  private readonly forceStop = (): void => {
    if (!this.currentRequestId) return
    this.stopRequested = true
    this.deps.sendToRecorder('recorder:stop', { requestId: this.currentRequestId })
    this.armStopWatchdog()
  }

  private armStopWatchdog(): void {
    this.stopWatchdog = clearTimer(this.stopWatchdog)
    this.stopWatchdog = setTimeout(() => {
      this.stopWatchdog = null
      this.fail('The recording could not be finalised. Try again.')
    }, STOP_WATCHDOG_MS)
  }
}
