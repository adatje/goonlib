/**
 * Persisted app settings, stored as text in the `settings` table.
 *
 * Values are read through helpers that fall back to a default rather than
 * throwing, so a corrupt or hand-edited row degrades to sensible behaviour
 * instead of preventing startup.
 */

import { safeStorage } from 'electron'
import { defaultBindings, KEY_ACTIONS, mergeBindings, normalizeBinding } from '@shared/keys'
import type { KeyBindings } from '@shared/keys'
import { IMAGE_SECONDS, RESUME_AFTER } from '@shared/types'
import type { AiSettings, AiSettingsView, PlaybackPrefs, ToyPrefs } from '@shared/types'
import { AI_DEFAULTS, normaliseAiSettings } from '../ai/settings-shape'
import { DEFAULT_CACHE_CAP } from '../media/evict'
import { MAX_RELIABLE_DISTANCE } from '../scan/phash'
import { TOY_DEFAULTS, normaliseToyPrefs } from '../toy/prefs'
import { DEFAULT_DISTANCE } from './duplicates'
import { getDb } from './index'

export const SETTING_CACHE_CAP = 'cache.maxBytes'
export const SETTING_AI = 'ai.settings'
export const SETTING_AI_KEY = 'ai.apiKey'
export const SETTING_AUTOPLAY = 'playback.autoplay'
export const SETTING_VOLUME = 'playback.volume'
export const SETTING_MUTED = 'playback.muted'
export const SETTING_RANDOM_KIND = 'playback.randomKind'
export const SETTING_IMAGE_SECONDS = 'playback.imageSeconds'
export const SETTING_SHUFFLE_DEFAULT = 'playback.shuffleDefault'
export const SETTING_SHOW_METADATA = 'playback.showMetadata'
export const SETTING_PLAY_ON_OPEN = 'playback.playOnOpen'
export const SETTING_SHOW_EXIF = 'playback.showExif'
export const SETTING_SHOW_LOCATION = 'playback.showLocation'
export const SETTING_SHOW_DESCRIPTION = 'playback.showDescription'
export const SETTING_SHOW_CAPTION = 'playback.showCaption'
export const SETTING_SHOW_TAGS = 'playback.showTags'
export const SETTING_LOOP = 'playback.loop'
export const SETTING_KEEP_HISTORY = 'playback.keepHistory'
export const SETTING_RESUME = 'playback.resumePosition'
export const SETTING_RESUME_AFTER = 'playback.resumeAfterPercent'
export const SETTING_SHOW_CONTINUE = 'playback.showContinue'
export const SETTING_RESUME_SESSIONS = 'playback.resumeInSessions'
export const SETTING_DUPLICATE_DISTANCE = 'duplicates.distance'
export const SETTING_TOY = 'toy.prefs'
export const SETTING_KEYS = 'keys.bindings'

/** Every shortcut: the defaults, with whatever has been changed laid over them. */
export function keyBindings(): KeyBindings {
  const stored = getSetting(SETTING_KEYS)
  if (!stored) return defaultBindings()
  try {
    return mergeBindings(JSON.parse(stored))
  } catch {
    return defaultBindings()
  }
}

/** Sets one action's keys. An empty list leaves that action without any. */
export function setKeyBinding(actionId: string, keys: unknown): KeyBindings {
  const known = KEY_ACTIONS.some((action) => action.id === actionId)
  if (!known) return keyBindings()

  const clean = (Array.isArray(keys) ? keys : [])
    .filter((key): key is string => typeof key === 'string' && key.trim() !== '')
    .map(normalizeBinding)
    .slice(0, 4)

  const next = { ...keyBindings(), [actionId]: clean }
  setSetting(SETTING_KEYS, JSON.stringify(next))
  return next
}

/** Puts every shortcut back to how it shipped. */
export function resetKeyBindings(): KeyBindings {
  setSetting(SETTING_KEYS, JSON.stringify(defaultBindings()))
  return defaultBindings()
}
export const SETTING_COWATCH_NAME = 'cowatch.hostName'

