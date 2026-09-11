import { describe, expect, it, vi } from 'vitest'
import {
  HISTORY_SAVE_WARNING,
  createHistorySaveWarning,
  trackHistorySaveStatus
} from '../src/renderer/history-save-warning'
import type { HistorySaveStatus } from '../src/shared/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

/** Records what the banner was told, standing in for a real rendered view. */
function recordingView(): { applied: HistorySaveStatus[]; apply: (s: HistorySaveStatus) => void } {
  const applied: HistorySaveStatus[] = []
  return { applied, apply: (status) => applied.push(status) }
}

class FakeHost {
  innerHTML = ''
  private renders = 0

  set(value: string): void {
    this.renders += 1
    this.innerHTML = value
  }

  get renderCount(): number {
    return this.renders
  }
}

/** Mirrors the shell's host element closely enough for the banner's one write. */
function makeHost(): { host: HTMLElement; state: FakeHost } {
  const state = new FakeHost()
  const host = {
    get innerHTML(): string {
      return state.innerHTML
    },
    set innerHTML(value: string) {
      state.set(value)
    }
  } as HTMLElement
  return { host, state }
}

describe('createHistorySaveWarning', () => {
  it('renders nothing while history is saving normally', () => {
    const { host } = makeHost()
    createHistorySaveWarning(host).apply({ saveFailed: false })
    expect(host.innerHTML).toBe('')
  })

  it('shows the warning, its wording and an alert role when a save fails', () => {
    const { host } = makeHost()
    createHistorySaveWarning(host).apply({ saveFailed: true })

    expect(host.innerHTML).toContain(HISTORY_SAVE_WARNING)
    expect(HISTORY_SAVE_WARNING).toBe(
      'History could not be saved. Recent entries may be lost when you quit. ' +
        'Copy any text you need and check disk space or folder permissions.'
    )
    expect(host.innerHTML).toContain('role="alert"')
    // Non-modal and undismissable: nothing to click, nothing to close.
    expect(host.innerHTML).not.toContain('<button')
  })

  it('removes the warning once saving recovers', () => {
    const { host } = makeHost()
    const view = createHistorySaveWarning(host)

    view.apply({ saveFailed: true })
    expect(host.innerHTML).toContain(HISTORY_SAVE_WARNING)
    view.apply({ saveFailed: false })
    expect(host.innerHTML).toBe('')
  })

  it('does not re-render an unchanged status', () => {
    const { host, state } = makeHost()
    const view = createHistorySaveWarning(host)

    view.apply({ saveFailed: false })
    view.apply({ saveFailed: false })
    expect(state.renderCount).toBe(1)

    view.apply({ saveFailed: true })
    view.apply({ saveFailed: true })
    // A repeated write would restart the screen reader's announcement.
    expect(state.renderCount).toBe(2)
  })
})

describe('trackHistorySaveStatus', () => {
  it('shows a failure that already existed when the window opened', async () => {
    const read = deferred<HistorySaveStatus>()
    const tracker = trackHistorySaveStatus({
      getHistorySaveStatus: () => read.promise,
      onHistorySaveStatus: () => () => undefined
    })
    const view = recordingView()

    read.resolve({ saveFailed: true })
    await read.promise
    tracker.attach(view)

    expect(tracker.status).toEqual({ saveFailed: true })
    expect(view.applied).toEqual([{ saveFailed: true }])
  })

  it('subscribes before it reads, so an update during load is not missed', async () => {
    const read = deferred<HistorySaveStatus>()
    let push!: (status: HistorySaveStatus) => void
    const onHistorySaveStatus = vi.fn((callback: (status: HistorySaveStatus) => void) => {
      push = callback
      return () => undefined
    })
    const getHistorySaveStatus = vi.fn(() => read.promise)
    const tracker = trackHistorySaveStatus({ getHistorySaveStatus, onHistorySaveStatus })

    expect(onHistorySaveStatus.mock.invocationCallOrder[0]).toBeLessThan(
      getHistorySaveStatus.mock.invocationCallOrder[0] ?? 0
    )

    // The failure happens while the read is still outstanding, and the read
    // then answers with the state from before it.
    push({ saveFailed: true })
    read.resolve({ saveFailed: false })
    await read.promise
    await new Promise<void>((resolve) => setImmediate(resolve))

    const view = recordingView()
    tracker.attach(view)
    expect(tracker.status).toEqual({ saveFailed: true })
    expect(view.applied).toEqual([{ saveFailed: true }])
  })

  it('keeps applying updates to an attached banner', async () => {
    const read = deferred<HistorySaveStatus>()
    let push!: (status: HistorySaveStatus) => void
    const tracker = trackHistorySaveStatus({
      getHistorySaveStatus: () => read.promise,
      onHistorySaveStatus: (callback) => {
        push = callback
        return () => undefined
      }
    })
    read.resolve({ saveFailed: false })
    await read.promise

    const view = recordingView()
    tracker.attach(view)
    push({ saveFailed: true })
    push({ saveFailed: false })

    expect(view.applied).toEqual([
      { saveFailed: false },
      { saveFailed: true },
      { saveFailed: false }
    ])
  })

  it('opens the window normally when the status cannot be read', async () => {
    const read = deferred<HistorySaveStatus>()
    const tracker = trackHistorySaveStatus({
      getHistorySaveStatus: () => read.promise,
      onHistorySaveStatus: () => () => undefined
    })
    let unhandled: unknown
    const captureUnhandled = (reason: unknown): void => {
      unhandled = reason
    }
    process.on('unhandledRejection', captureUnhandled)

    try {
      read.reject(new Error('Forbidden.'))
      await new Promise<void>((resolve) => setImmediate(resolve))
    } finally {
      process.off('unhandledRejection', captureUnhandled)
    }

    const view = recordingView()
    tracker.attach(view)
    expect(tracker.status).toEqual({ saveFailed: false })
    expect(view.applied).toEqual([{ saveFailed: false }])
    expect(unhandled).toBeUndefined()
  })
})
