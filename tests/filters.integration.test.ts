/**
 * The Filters panel's narrowing, against a real database: bands rather than
 * numbers, file types, and tags that must all be present.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const workspace = await mkdtemp(join(tmpdir(), 'goonlib-filters-'))

vi.mock('electron', () => ({ app: { getPath: () => workspace } }))

const { initDb, closeDb, getDb } = await import('../src/main/db')
const { addRoot } = await import('../src/main/db/queries')
const { listMedia, upsertMediaBatch, listExtensions, applyProbeResult } = await import('../src/main/db/media')
const { createTag, tagMedia } = await import('../src/main/db/tags')

const MB = 1024 * 1024
const ids: Record<string, number> = {}

beforeAll(() => {
  initDb(join(workspace, 'test.db'))
  const rootId = addRoot(workspace).id

  upsertMediaBatch(
    rootId,
    [
      { relPath: 'clip.mp4', name: 'clip.mp4', ext: '.mp4', kind: 'video', size: 40 * MB, mtime: 1 },
      { relPath: 'film.mkv', name: 'film.mkv', ext: '.mkv', kind: 'video', size: 3000 * MB, mtime: 1 },
      { relPath: 'shot.jpg', name: 'shot.jpg', ext: '.jpg', kind: 'image', size: 2 * MB, mtime: 1 },
    ],
    Date.now(),
  )

  for (const row of getDb().prepare('SELECT id, name FROM media').all() as Array<{ id: number; name: string }>) {
    ids[row.name] = row.id
  }

  // Lengths come from probing, not from the walker.
  applyProbeResult(ids['clip.mp4']!, { durationMs: 60_000, width: 1920, height: 1080 } as never)
  applyProbeResult(ids['film.mkv']!, { durationMs: 90 * 60_000, width: 1920, height: 1080 } as never)
})

afterAll(async () => {
  closeDb()
  await rm(workspace, { recursive: true, force: true })
})

const names = (query: Record<string, unknown>): string[] =>
  listMedia({ limit: 50, offset: 0, ...query }).items.map((item) => item.name).sort()

describe('filtering', () => {
  it('narrows by how long something is, leaving pictures out', () => {
    expect(names({ durations: ['short'] })).toEqual(['clip.mp4'])
    expect(names({ durations: ['long'] })).toEqual(['film.mkv'])
    expect(names({ durations: ['short', 'long'] })).toEqual(['clip.mp4', 'film.mkv'])
  })

  it('narrows by size', () => {
    expect(names({ sizes: ['small'] })).toEqual(['clip.mp4', 'shot.jpg'])
    expect(names({ sizes: ['large'] })).toEqual(['film.mkv'])
  })

  it('narrows by file type, and lists the types there are', () => {
    expect(names({ exts: ['.mkv'] })).toEqual(['film.mkv'])
    expect(names({ exts: ['.mkv', '.jpg'] })).toEqual(['film.mkv', 'shot.jpg'])
    expect(listExtensions().map((entry) => entry.ext).sort()).toEqual(['.jpg', '.mkv', '.mp4'])
  })

  it('wants every tag asked for, not any of them', () => {
    const blue = createTag('blue').id
    const loud = createTag('loud').id
    tagMedia(blue, [ids['clip.mp4']!, ids['film.mkv']!])
    tagMedia(loud, [ids['film.mkv']!])

    expect(names({ tagIds: [blue] })).toEqual(['clip.mp4', 'film.mkv'])
    expect(names({ tagIds: [blue, loud] })).toEqual(['film.mkv'])
  })

  it('stacks with everything else', () => {
    expect(names({ kind: 'video', sizes: ['small'], durations: ['short'] })).toEqual(['clip.mp4'])
  })
})
