/**
 * The OpenAI-compatible provider: LM Studio, Ollama, vLLM, llama.cpp's server,
 * or a hosted endpoint speaking the same shape.
 *
 * Written against `fetch` rather than the OpenAI SDK on purpose. This is two
 * endpoints — `/chat/completions` and `/models` — and the SDK would add a
 * dependency to the Electron main bundle to save a few lines of request
 * building, while making it harder to give a useful error when the server on
 * localhost simply isn't running.
 */

import type { AiSettings } from '@shared/types'
import { apiKey } from '../../db/settings'
import { instruction, outputSchema, parseClassification, SYSTEM } from '../prompt'
import type { ClassifyOutcome, ImagePayload } from '../types'

const MAX_TOKENS = 1024

/**
 * Far longer than the hosted provider's. A vision model running on local CPU can
 * genuinely take a minute or two per image, and timing it out would mark work as
 * failed that was only slow.
 */
const TIMEOUT_MS = 180_000

interface ChatResponse {
  choices?: Array<{
    message?: { content?: string | null; refusal?: string | null }
    finish_reason?: string
  }>
  error?: { message?: string }
}

export async function classify(
  image: ImagePayload,
  settings: AiSettings,
  signal?: AbortSignal,
): Promise<ClassifyOutcome> {
  const body = {
    model: settings.model,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction(settings.categories, settings.captions) },
          {
            type: 'image_url',
            image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
          },
        ],
      },
    ],
    // The same schema the hosted provider is given. LM Studio and vLLM enforce
    // it with grammar-constrained decoding; servers that ignore it fall through
    // to the parser, which tolerates junk by returning no labels.
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'labels',
        strict: true,
        schema: outputSchema(settings.categories, settings.captions),
      },
    },
  }

  const response = await post<ChatResponse>(settings, '/chat/completions', body, signal)

  const choice = response.choices?.[0]

  // OpenAI's own endpoints report a declined request here; local servers
  // generally never populate it.
  if (choice?.message?.refusal) {
    return { status: 'refused', reason: choice.message.refusal }
  }

  const text = choice?.message?.content
  if (!text) return { status: 'ok', labels: [], caption: null }

  return { status: 'ok', ...parseClassification(text, settings.categories) }
}

/** Model ids the server currently has available. */
export async function listModels(settings: AiSettings): Promise<string[]> {
  const response = await get<{ data?: Array<{ id?: unknown }> }>(settings, '/models')

  return (response.data ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Lists the server's models rather than spending a generation.
 *
 * More useful than a completion here: the usual failure is a server that isn't
 * running or a model id that doesn't match what's loaded, and both show up in
 * this one call.
 */
export async function test(settings: AiSettings): Promise<string> {
  const models = await listModels(settings)

  if (models.length === 0) {
    return `Reached ${settings.baseUrl}, but it is not offering any models`
  }

  if (!models.includes(settings.model)) {
    return `Reached ${settings.baseUrl}, but "${settings.model}" is not loaded. Available: ${models
      .slice(0, 5)
      .join(', ')}${models.length > 5 ? '…' : ''}`
  }

  return `Connected to ${settings.baseUrl} - ${settings.model} is loaded`
}

async function post<T>(
  settings: AiSettings,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return request<T>(settings, path, signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  })
}

async function get<T>(settings: AiSettings, path: string): Promise<T> {
  return request<T>(settings, path, undefined, { headers: authHeader() })
}

async function request<T>(
  settings: AiSettings,
  path: string,
  signal: AbortSignal | undefined,
  init: RequestInit,
): Promise<T> {
  const url = `${settings.baseUrl}${path}`

  // Combined so the scan's cancel and the per-request deadline both apply; a
  // hung local server would otherwise pin a pool slot until the app quits.
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetch(url, { ...init, signal: combined })
  } catch (err) {
    if (signal?.aborted) throw err
    if (timeout.aborted) throw new Error(`${url} did not respond within ${TIMEOUT_MS / 1000}s`)

    // The overwhelmingly common case: nothing is listening on localhost. The
    // native message for that is "fetch failed", which tells the user nothing.
    throw new Error(
      `Could not reach ${settings.baseUrl} - is the server running? (${describe(err)})`,
    )
  }

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${await errorBody(response)}`)
  }

  return (await response.json()) as T
}

/**
 * Local servers ignore the key entirely, so it is optional here — but a hosted
 * OpenAI-compatible endpoint will want it, and sending it costs nothing.
 */
function authHeader(): Record<string, string> {
  const key = apiKey()
  return key ? { authorization: `Bearer ${key}` } : {}
}

async function errorBody(response: Response): Promise<string> {
  try {
    const text = await response.text()
    // Bodies from these servers can be a whole HTML error page; the first line
    // of it is all that fits in a status message anyway.
    return text.slice(0, 300) || response.statusText
  } catch {
    return response.statusText
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.cause instanceof Error ? err.cause.message : err.message
  return String(err)
}
