import { PRODUCT_NAME } from './product'
import type { ReplacementRule } from './replacements'

/**
 * Vocette spells its own name, whatever the user's word list holds.
 *
 * The name is a term in every dictation, outside the plan's limit, so a cloud
 * recogniser and polish are told it exists and the correction gives it its
 * capital. The on-device recogniser takes no prompt, and its mishearings are
 * too far from the name for the near-miss correction ("Voset" is three edits
 * from "vocette"), so the ones heard are also built-in replacements. None of
 * them is an English word. Nothing here touches the user's stored lists.
 *
 * The mishearings are of "Vocette" itself: a rename needs its own list.
 */
export const OWN_NAME_MISHEARINGS: readonly string[] = [
  'Voset',
  'Vosett',
  'Vosette',
  'Vossette',
  'Vocet',
  'Vocett'
]

/** The dictation's terms with the product's name added, unless the user listed it. */
export function withOwnName(terms: readonly string[]): string[] {
  const listed = terms.some((term) => term.toLowerCase() === PRODUCT_NAME.toLowerCase())
  return listed ? [...terms] : [...terms, PRODUCT_NAME]
}

/**
 * The dictation's rules with the mishearings of the name added after the
 * user's own, so a rule of theirs for the same word still wins.
 */
export function withOwnNameRules(rules: readonly ReplacementRule[]): ReplacementRule[] {
  return [
    ...rules,
    ...OWN_NAME_MISHEARINGS.map((spoken) => ({ spoken, written: PRODUCT_NAME }))
  ]
}