/** What the host is called in a session. */
export const DEFAULT_HOST_NAME = 'host'

export function hostName(): string {
  return cleanHostName(getSetting(SETTING_COWATCH_NAME)) || DEFAULT_HOST_NAME
}

export function setHostName(name: unknown): string {
  setSetting(SETTING_COWATCH_NAME, cleanHostName(name))
  return hostName()
}

/** One line, trimmed, and short enough to fit a chat line. */
function cleanHostName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 32) : ''
}

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
    .get(key)
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value)
}

export function clearSetting(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
}

/** The prepared-media cache ceiling, in bytes. */
export function cacheCap(): number {
  const stored = getSetting(SETTING_CACHE_CAP)
  if (stored === null) return DEFAULT_CACHE_CAP

  const parsed = Number(stored)
  // A nonsensical value would either disable the cache or disable the cap; both
  // are worse than ignoring it.
  if (!Number.isFinite(parsed) || parsed < 1024 * 1024 * 100) return DEFAULT_CACHE_CAP

  return parsed
}

export function setCacheCap(bytes: number): void {
  setSetting(SETTING_CACHE_CAP, String(Math.max(1024 * 1024 * 100, Math.floor(bytes))))
}

/**
 * How the viewer behaves around starting and finishing a video.
 *
 * On unless it has been turned off: opening a video has always started it
 * playing. A library left over from when this was two settings keeps whatever
 * it had for autoplay; the old `playback.autoplayNext` row is simply ignored.
 */
export function playbackPrefs(): PlaybackPrefs {
  const volume = Number(getSetting(SETTING_VOLUME) ?? 1)
  return {
    autoplay: getSetting(SETTING_AUTOPLAY) !== '0',
    // On unless turned off: opening a video has always started it.
    playOnOpen: getSetting(SETTING_PLAY_ON_OPEN) !== '0',
    // A bad row means full volume, the same as never having touched it.
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1,
    muted: getSetting(SETTING_MUTED) === '1',
    randomKind: randomKind(getSetting(SETTING_RANDOM_KIND)),
    imageSeconds: imageSeconds(getSetting(SETTING_IMAGE_SECONDS)),
    shuffleDefault: getSetting(SETTING_SHUFFLE_DEFAULT) === '1',
    showMetadata: getSetting(SETTING_SHOW_METADATA) === '1',
    showExif: getSetting(SETTING_SHOW_EXIF) === '1',
    showLocation: getSetting(SETTING_SHOW_LOCATION) === '1',
    // On unless turned off: the viewer has always shown these.
    showDescription: getSetting(SETTING_SHOW_DESCRIPTION) !== '0',
    showCaption: getSetting(SETTING_SHOW_CAPTION) !== '0',
    showTags: getSetting(SETTING_SHOW_TAGS) !== '0',
    loop: getSetting(SETTING_LOOP) === '1',
    keepHistory: getSetting(SETTING_KEEP_HISTORY) !== '0',
    resumePosition: getSetting(SETTING_RESUME) !== '0',
    resumeAfterPercent: percent(getSetting(SETTING_RESUME_AFTER)),
    showContinue: getSetting(SETTING_SHOW_CONTINUE) !== '0',
    resumeInSessions: getSetting(SETTING_RESUME_SESSIONS) !== '0',
  }
}

/** A whole percentage within the allowed range; anything unreadable is the default. */
function percent(value: unknown): number {
  const share = Number(value ?? RESUME_AFTER.default)
  if (!Number.isFinite(share)) return RESUME_AFTER.default
  return Math.min(RESUME_AFTER.max, Math.max(RESUME_AFTER.min, Math.round(share)))
}

