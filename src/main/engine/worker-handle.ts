import type { WorkerHandle } from './local-engine'
import type { ToWorker } from './protocol'

/** The slice of Electron's `UtilityProcess` the engine uses. */
export interface UtilityChild {
  postMessage(message: unknown): void
  kill(): boolean
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
}

/**
 * The engine's worker as `LocalEngine` sees it, made safe to talk to after it
 * has died.
 *
 * Electron 43 crashes the whole main process (crashpad 0xFFFF7003) when a
 * message is posted to a utility process that has already exited but whose
 * pipe has not yet been noticed closing — exactly what the engine's own exit
 * handler did, posting "unload" to a worker that had crashed or been killed.
 * Measured on 30 Oct: 2 crashes in 2 runs without this, none in 8 with it.
 * So once the process has exited, nothing more is posted to it or killed.
 */
export function wrapUtilityChild(child: UtilityChild): WorkerHandle {
  let exited = false
  // Registered first, so it runs before any listener the engine adds.
  child.on('exit', () => {
    exited = true
  })
  return {
    postMessage: (message: ToWorker) => {
      if (!exited) child.postMessage(message)
    },
    kill: () => {
      if (!exited) child.kill()
    },
    onMessage: (listener) => void child.on('message', listener),
    onExit: (listener) => void child.on('exit', listener)
  }
}
