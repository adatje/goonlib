/**
 * The viewer's playback preference, round-tripped through the database.
 *
 * One switch covering both halves of autoplay — start what is opened, and go on
 * to the next item at the end — so what matters is that it defaults to on and
 * that turning it off is remembered.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = await mkdtemp(join(tmpdir(), 'goonlib-prefs-'))

vi.mock('electron', () => ({ app: { getPath: () => workspace } }))

const { initDb, closeDb, getDb } = await import('../src/main/db')
const { playbackPrefs, setPlaybackPrefs } = await import('../src/main/db/settings')

beforeAll(() => {
  initDb(join(workspace, 'test.db'))
})

beforeEach(() => {
  getDb().prepare("DELETE FROM settings WHERE key LIKE 'playback%'").run()
})

afterAll(async () => {
  closeDb()
  await rm(workspace, { recursive: true, force: true })
})

const DEFAULTS = {
  autoplay: true,
  playOnOpen: true,
  volume: 1,
  muted: false,
  randomKind: 'all',
  imageSeconds: 8,
  shuffleDefault: false,
  showMetadata: false,
  showExif: false,
  showLocation: false,
  showDescription: true,
  showCaption: true,
  showTags: true,
  loop: false,
  keepHistory: true,
  resumePosition: true,
  resumeAfterPercent: 30,
  showContinue: true,
  continueCount: 20,
  resumeInSessions: true,
  autoUpdate: true,
}

describe('playback preference', () => {
  it('is on until it is turned off', () => {
    expect(playbackPrefs()).toEqual(DEFAULTS)
  })

  it('remembers being turned off', () => {
    expect(setPlaybackPrefs({ autoplay: false })).toEqual({ ...DEFAULTS, autoplay: false })
    expect(playbackPrefs().autoplay).toBe(false)
  })

  it('turns back on', () => {
    setPlaybackPrefs({ autoplay: false })
    expect(setPlaybackPrefs({ autoplay: true }).autoplay).toBe(true)
  })

  it('ignores the old autoplay-next row a previous version left behind', () => {
    getDb()
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('playback.autoplayNext', '1')")
      .run()

    expect(playbackPrefs()).toEqual(DEFAULTS)
  })
})

describe('volume', () => {
  it('remembers where it was left, and whether it was muted', () => {
    setPlaybackPrefs({ volume: 0.35, muted: true })
    expect(playbackPrefs()).toMatchObject({ volume: 0.35, muted: true })
  })

  it('stays between silent and full, whatever is sent', () => {
    expect(setPlaybackPrefs({ volume: 4 }).volume).toBe(1)
    expect(setPlaybackPrefs({ volume: -1 }).volume).toBe(0)
    expect(setPlaybackPrefs({ volume: Number.NaN }).volume).toBe(0)
  })
})

describe('what Random picks from', () => {
  it('is everything until narrowed, and remembers being narrowed', () => {
    expect(setPlaybackPrefs({ randomKind: 'video' }).randomKind).toBe('video')
    expect(playbackPrefs().randomKind).toBe('video')
    expect(setPlaybackPrefs({ randomKind: 'all' }).randomKind).toBe('all')
  })
})

describe('image autoplay timer', () => {
  it('holds whole seconds between 1 and 500', () => {
    expect(setPlaybackPrefs({ imageSeconds: 0 }).imageSeconds).toBe(1)
    expect(setPlaybackPrefs({ imageSeconds: 9999 }).imageSeconds).toBe(500)
    expect(setPlaybackPrefs({ imageSeconds: 12.4 }).imageSeconds).toBe(12)
    expect(setPlaybackPrefs({ imageSeconds: Number.NaN }).imageSeconds).toBe(8)
  })
})

describe('shuffle by default', () => {
  it('is off until turned on, and remembered', () => {
    expect(playbackPrefs().shuffleDefault).toBe(false)
    expect(setPlaybackPrefs({ shuffleDefault: true }).shuffleDefault).toBe(true)
    expect(playbackPrefs().shuffleDefault).toBe(true)
  })
})