/** Whole seconds, held between the limits; anything unreadable is the default. */
function imageSeconds(value: unknown): number {
  const seconds = Number(value ?? IMAGE_SECONDS.default)
  if (!Number.isFinite(seconds)) return IMAGE_SECONDS.default
  return Math.min(IMAGE_SECONDS.max, Math.max(IMAGE_SECONDS.min, Math.round(seconds)))
}

function randomKind(value: unknown): PlaybackPrefs['randomKind'] {
  return value === 'video' || value === 'image' ? value : 'all'
}

export function setPlaybackPrefs(patch: Partial<PlaybackPrefs>): PlaybackPrefs {
  if (patch.autoplay !== undefined) setSetting(SETTING_AUTOPLAY, patch.autoplay ? '1' : '0')
  if (patch.playOnOpen !== undefined) setSetting(SETTING_PLAY_ON_OPEN, patch.playOnOpen ? '1' : '0')
  if (typeof patch.volume === 'number' && Number.isFinite(patch.volume)) {
    setSetting(SETTING_VOLUME, String(Math.min(1, Math.max(0, patch.volume))))
  }
  if (patch.muted !== undefined) setSetting(SETTING_MUTED, patch.muted ? '1' : '0')
  if (patch.randomKind !== undefined) setSetting(SETTING_RANDOM_KIND, randomKind(patch.randomKind))
  if (patch.imageSeconds !== undefined) {
    setSetting(SETTING_IMAGE_SECONDS, String(imageSeconds(patch.imageSeconds)))
  }
  if (patch.shuffleDefault !== undefined) {
    setSetting(SETTING_SHUFFLE_DEFAULT, patch.shuffleDefault ? '1' : '0')
  }
  if (patch.showMetadata !== undefined) {
    setSetting(SETTING_SHOW_METADATA, patch.showMetadata ? '1' : '0')
  }
  if (patch.showExif !== undefined) setSetting(SETTING_SHOW_EXIF, patch.showExif ? '1' : '0')
  if (patch.showLocation !== undefined) {
    setSetting(SETTING_SHOW_LOCATION, patch.showLocation ? '1' : '0')
  }
  if (patch.showDescription !== undefined) {
    setSetting(SETTING_SHOW_DESCRIPTION, patch.showDescription ? '1' : '0')
  }
  if (patch.showCaption !== undefined) {
    setSetting(SETTING_SHOW_CAPTION, patch.showCaption ? '1' : '0')
  }
  if (patch.showTags !== undefined) setSetting(SETTING_SHOW_TAGS, patch.showTags ? '1' : '0')
  if (patch.loop !== undefined) setSetting(SETTING_LOOP, patch.loop ? '1' : '0')
  if (patch.keepHistory !== undefined) {
    setSetting(SETTING_KEEP_HISTORY, patch.keepHistory ? '1' : '0')
  }
  if (patch.resumePosition !== undefined) setSetting(SETTING_RESUME, patch.resumePosition ? '1' : '0')
  if (patch.resumeAfterPercent !== undefined) {
    setSetting(SETTING_RESUME_AFTER, String(percent(patch.resumeAfterPercent)))
  }
  if (patch.showContinue !== undefined) {
    setSetting(SETTING_SHOW_CONTINUE, patch.showContinue ? '1' : '0')
  }
  if (patch.resumeInSessions !== undefined) {
    setSetting(SETTING_RESUME_SESSIONS, patch.resumeInSessions ? '1' : '0')
  }
  return playbackPrefs()
}

/**
 * How alike two images must look to count as near-duplicates, as a Hamming
 * distance between perceptual hashes. Held inside what the hash banding can
 * reliably find, so a looser setting never silently misses matches.
 */
export function duplicateDistance(): number {
  const stored = Number(getSetting(SETTING_DUPLICATE_DISTANCE))
  return Number.isInteger(stored) && stored >= 1 && stored <= MAX_RELIABLE_DISTANCE
    ? stored
    : DEFAULT_DISTANCE
}

