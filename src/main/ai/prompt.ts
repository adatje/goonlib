/**
 * What we ask the model, and how its answer is read back.
 *
 * Free of the SDK and of Electron so the schema and the parser can be exercised
 * directly — the parser in particular is the only place a bad response can turn
 * into bad labels on disk.
 */

export interface ScoredLabel {
  label: string
  confidence: number
}

export interface Classification {
  labels: ScoredLabel[]
  /** Null unless captions were asked for, or the model returned only whitespace. */
  caption: string | null
}

/** Cap on a stored caption. Long enough for a paragraph, short enough to index. */
const MAX_CAPTION = 2000

export const SYSTEM = [
  'You label images for the owner of a personal media library, so they can find things again later.',
  'Describe only what is actually visible. If you are unsure, say so with a low confidence rather than guessing a label.',
].join(' ')

/**
 * The response shape.
 *
 * Constraining it server-side means the reply is either valid against this
 * schema or an error — there is no half-parsed middle case downstream. When the
 * user has set categories they become an enum, which is what stops the model
 * inventing a sixty-first label the collections were never set up for.
 */
export function outputSchema(categories: string[], caption = false): Record<string, unknown> {
  const label: Record<string, unknown> =
    categories.length > 0 ? { type: 'string', enum: categories } : { type: 'string' }

  const properties: Record<string, unknown> = {
    labels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label,
          // Structured outputs reject numeric bounds, so the range is stated
          // in the prompt and clamped on the way out.
          confidence: { type: 'number' },
        },
        required: ['label', 'confidence'],
        additionalProperties: false,
      },
    },
  }

  // Asked for in the same request as the labels rather than a second pass: it is
  // the same image and the same forward pass, so a separate call would double
  // the cost and the wall-clock for no extra information.
  if (caption) properties.caption = { type: 'string' }

  return {
    type: 'object',
    properties,
    required: caption ? ['labels', 'caption'] : ['labels'],
    additionalProperties: false,
  }
}

export function instruction(categories: string[], caption = false): string {
  const parts: string[] = []

  if (categories.length > 0) {
    parts.push(
      'Choose every label from the provided list that applies to this image.',
      'Return an empty list if none of them do — a wrong label is worse than no label.',
      'For each one, give your confidence from 0 to 1 that it applies.',
    )
  } else {
    parts.push(
      'Give up to five short labels for this image: subject, setting, and style.',
      'Prefer labels that would still be useful applied across a whole library, not one-off details.',
      'For each one, give your confidence from 0 to 1.',
    )
  }

  if (caption) {
    // Written to be searched, not read: the caption's job is to contain the
    // words someone would actually type months later looking for this image.
    parts.push(
      'Also write a caption: two or three sentences describing what is in the image —',
      'who or what is present, what they are doing, the setting, and anything visually distinctive.',
      'Use plain concrete nouns someone would search for. Do not speculate about anything you cannot see.',
    )
  }

  return parts.join(' ')
}

/**
 * Reads the model's reply.
 *
 * The schema guarantees the shape, so this enforces only what a schema can't:
 * the 0..1 range, the caption length, and — when a vocabulary is configured —
 * that the label really is one of the user's own categories.
 */
export function parseClassification(text: string, categories: string[]): Classification {
  let parsed: {
    labels?: Array<{ label?: unknown; confidence?: unknown }>
    caption?: unknown
  }

  try {
    parsed = JSON.parse(text) as typeof parsed
  } catch {
    // Nothing usable. Returning empty marks the item "classified, nothing
    // found", which is right: retrying would re-run the same request.
    return { labels: [], caption: null }
  }

  // `JSON.parse` happily returns null, a number, or a string — all valid JSON,
  // none of them objects to read fields off.
  if (typeof parsed !== 'object' || parsed === null) return { labels: [], caption: null }

  return {
    labels: parseLabels(parsed.labels, categories),
    caption: parseCaption(parsed.caption),
  }
}

function parseCaption(value: unknown): string | null {
  if (typeof value !== 'string') return null

  // Collapsed because a caption is indexed and displayed on one line; a model
  // that returns a bulleted list would otherwise carry its newlines into both.
  const collapsed = value.replace(/\s+/g, ' ').trim()
  if (!collapsed) return null

  return collapsed.length > MAX_CAPTION ? collapsed.slice(0, MAX_CAPTION) : collapsed
}

function parseLabels(
  raw: Array<{ label?: unknown; confidence?: unknown }> | undefined,
  categories: string[],
): ScoredLabel[] {
  if (!Array.isArray(raw)) return []

  const allowed = new Map(categories.map((name) => [name.toLowerCase(), name]))
  const seen = new Set<string>()
  const labels: ScoredLabel[] = []

  for (const entry of raw) {
    if (typeof entry?.label !== 'string') continue

    const trimmed = entry.label.trim()
    if (!trimmed) continue

    // Snap back to the user's own spelling, so a collection name stays stable
    // even if the model varies the casing between items.
    const canonical = allowed.size > 0 ? allowed.get(trimmed.toLowerCase()) : trimmed
    if (!canonical) continue

    // A duplicate would otherwise be inserted twice and the second confidence
    // would win, which is not necessarily the higher one.
    const key = canonical.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const raw = entry.confidence
    const confidence = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0

    labels.push({ label: canonical, confidence: Math.min(1, Math.max(0, confidence)) })
  }

  return labels
}
