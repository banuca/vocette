/**
 * The user's own words — names, acronyms, product and project terms — sent to
 * the transcription provider as recognition bias so they come back spelled
 * correctly on the first take.
 *
 * Stored as one newline-delimited string, exactly as the user typed it, so the
 * text area round-trips without surprises. Parsing into terms happens at the
 * point of use, in the main process, and is deliberately pure so the renderer
 * can show the same count the request will carry.
 *
 * This list leaves the machine with every dictation. That is the whole point
 * of it, and it is stated in the interface, the README and SECURITY.md.
 */

/** Ceiling on the stored string, applied on both the load and save paths. */
export const MAX_VOCABULARY_CHARS = 2000
/** Ceiling on terms actually sent. Beyond this, biasing starts to hurt. */
export const MAX_VOCABULARY_TERMS = 100
/** A term is a name or a phrase, not a sentence. */
export const MAX_VOCABULARY_TERM_CHARS = 48

/**
 * Characters of terms a prompt-biased request will carry.
 *
 * `whisper-1` keeps only the **last** 224 tokens of a prompt, so an unbounded
 * term list silently evicts the language hint the prompt was built for. At
 * roughly four characters per token, 480 characters of terms leaves the
 * language sentence comfortably inside the window. Models with a dedicated
 * keyword field are not budgeted — they take the whole list.
 */
export const MAX_PROMPT_TERM_CHARS = 480

/**
 * Trims the stored string to the ceiling **on a line boundary**.
 *
 * A plain `slice` would cut a term in half, and `parseVocabulary` would then
 * bias the recogniser towards a fragment the user never typed. It would also
 * be free to cut a surrogate pair down the middle. Dropping the whole partial
 * line is the only truthful way to lose characters here.
 */
export function clampVocabulary(raw: string): string {
  if (raw.length <= MAX_VOCABULARY_CHARS) return raw
  const cut = raw.slice(0, MAX_VOCABULARY_CHARS)
  const lastBreak = cut.lastIndexOf('\n')
  // No newline inside the budget means the first line alone overruns it; keep
  // nothing rather than half a word.
  return lastBreak === -1 ? '' : cut.slice(0, lastBreak)
}

/**
 * Splits the stored string into the terms a request will carry.
 *
 * An over-long line is dropped rather than truncated: half a term biases the
 * recogniser towards something the user never asked for, which is worse than
 * omitting it. Order is preserved, because the prompt path weights later terms
 * more heavily and the user's own ordering is the only signal of priority
 * available.
 */
export function parseVocabulary(raw: string): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const terms: string[] = []
  for (const line of raw.split(/\r?\n/u)) {
    const term = line.trim()
    if (!term || term.length > MAX_VOCABULARY_TERM_CHARS) continue
    // Case-insensitive de-duplication: the same term twice buys no accuracy
    // and spends part of whisper-1's 224-token window. `toLowerCase`, not
    // `toLocaleLowerCase` — a Turkish machine must parse the same list the
    // same way a Swiss one does.
    const fingerprint = term.toLowerCase()
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    terms.push(term)
    if (terms.length === MAX_VOCABULARY_TERMS) break
  }
  return terms
}

/**
 * Whether this request may carry a dedicated keyword list.
 *
 * OpenAI documents `keywords` for `gpt-transcribe`. Nothing else is assumed:
 * an OpenAI-compatible server is free to reject an unknown multipart field
 * with a 400, and this is the default model, so a wrong guess here would break
 * **every** dictation rather than degrade one. The endpoint is therefore part
 * of the condition — a custom endpoint gets the prompt path, which every
 * compatible server accepts, even if the user has named the model
 * `gpt-transcribe`.
 *
 * The service also falls back to the prompt path on its own if a request with
 * keywords is rejected, so this predicate only has to be a good first guess.
 */
export function supportsKeywordList(model: string, endpoint: string): boolean {
  return model === 'gpt-transcribe' && endpoint.trim() === ''
}

/**
 * The terms that fit the prompt-biasing budget, in the user's own order.
 *
 * Truncation here is visible to the user through the Settings note rather than
 * silent, because a term that was dropped is a term that will still be
 * misheard.
 */
export function budgetPromptTerms(terms: readonly string[]): string[] {
  const kept: string[] = []
  let used = 0
  for (const term of terms) {
    // +2 for the ", " separator this term will cost once joined.
    const cost = term.length + (kept.length === 0 ? 0 : 2)
    if (used + cost > MAX_PROMPT_TERM_CHARS) break
    kept.push(term)
    used += cost
  }
  return kept
}
