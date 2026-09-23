import { describe, expect, it } from 'vitest'
import { DEFAULT_BASE_URL } from '../src/shared/types'
import {
  AI_DEFAULTS,
  MAX_CATEGORIES,
  normaliseAiSettings,
  normaliseBaseUrl,
  normaliseCategories,
  normaliseProvider,
} from '../src/main/ai/settings-shape'

/**
 * These settings are read back out of a JSON blob in the settings table, so
 * normalisation is the only thing standing between a hand-edited row and a
 * classify stage that spends money at sixteen requests a second.
 */
describe('normaliseAiSettings', () => {
  it('fills in every default from an empty patch', () => {
    expect(normaliseAiSettings({})).toEqual(AI_DEFAULTS)
  })

  it('keeps values that are already in range', () => {
    const settings = normaliseAiSettings({
      enabled: true,
      model: 'claude-haiku-4-5',
      autoSort: true,
      minConfidence: 0.8,
      concurrency: 8,
      includeVideos: true,
      captions: false,
    })

    expect(settings).toEqual({
      enabled: true,
      provider: 'anthropic',
      baseUrl: DEFAULT_BASE_URL,
      model: 'claude-haiku-4-5',
      categories: [],
      autoSort: true,
      minConfidence: 0.8,
      concurrency: 8,
      includeVideos: true,
      captions: false,
    })
  })

  it('clamps concurrency to something a rate limit can survive', () => {
    expect(normaliseAiSettings({ concurrency: 500 }).concurrency).toBe(16)
    expect(normaliseAiSettings({ concurrency: 0 }).concurrency).toBe(1)
    expect(normaliseAiSettings({ concurrency: -3 }).concurrency).toBe(1)
  })

  it('rounds a fractional concurrency', () => {
    expect(normaliseAiSettings({ concurrency: 3.7 }).concurrency).toBe(4)
  })

  it('clamps confidence to 0..1', () => {
    expect(normaliseAiSettings({ minConfidence: 5 }).minConfidence).toBe(1)
    expect(normaliseAiSettings({ minConfidence: -1 }).minConfidence).toBe(0)
  })

  it('falls back rather than honouring a non-numeric value', () => {
    const settings = normaliseAiSettings({
      concurrency: 'four' as unknown as number,
      minConfidence: Number.NaN,
    })

    expect(settings.concurrency).toBe(AI_DEFAULTS.concurrency)
    expect(settings.minConfidence).toBe(AI_DEFAULTS.minConfidence)
  })

  it('falls back on an empty or missing model', () => {
    // An empty model would be sent to the API verbatim and 404 on every item.
    expect(normaliseAiSettings({ model: '   ' }).model).toBe(AI_DEFAULTS.model)
    expect(normaliseAiSettings({ model: null as unknown as string }).model).toBe(AI_DEFAULTS.model)
  })

  it('trims the model, since a stray space is a different id', () => {
    expect(normaliseAiSettings({ model: '  claude-sonnet-5 ' }).model).toBe('claude-sonnet-5')
  })

  it('coerces truthy junk in the boolean fields', () => {
    const settings = normaliseAiSettings({ enabled: 'yes' as unknown as boolean })
    expect(settings.enabled).toBe(true)
  })
})

describe('normaliseProvider', () => {
  it('accepts the two known providers', () => {
    expect(normaliseProvider('anthropic')).toBe('anthropic')
    expect(normaliseProvider('openai')).toBe('openai')
  })

  it('falls back on anything else', () => {
    // A provider string that reaches the dispatcher unrecognised would silently
    // route to the hosted API, which is the surprising direction to guess wrong.
    expect(normaliseProvider('ollama')).toBe(AI_DEFAULTS.provider)
    expect(normaliseProvider(undefined)).toBe(AI_DEFAULTS.provider)
    expect(normaliseProvider(7)).toBe(AI_DEFAULTS.provider)
  })
})

describe('normaliseBaseUrl', () => {
  it('keeps a well-formed endpoint', () => {
    expect(normaliseBaseUrl('http://localhost:1234/v1')).toBe('http://localhost:1234/v1')
    expect(normaliseBaseUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1')
  })

  it('strips trailing slashes', () => {
    // Every request appends its own path, and `/v1//models` 404s on some servers.
    expect(normaliseBaseUrl('http://localhost:1234/v1/')).toBe('http://localhost:1234/v1')
    expect(normaliseBaseUrl('http://localhost:1234/v1///')).toBe('http://localhost:1234/v1')
  })

  it('trims surrounding whitespace', () => {
    expect(normaliseBaseUrl('  http://localhost:1234/v1  ')).toBe('http://localhost:1234/v1')
  })

  it('falls back on an unparseable URL', () => {
    expect(normaliseBaseUrl('localhost:1234')).toBe(DEFAULT_BASE_URL)
    expect(normaliseBaseUrl('not a url')).toBe(DEFAULT_BASE_URL)
    expect(normaliseBaseUrl('')).toBe(DEFAULT_BASE_URL)
    expect(normaliseBaseUrl(null)).toBe(DEFAULT_BASE_URL)
  })

  it('rejects schemes other than http and https', () => {
    // A stored `file:` endpoint would otherwise have the main process read off
    // the local disk on every classification.
    expect(normaliseBaseUrl('file:///etc/passwd')).toBe(DEFAULT_BASE_URL)
    expect(normaliseBaseUrl('ftp://example.com/v1')).toBe(DEFAULT_BASE_URL)
  })
})

describe('normaliseCategories', () => {
  it('trims and drops blanks', () => {
    expect(normaliseCategories(['  portrait ', '', '   ', 'landscape'])).toEqual([
      'portrait',
      'landscape',
    ])
  })

  it('dedupes case-insensitively, keeping the first spelling', () => {
    // Auto-sorting matches collections without regard to case, so two entries
    // differing only in case would split one collection's results in two.
    expect(normaliseCategories(['Portraits', 'portraits', 'PORTRAITS'])).toEqual(['Portraits'])
  })

  it('preserves the order the user typed', () => {
    expect(normaliseCategories(['c', 'a', 'b'])).toEqual(['c', 'a', 'b'])
  })

  it('caps the vocabulary so the prompt cannot bloat without bound', () => {
    const many = Array.from({ length: MAX_CATEGORIES + 25 }, (_, i) => `cat-${i}`)
    expect(normaliseCategories(many)).toHaveLength(MAX_CATEGORIES)
  })

  it('ignores non-string entries', () => {
    expect(normaliseCategories([1, null, undefined, {}, 'real'])).toEqual(['real'])
  })

  it('returns an empty list for anything that is not an array', () => {
    expect(normaliseCategories('portrait')).toEqual([])
    expect(normaliseCategories(null)).toEqual([])
    expect(normaliseCategories(undefined)).toEqual([])
  })
})
