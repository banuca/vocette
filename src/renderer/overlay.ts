import './overlay.css'
import type { WorkflowStatus } from '../shared/types'

const overlay = document.querySelector<HTMLDivElement>('#overlay')
const message = document.querySelector<HTMLDivElement>('#message')
const detail = document.querySelector<HTMLDivElement>('#detail')
const timerElement = document.querySelector<HTMLDivElement>('#timer')

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

let timer: number | undefined

function stopTimer(): void {
  if (timer !== undefined) {
    window.clearInterval(timer)
    timer = undefined
  }
}

function render(status: WorkflowStatus): void {
  if (!overlay || !message || !detail || !timerElement) return

  overlay.className = `overlay ${status.phase}`
  message.textContent = status.message
  detail.textContent = status.detail ?? ''

  stopTimer()
  if (status.phase === 'recording' && status.startedAt) {
    const startedAt = status.startedAt
    const tick = (): void => {
      timerElement.textContent = formatElapsed(Date.now() - startedAt)
    }
    tick()
    // 200ms is plenty for a seconds display and costs far less than rAF.
    timer = window.setInterval(tick, 200)
  } else {
    timerElement.textContent = ''
  }
}

window.murmur.onWorkflowStatus(render)

/*
 * Only the attribute is set here, deliberately — not `color-scheme` as the
 * window does. This window is transparent, and a colour scheme would have the
 * browser paint its own opaque canvas behind the card.
 */
window.murmur.onTheme((theme) => {
  document.documentElement.dataset.theme = theme
})
