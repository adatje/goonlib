/**
 * Favorites against a real database: the filter, the count, and — the part that
 * would hurt to get wrong — that a heart outlives the things that routinely
 * rewrite a media row.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = await mkdtemp(join(tmpdir(), 'goonlib-favorites-'))

vi.mock('electron', () => ({
  app: { getPath: () => workspace },
}))

const { initDb, closeDb, getDb } = await import('../src/main/db')
const { addRoot, libraryStats } = await import('../src/main/db/queries')
const { listMedia, listMediaIds, relocateMedia, upsertMediaBatch, getMedia } = await import(
  '../src/main/db/media'
)
const { isFavorite, setFavorite } = await import('../src/main/db/favorites')

let rootId: number
const ids: Record<string, number> = {}

const FILES = ['a.jpg', 'b.jpg', 'c.mp4']

function entry(name: string, mtime = 1): Parameters<typeof upsertMediaBatch>[1][number] {
  const video = name.endsWith('.mp4')
  return {
    relPath: name,
    name,
    ext: video ? '.mp4' : '.jpg',
    kind: video ? 'video' : 'image',
    size: 100,
    mtime,
  }
}

beforeAll(() => {
  initDb(join(workspace, 'test.db'))
  rootId = addRoot(workspace).id
  upsertMediaBatch(rootId, FILES.map((name) => entry(name)), Date.now())

  const rows = getDb().prepare('SELECT id, name FROM media').all() as Array<{ id: number; name: string }>
  for (const row of rows) ids[row.name] = row.id
})

beforeEach(() => {
  getDb().prepare('UPDATE media SET favorited_at = NULL').run()
})

afterAll(async () => {
  closeDb()
  await rm(workspace, { recursive: true, force: true })
})

const all = { limit: 100, offset: 0 } as const

describe('favoriting', () => {
  it('starts with nothing favorited', () => {
    expect(listMedia(all).items.every((item) => item.favoritedAt === null)).toBe(true)
    expect(libraryStats().favorites).toBe(0)
  })

  it('narrows the grid, the id list and the count to favorites', () => {
    expect(setFavorite([ids['a.jpg']!, ids['c.mp4']!], true)).toBe(2)

    const page = listMedia({ ...all, favorite: true })
    expect(page.total).toBe(2)
    expect(page.items.map((item) => item.name).sort()).toEqual(['a.jpg', 'c.mp4'])
    expect(listMediaIds({ favorite: true }).sort()).toEqual([ids['a.jpg'], ids['c.mp4']].sort())
    expect(libraryStats().favorites).toBe(2)

    // And still combines with the other filters.
    expect(listMedia({ ...all, favorite: true, kind: 'video' }).total).toBe(1)
  })

  it('does not reset the timestamp or count a second heart', () => {
    setFavorite([ids['a.jpg']!], true, 1000)
    expect(setFavorite([ids['a.jpg']!], true, 2000)).toBe(0)
    expect(getMedia(ids['a.jpg']!)?.favoritedAt).toBe(1000)
  })

  it('unfavorites, counting only what changed', () => {
    setFavorite([ids['a.jpg']!], true)
    expect(setFavorite([ids['a.jpg']!, ids['b.jpg']!], false)).toBe(1)
    expect(isFavorite(ids['a.jpg']!)).toBe(false)
  })

  it('survives a rescan, including one that finds the file changed', () => {
    setFavorite([ids['b.jpg']!], true)
    upsertMediaBatch(rootId, [entry('b.jpg', 99)], Date.now())
    expect(isFavorite(ids['b.jpg']!)).toBe(true)
  })

  it('survives the file being moved within the library', () => {
    setFavorite([ids['c.mp4']!], true)
    relocateMedia(ids['c.mp4']!, rootId, 'moved/c.mp4', 'c.mp4')
    expect(isFavorite(ids['c.mp4']!)).toBe(true)
  })
})
