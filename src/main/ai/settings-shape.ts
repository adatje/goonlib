/**
 * Defaults and validation for the AI settings.
 *
 * Kept apart from `db/settings.ts` so it stays free of Electron and the
 * database, which is what lets the clamping rules be tested directly.
 */

import { DEFAULT_BASE_URL } from '@shared/types'
import type { AiProvider, AiSettings } from '@shared/types'

export const AI_DEFAULTS: AiSettings = {
  enabled: false,
  provider: 'anthropic',
  baseUrl: DEFAULT_BASE_URL,
  model: 'claude-opus-5',
  categories: [],
  autoSort: false,
  minConfidence: 0.6,
  // Deliberately modest. Every unit of concurrency is another request in flight
  // against the user's own rate limit, and a scan can queue tens of thousands.
  concurrency: 4,
  includeVideos: false,
  captions: false,
}

/** Hard ceiling on categories, so the vocabulary can't bloat every prompt. */
export const MAX_CATEGORIES = 150

/**
 * Clamps every field into a range the classifier can actually act on.
 *
 * This runs on read as well as on write, so a value that predates a tightened
 * bound — or one typed straight into the settings row — is corrected rather
 * than honoured.
 */
export function normaliseAiSettings(settings: Partial<AiSettings>): AiSettings {
  const merged = { ...AI_DEFAULTS, ...settings }

  return {
    enabled: Boolean(merged.enabled),
    provider: normaliseProvider(merged.provider),
    baseUrl: normaliseBaseUrl(merged.baseUrl),
    model: text(merged.model) ?? AI_DEFAULTS.model,
    categories: normaliseCategories(merged.categories),
    autoSort: Boolean(merged.autoSort),
    minConfidence: clamp(merged.minConfidence, 0, 1, AI_DEFAULTS.minConfidence),
    concurrency: Math.round(clamp(merged.concurrency, 1, 16, AI_DEFAULTS.concurrency)),
    includeVideos: Boolean(merged.includeVideos),
    captions: Boolean(merged.captions),
  }
}

/**
 * Trims, drops blanks, and dedupes case-insensitively.
 *
 * The case-insensitive part matters beyond tidiness: auto-sorting maps each
 * label onto a collection matched without regard to case, so 'Portraits' and
 * 'portraits' as separate categories would have the model splitting one
 * collection's worth of results across two labels.
 */
export function normaliseCategories(categories: unknown): string[] {
  if (!Array.isArray(categories)) return []

  const seen = new Set<string>()
  const result: string[] = []

  for (const raw of categories) {
    const trimmed = text(raw)
    if (!trimmed) continue

    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    result.push(trimmed)
    if (result.length >= MAX_CATEGORIES) break
  }

  return result
}

export function normaliseProvider(value: unknown): AiProvider {
  return value === 'openai' || value === 'anthropic' ? value : AI_DEFAULTS.provider
}

/**
 * Tidies the endpoint for an OpenAI-compatible server.
 *
 * Trailing slashes are stripped because every request appends its own path, and
 * `/v1//models` is a 404 on some servers. Anything that isn't a parseable http
 * or https URL falls back to the default rather than being sent to `fetch` to
 * fail per item — and rejecting other schemes keeps a stored `file:` from being
 * fetched off the local disk.
 */
export function normaliseBaseUrl(value: unknown): string {
  const trimmed = text(value)
  if (!trimmed) return AI_DEFAULTS.baseUrl

  const withoutSlash = trimmed.replace(/\/+$/, '')

  try {
    const url = new URL(withoutSlash)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return AI_DEFAULTS.baseUrl
  } catch {
    return AI_DEFAULTS.baseUrl
  }

  return withoutSlash
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}
