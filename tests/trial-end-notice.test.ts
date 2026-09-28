import { afterEach, describe, expect, it, vi } from 'vitest'
import { TRIAL_END_NOTICE } from '../src/renderer/licence-text'
import { createTrialEndNotice } from '../src/renderer/trial-end-notice'

/** Just enough of the DOM for the card: elements, text, children and clicks. */
class FakeElement {
  type = ''
  className = ''
  textContent: string | null = ''
  children: FakeElement[] = []
  readonly attributes = new Map<string, string>()
  private readonly listeners = new Map<string, Array<() => void>>()

  constructor(readonly tagName: string) {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes)
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children = [...nodes]
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  click(): void {
    this.listeners.get('click')?.forEach((listener) => listener())
  }

  /** Every element under this one, depth first. */
  all(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.all()])
  }
}

function render() {
  vi.stubGlobal('document', { createElement: (tag: string) => new FakeElement(tag) })
  const host = new FakeElement('div')
  const seePro = vi.fn()
  const dismiss = vi.fn()
  const view = createTrialEndNotice(host as unknown as HTMLElement, { seePro, dismiss })
  const buttons = (): FakeElement[] => host.all().filter((element) => element.tagName === 'button')
  return { host, view, seePro, dismiss, buttons }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the trial-end notice', () => {
  it('shows nothing while it is not due', () => {
    const { host, view } = render()
    view.apply(false)
    expect(host.children).toEqual([])
  })

  it('says the trial has ended, in the one sentence, with See Pro and Dismiss', () => {
    const { host, view, buttons } = render()
    view.apply(true)
    const text = host.all().find((element) => element.tagName === 'p')
    expect(text?.textContent).toBe(TRIAL_END_NOTICE)
    expect(buttons().map((button) => button.textContent)).toEqual(['See Pro', 'Dismiss'])
    expect(buttons().every((button) => button.type === 'button')).toBe(true)
  })

  it('opens Pro, or dismisses, when asked', () => {
    const { view, seePro, dismiss, buttons } = render()
    view.apply(true)
    buttons()[0]?.click()
    expect(seePro).toHaveBeenCalledTimes(1)
    expect(dismiss).not.toHaveBeenCalled()
    buttons()[1]?.click()
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('goes once it is no longer due, and is not redrawn for the same state', () => {
    const { host, view } = render()
    view.apply(true)
    const card = host.children[0]
    view.apply(true)
    expect(host.children[0]).toBe(card)
    view.apply(false)
    expect(host.children).toEqual([])
  })
})
