import { describe, expect, it, vi } from 'vitest'
import { ENGINE_STOPPED, LocalEngine } from '../src/main/engine/local-engine'
import { wrapUtilityChild, type UtilityChild } from '../src/main/engine/worker-handle'

/**
 * Electron crashes the main process when a message is posted to a utility
 * process that has exited. This child stands in for one: once it has exited,
 * any post or kill is the crash, recorded.
 */
class DyingChild implements UtilityChild {
  exited = false
  readonly afterExit: string[] = []
  readonly posted: unknown[] = []
  private readonly listeners = { message: [] as Array<(m: unknown) => void>, exit: [] as Array<(c: number) => void> }

  postMessage(message: unknown): void {
    if (this.exited) this.afterExit.push(`post ${JSON.stringify(message)}`)
    else this.posted.push(message)
  }
  kill(): boolean {
    if (this.exited) this.afterExit.push('kill')
    return true
  }
  on(event: 'message' | 'exit', listener: (value: never) => void): this {
    this.listeners[event].push(listener as never)
    return this
  }
  die(code: number): void {
    this.exited = true
    for (const listener of this.listeners.exit) listener(code)
  }
}

describe('wrapUtilityChild', () => {
  it('never posts to or kills an engine process that has died, however the engine reacts', async () => {
    const child = new DyingChild()
    const exits: number[] = []
    const engine = new LocalEngine({
      spawn: () => wrapUtilityChild(child),
      modelDir: 'C:\\models',
      numThreads: 1,
      onUnexpectedExit: (code) => exits.push(code)
    })
    const result = engine.transcribe(new Float32Array(16000).fill(0.2), 16000)
    await vi.waitFor(() => expect(child.posted).toHaveLength(1))
    child.die(3221225477)
    await expect(result).rejects.toThrow(ENGINE_STOPPED)
    expect(exits).toEqual([3221225477])
    // The engine's exit handler tries to unload and kill; nothing reaches the dead process.
    expect(child.afterExit).toEqual([])
    engine.unload()
    engine.dispose()
    expect(child.afterExit).toEqual([])
  })

  it('passes everything through while the process is alive', () => {
    const child = new DyingChild()
    const handle = wrapUtilityChild(child)
    handle.postMessage({ type: 'unload' })
    expect(child.posted).toEqual([{ type: 'unload' }])
    const kill = vi.spyOn(child, 'kill')
    handle.kill()
    expect(kill).toHaveBeenCalledTimes(1)
  })
})
