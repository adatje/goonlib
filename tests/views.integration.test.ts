/**
 * The viewer's history against a real database: views are counted, time adds
 * up, and a runaway session cannot inflate it.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const workspace = await mkdtemp(join(tmpdir(), 'goonlib-views-'))

vi.mock('electron', () => ({
  app: { getPath: () => workspace },
}))

const { initDb, closeDb, getDb } = await import('../src/main/db')
const { addRoot } = await import('../src/main/db/queries')
const { upsertMediaBatch } = await import('../src/main/db/media')
const { recordView, viewsOf } = await import('../src/main/db/views')

let id: number

beforeAll(() => {
  initDb(join(workspace, 'test.db'))
  const rootId = addRoot(workspace).id
  upsertMediaBatch(
    rootId,
    [{ relPath: 'a.mp4', name: 'a.mp4', ext: '.mp4', kind: 'video', size: 100, mtime: 1 }],
    Date.now(),
  )
  id = (getDb().prepare('SELECT id FROM media').get() as { id: number }).id
})

afterAll(async () => {
  closeDb()
  await rm(workspace, { recursive: true, force: true })
})

describe('views', () => {
  it('starts at nothing', () => {
    expect(viewsOf(id)).toEqual({ viewCount: 0, watchMs: 0, lastViewedAt: null })
  })

  it('counts each view and adds up the time', () => {
    recordView(id, 5_000, 1000)
    recordView(id, 2_500, 2000)
    expect(viewsOf(id)).toEqual({ viewCount: 2, watchMs: 7_500, lastViewedAt: 2000 })
  })

  it('holds one view to a day, and ignores nonsense', () => {
    const before = viewsOf(id).watchMs
    recordView(id, 10 * 86_400_000)
    recordView(id, Number.NaN)
    expect(viewsOf(id).watchMs).toBe(before + 86_400_000)
  })

  it('does nothing for an item that is not there', () => {
    recordView(999_999, 1000)
    expect(viewsOf(999_999).viewCount).toBe(0)
  })
})
