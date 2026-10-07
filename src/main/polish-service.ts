import {
  acceptPolish,
  polishSystemPrompt,
  type PolishOutcome,
  type PolishStyle
} from '../shared/polish'

/**
 * One chat request to an OpenAI-compatible API, inside the user's time budget.
 * Every way it can go wrong comes back as unpolished text with a short reason,
 * never as a thrown error: a polish failure is never a dictation failure.
 */

export interface PolishRequest {
  text: string
  style: PolishStyle
  instructions: string
  terms: readonly string[]
  endpoint: string
  model: string
  /** Empty = none, and then no Authorization header at all. */
  apiKey: string
  budgetMs: number
  /** The dictation's own cancel; a cancelled take sends nothing more. */
  signal?: AbortSignal
}

/** Where the reason for going unpolished comes from, in the overlay's few words. */
export class PolishError extends Error {
  constructor(
    /** A few words for the overlay: "took too long". */
    readonly reason: string,
    /** A sentence for the Test button. */
    message: string
  ) {
    super(message)
  }
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint
  }
}

function isLoopback(endpoint: string): boolean {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(endpoint).hostname)
  } catch {
    return false
  }
}

function statusError(status: number, apiMessage: string, endpoint: string, keySent: boolean): PolishError {
  const host = hostOf(endpoint)
  if (status === 401 || status === 403) {
    return new PolishError(
      'the key was refused',
      keySent
        ? `${host} refused the key (HTTP ${status}). Check the polish key.`
        : `${host} needs a key (HTTP ${status}). Add one for polish.`
    )
  }
  if (status === 404) {
    return new PolishError(
      'model not found',
      `${host} does not have that model (HTTP 404). Check the model name.`
    )
  }
  if (status === 429) {
    return new PolishError('rate limited', `${host} is limiting requests (HTTP 429). Try again later.`)
  }
  if (status >= 500) {
    return new PolishError('the service had an error', `${host} had an error (HTTP ${status}).`)
  }
  return new PolishError(
    `HTTP ${status}`,
    apiMessage ? `${host}: ${apiMessage}` : `${host} answered with HTTP ${status}.`
  )
}

/** A 400 that names temperature: a model that only takes its default. */
function rejectsTemperature(status: number, apiMessage: string): boolean {
  return status === 400 && /temperature/iu.test(apiMessage)
}

/**
 * Sends the transcript for polishing and returns what to paste. Resolves in
 * every case; `polished` says whether the model's text was used.
 */
export async function polishText(request: PolishRequest): Promise<PolishOutcome> {
  try {
    const text = await requestPolish(request)
    const accepted = acceptPolish(request.text, text, request.style)
    if (accepted === null) {
      return { text: request.text, polished: false, note: 'the reply looked wrong' }
    }
    return { text: accepted, polished: accepted !== request.text, note: null }
  } catch (error) {
    const reason = error instanceof PolishError ? error.reason : 'it did not work'
    return { text: request.text, polished: false, note: reason }
  }
}

/**
 * The model's reply, untouched, or a PolishError. Used as it is by the Test
 * button, which shows the sentence rather than the few words.
 */
export async function requestPolish(request: PolishRequest): Promise<string> {
  const endpoint = request.endpoint.trim().replace(/\/+$/u, '')
  if (!request.model.trim()) {
    throw new PolishError('no model chosen', 'Choose a model for polish in Settings.')
  }
  const url = `${endpoint}/chat/completions`
  const keySent = request.apiKey !== ''
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (keySent) headers.Authorization = `Bearer ${request.apiKey}`

  // One budget for the whole attempt, however many requests it takes.
  const budget = AbortSignal.timeout(request.budgetMs)
  const signal = request.signal ? AbortSignal.any([request.signal, budget]) : budget

  const send = async (withTemperature: boolean): Promise<Response> => {
    const body: Record<string, unknown> = {
      model: request.model.trim(),
      messages: [
        {
          role: 'system',
          content: polishSystemPrompt({
            style: request.style,
            instructions: request.instructions,
            terms: request.terms
          })
        },
        { role: 'user', content: request.text }
      ]
    }
    if (withTemperature) body.temperature = 0.2
    try {
      return await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    } catch (error) {
      if (budget.aborted) {
        throw new PolishError(
          'took too long',
          `No answer within ${Math.round(request.budgetMs / 1000)} seconds.`
        )
      }
      if (request.signal?.aborted) throw error
      throw isLoopback(endpoint)
        ? new PolishError(
            `${hostOf(endpoint)} is not running`,
            `Could not reach ${hostOf(endpoint)}. Is it running?`
          )
        : new PolishError(
            'could not reach the service',
            `Could not reach ${hostOf(endpoint)}. Check your internet connection.`
          )
    }
  }

  const read = async (response: Response): Promise<{ payload: Record<string, unknown>; message: string }> => {
    let payload: Record<string, unknown> = {}
    try {
      const parsed: unknown = await response.json()
      if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>
    } catch (error) {
      if (budget.aborted) {
        throw new PolishError(
          'took too long',
          `No answer within ${Math.round(request.budgetMs / 1000)} seconds.`,
        )
      }
      if (request.signal?.aborted) throw error
    }
    const apiError = payload.error
    const message =
      apiError && typeof apiError === 'object' && typeof (apiError as { message?: unknown }).message === 'string'
        ? ((apiError as { message: string }).message)
        : ''
    return { payload, message }
  }

  let response = await send(true)
  let { payload, message } = await read(response)
  if (!response.ok && rejectsTemperature(response.status, message)) {
    // Some models take only their default temperature; they are asked once more without it.
    response = await send(false)
    ;({ payload, message } = await read(response))
  }
  if (!response.ok) throw statusError(response.status, message, endpoint, keySent)

  const choices = payload.choices
  const first = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined
  const content = (first?.message as { content?: unknown } | undefined)?.content
  if (typeof content !== 'string') {
    throw new PolishError(
      'the reply looked wrong',
      `${hostOf(endpoint)} answered, but not like a chat API. Check the endpoint.`
    )
  }
  return content
}
