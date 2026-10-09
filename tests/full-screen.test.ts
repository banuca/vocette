import { describe, expect, it } from 'vitest'
import type { KoffiLoader } from '../src/main/foreground'
import { createFullScreenProbe } from '../src/main/platform/full-screen'

/** A koffi stand-in whose shell32 reports the given state and result. */
function fakeKoffi(state: number, result = 0, signatures: string[] = []): KoffiLoader {
  return () =>
    ({
      load: (library: string) => {
        expect(library).toBe('shell32.dll')
        return {
          func: (signature: string) => {
            signatures.push(signature)
            return (out: number[]) => {
              out[0] = state
              return result
            }
          }
        }
      }
    }) as unknown as typeof import('koffi')
}

describe('full-screen probe', () => {
  it('asks the shell, and steps aside for a full-screen app, presentation mode or a locked screen', () => {
    const signatures: string[] = []
    expect(createFullScreenProbe(fakeKoffi(2, 0, signatures))()).toBe(true)
    expect(signatures).toEqual(['int32 SHQueryUserNotificationState(_Out_ int32 *pquns)'])
    for (const state of [1, 3, 4, 7]) expect(createFullScreenProbe(fakeKoffi(state))()).toBe(true)
  })

  it('stays when notifications are welcome, or in quiet time', () => {
    expect(createFullScreenProbe(fakeKoffi(5))()).toBe(false)
    expect(createFullScreenProbe(fakeKoffi(6))()).toBe(false)
  })

  it('takes a failed call as no answer, and stays', () => {
    expect(createFullScreenProbe(fakeKoffi(2, -2147467259))()).toBe(false)
  })

  it('stays when koffi is missing, will not load, or the call throws', () => {
    expect(createFullScreenProbe(() => null)()).toBe(false)
    expect(
      createFullScreenProbe(() => {
        throw new Error('no koffi')
      })()
    ).toBe(false)
    const throwing: KoffiLoader = () =>
      ({
        load: () => ({
          func: () => () => {
            throw new Error('call failed')
          }
        })
      }) as unknown as typeof import('koffi')
    expect(createFullScreenProbe(throwing)()).toBe(false)
  })
})
