/**
 * The Shuffle sort against a real database: a seed gives one order and keeps
 * it, page after page, and the id list "select all" uses matches it.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const workspace = await mkdtemp(join(tmpdir(), 'goonlib-shuffle-sort-'))

vi.mock('electron', () => ({
  app: { getPath: () => workspace },
}))

const { initDb, closeDb } = await import('../src/main/db')
const { addRoot } = await import('../src/main/db/queries')
const { listMedia, listMediaIds, upsertMediaBatch } = await import('../src/main/db/media')

const COUNT = 60

beforeAll(() => {
  initDb(join(workspace, 'test.db'))
  const rootId = addRoot(workspace).id
  upsertMediaBatch(
    rootId,
    Array.from({ length: COUNT }, (_, i) => ({
      relPath: `${String(i).padStart(3, '0')}.jpg`,
      name: `${String(i).padStart(3, '0')}.jpg`,
      ext: '.jpg',
      kind: 'image' as const,
      size: 100,
      mtime: 1,
    })),
    Date.now(),
  )
})

afterAll(async () => {
  closeDb()
  await rm(workspace, { recursive: true, force: true })
})

const names = (seed: number, offset = 0, limit = COUNT): string[] =>
  listMedia({ sort: 'shuffle', seed, limit, offset }).items.map((item) => item.name)

describe('the shuffle sort', () => {
  it('keeps every item, in an order that is not the one they were added in', () => {
    const shuffled = names(12345)
    expect([...shuffled].sort()).toEqual(names(1).sort())
    expect(shuffled).not.toEqual([...shuffled].sort())
  })

  it('gives the same order for the same seed, so pages line up', () => {
    const whole = names(777)
    expect([...names(777, 0, 20), ...names(777, 20, 20), ...names(777, 40, 20)]).toEqual(whole)
    const ids = listMediaIds({ sort: 'shuffle', seed: 777 })
    expect(ids).toEqual(listMedia({ sort: 'shuffle', seed: 777, limit: COUNT, offset: 0 }).items.map((i) => i.id))
  })

  it('reshuffles with a new seed', () => {
    expect(names(1)).not.toEqual(names(2))
  })
})
