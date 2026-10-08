import './overlay.css'
import { formatWait, isMeasuredWait } from '../shared/format'
import type { Theme, WorkflowStatus } from '../shared/types'
import { levelToBars, restingBars } from './level-meter'

const overlay = document.querySelector<HTMLDivElement>('#overlay')
const message = document.querySelector<HTMLDivElement>('#message')
const detail = document.querySelector<HTMLDivElement>('#detail')
const timerElement = document.querySelector<HTMLDivElement>('#timer')
const levelBars = [...document.querySelectorAll<HTMLElement>('#level .level-bar')]
const levelDot = document.querySelector<HTMLElement>('#level-dot')

/** A bar at rest is a dot this fraction of its height; the stylesheet starts it there too. */
const BAR_REST_SCALE = 0.2
/** The reduced-motion dot with nothing heard; it brightens to full with the voice. */
const DOT_REST_OPACITY = 0.3

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

let timer: number | undefined
/** The meter's smoothed bar heights, 0–1 each; back to rest whenever a take starts or ends. */
let bars = restingBars()
let recording = false

function stopTimer(): void {
  if (timer !== undefined) {
    window.clearInterval(timer)
    timer = undefined
  }
}

function paintLevel(): void {
  levelBars.forEach((bar, index) => {
    const scale = BAR_REST_SCALE + (1 - BAR_REST_SCALE) * (bars[index] ?? 0)
    bar.style.transform = `scaleY(${scale.toFixed(3)})`
  })
  if (levelDot) {
    const loudest = Math.max(0, ...bars)
    levelDot.style.opacity = (DOT_REST_OPACITY + (1 - DOT_REST_OPACITY) * loudest).toFixed(3)
  }
}

function render(status: WorkflowStatus): void {
  if (!overlay || !message || !detail || !timerElement) return

  overlay.className = `overlay ${status.phase}`
  message.textContent = status.message
  detail.textContent = status.detail ?? ''

  // Every take's meter starts from rest: the last reading of the one before
  // says nothing about this one.
  const nowRecording = status.phase === 'recording'
  if (nowRecording !== recording) {
    bars = restingBars()
    paintLevel()
    watchForStaleLevel(nowRecording)
  }
  recording = nowRecording

  stopTimer()
  if (status.phase === 'recording' && status.startedAt) {
    const startedAt = status.startedAt
    const tick = (): void => {
      timerElement.textContent = formatElapsed(Date.now() - startedAt)
    }
    tick()
    // 200ms is plenty for a seconds display and costs far less than rAF.
    timer = window.setInterval(tick, 200)
  } else if (status.phase === 'processing' && status.startedAt) {
    // Polishing has its own clock, so a slow provider shows as time spent
    // polishing rather than as a stalled transcription.
    const startedAt = status.startedAt
    const tick = (): void => {
      timerElement.textContent = formatWait(Date.now() - startedAt)
    }
    tick()
    timer = window.setInterval(tick, 100)
  } else if (status.phase === 'success' && isMeasuredWait(status.waitMs)) {
    // Where the recording's time was: how long the text took after letting go.
    timerElement.textContent = formatWait(status.waitMs)
  } else {
    timerElement.textContent = ''
  }
}

window.murmur.onWorkflowStatus(render)

/**
 * Readings arrive about every 70 ms. If they stop — the recorder's audio
 * context stalled, or could not start — the bars must not freeze at the last
 * shape, which would tell the user they are being heard when nothing is
 * arriving. After a short silence the meter sinks back to rest instead.
 */
const LEVEL_STALE_MS = 300
let lastReadingAt = 0
/** Runs only while recording; see `render`. */
let staleTimer: number | undefined

function watchForStaleLevel(on: boolean): void {
  if (staleTimer !== undefined) window.clearInterval(staleTimer)
  staleTimer = undefined
  if (!on) return
  lastReadingAt = Date.now()
  staleTimer = window.setInterval(() => {
    if (Date.now() - lastReadingAt < LEVEL_STALE_MS) return
    if (bars.every((bar) => bar === 0)) return
    bars = levelToBars(0, bars)
    paintLevel()
  }, 70)
}

// Main sends readings only while a take is recording. One that lands after
// the phase has moved on is dropped rather than drawn under the wrong state.
window.murmur.onLevel((level) => {
  if (!recording) return
  lastReadingAt = Date.now()
  bars = levelToBars(level, bars)
  paintLevel()
})

/*
 * Only the attribute is set here, deliberately — not `color-scheme` as the
 * window does. This window is transparent, and a colour scheme would have the
 * browser paint its own opaque canvas behind the card.
 */
let themeSetting: Theme = 'system'
const systemDark =
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
const paintTheme = (): void => {
  document.documentElement.dataset.theme =
    themeSetting === 'system' ? (systemDark?.matches === false ? 'light' : 'dark') : themeSetting
}
window.murmur.onTheme((theme) => {
  themeSetting = theme
  paintTheme()
})
// Following Windows means following it while the pill is up, too.
systemDark?.addEventListener('change', paintTheme)