export function setDuplicateDistance(distance: number): number {
  const clamped = Math.round(Math.min(MAX_RELIABLE_DISTANCE, Math.max(1, Number(distance) || 0)))
  setSetting(SETTING_DUPLICATE_DISTANCE, String(clamped))
  return duplicateDistance()
}

// ---------------------------------------------------------------------------
// Toys
// ---------------------------------------------------------------------------

export function toyPrefs(): ToyPrefs {
  const stored = getSetting(SETTING_TOY)
  if (stored === null) return { ...TOY_DEFAULTS }

  try {
    return normaliseToyPrefs(JSON.parse(stored) as Partial<ToyPrefs>)
  } catch {
    return { ...TOY_DEFAULTS }
  }
}

export function setToyPrefs(patch: Partial<ToyPrefs>): ToyPrefs {
  const next = normaliseToyPrefs({ ...toyPrefs(), ...patch })
  setSetting(SETTING_TOY, JSON.stringify(next))
  return next
}

// ---------------------------------------------------------------------------
// AI categorisation
// ---------------------------------------------------------------------------

export function aiSettings(): AiSettings {
  const stored = getSetting(SETTING_AI)
  if (stored === null) return { ...AI_DEFAULTS }

  try {
    return normaliseAiSettings(JSON.parse(stored) as Partial<AiSettings>)
  } catch {
    // A hand-edited or half-written row shouldn't wedge the app in a state where
    // settings can't be opened to fix it.
    return { ...AI_DEFAULTS }
  }
}

export function setAiSettings(patch: Partial<AiSettings>): AiSettings {
  const next = normaliseAiSettings({ ...aiSettings(), ...patch })
  setSetting(SETTING_AI, JSON.stringify(next))
  return next
}

/**
 * Marks a stored key as ciphertext. Without it there is no way to tell an
 * encrypted blob from a key that happens to be valid base64, and a machine that
 * loses keychain access would silently send garbage as its credential.
 */
const ENCRYPTED_PREFIX = 'enc:'

export function setApiKey(key: string): void {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('An API key cannot be empty')

  if (encryptionAvailable()) {
    setSetting(SETTING_AI_KEY, ENCRYPTED_PREFIX + safeStorage.encryptString(trimmed).toString('base64'))
    return
  }

  // Refusing outright would leave the feature unusable on a machine with no
  // keychain, so the key is stored as-is and the UI is told to say so.
  setSetting(SETTING_AI_KEY, trimmed)
}

export function clearApiKey(): void {
  clearSetting(SETTING_AI_KEY)
}

export function hasApiKey(): boolean {
  return getSetting(SETTING_AI_KEY) !== null
}

/**
 * The decrypted key. Main-process only — this value must never be returned over
 * IPC, which is why the renderer's view carries `apiKeyPresent` instead.
 */
export function apiKey(): string | null {
  const stored = getSetting(SETTING_AI_KEY)
  if (stored === null) return null

  if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored

  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64'))
  } catch (err) {
    // Typically a restored backup or a new OS user: the ciphertext is intact but
    // this keychain can't open it. Surfacing it as "no key" prompts a re-entry,
    // which is the only real fix.
    console.error('[ai] stored API key could not be decrypted:', err)
    return null
  }
}

function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/**
 * Whether the configured provider has everything it needs.
 *
 * Only the hosted provider requires a key. A local server is normally
 * unauthenticated, so demanding one there would block the setup that most
 * people choosing it actually have.
 */
export function aiReady(settings: AiSettings = aiSettings()): boolean {
  return settings.provider === 'anthropic' ? hasApiKey() : settings.baseUrl.length > 0
}

/** The settings as the renderer sees them, with the key reduced to a flag. */
export function aiSettingsView(): AiSettingsView {
  const stored = getSetting(SETTING_AI_KEY)
  const settings = aiSettings()

  return {
    ...settings,
    ready: aiReady(settings),
    apiKeyPresent: stored !== null,
    apiKeyEncrypted: stored !== null && stored.startsWith(ENCRYPTED_PREFIX),
  }
}
