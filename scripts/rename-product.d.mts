export function currentName(root: string): string
export const PROTECTED_LINES: readonly RegExp[]

export interface RenameChange {
  file: string
  line: number
  before: string
  after: string
}

export function planRename(options: { root: string; name: string; appId: string }): RenameChange[]
export function applyRename(root: string, changes: readonly RenameChange[]): void
