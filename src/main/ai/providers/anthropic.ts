/**
 * The Claude API provider.
 *
 * Uses the official SDK, which handles retry-on-429/5xx and the request shape.
 * The key is read on demand from the encrypted settings row and never leaves
 * the main process.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { AiSettings } from '@shared/types'
import { apiKey } from '../../db/settings'
import { instruction, outputSchema, parseClassification, SYSTEM } from '../prompt'
import type { ClassifyOutcome, ImagePayload } from '../types'

/** Per-request ceiling. A label list is tiny; this is headroom, not a target. */
const MAX_TOKENS = 1024

/** One image should never hold a pool slot for longer than this. */
const TIMEOUT_MS = 60_000

let cached: { key: string; client: Anthropic } | null = null

/**
 * The client for the stored key, rebuilt whenever that key changes so editing
 * it in settings takes effect without a restart.
 */
function client(): Anthropic {
  const key = apiKey()
  if (!key) throw new Error('No Claude API key is set - add one in Settings')

  if (!cached || cached.key !== key) {
    cached = {
      key,
      client: new Anthropic({ apiKey: key, maxRetries: 3, timeout: TIMEOUT_MS }),
    }
  }

  return cached.client
}

/** Drops the memoised client, so the next call picks up changed settings. */
export function reset(): void {
  cached = null
}

export async function classify(
  image: ImagePayload,
  settings: AiSettings,
  signal?: AbortSignal,
): Promise<ClassifyOutcome> {
  const response = await client().messages.create(
    {
      model: settings.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      // Low effort with thinking left on: a single-image label call does not
      // need deep reasoning, and disabling thinking outright is the more
      // expensive lever in every sense.
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: outputSchema(settings.categories, settings.captions) },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
            },
            { type: 'text', text: instruction(settings.categories, settings.captions) },
          ],
        },
      ],
    },
    { signal },
  )

  // Must come before reading content: a refusal returns HTTP 200 with an empty
  // or partial content array, so indexing into it blindly would throw.
  if (response.stop_reason === 'refusal') {
    return {
      status: 'refused',
      reason: response.stop_details?.explanation ?? 'declined by the model',
    }
  }

  const text = response.content.find((block) => block.type === 'text')?.text
  if (!text) return { status: 'ok', labels: [], caption: null }

  return { status: 'ok', ...parseClassification(text, settings.categories) }
}

/** Sends one trivial request, purely to prove the key and model work. */
export async function test(settings: AiSettings): Promise<string> {
  await client().messages.create({
    model: settings.model,
    max_tokens: 16,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  })

  return `Connected to ${settings.model}`
}
