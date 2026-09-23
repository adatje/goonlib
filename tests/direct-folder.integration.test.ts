/**
 * Non-recursive folder listing.
 *
 * Browsing a library is a file-browser gesture: opening a folder should show
 * that folder's own files, with its subfolders listed as folders rather than
 * their contents flattened in alongside them.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const workspace = await mkdtemp(join(tmpdir(), 'goonlib-folders-'))

vi.mock('electron', () => ({
  app: { getPath: () => workspace, getVersion: () => '0.6.0' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}))

const { initDb, closeDb } = await import('../src/main/db')
const { addRoot } = await import('../src/main/db/queries')
const { listMedia, upsertMediaBatch } = await import('../src/main/db/media')
const { listChildFolders } = await import('../src/main/db/folders')

const FILES = [
  'top.mp4',
  'also-top.jpg',
  'holiday/plane.mp4',
  'holiday/beach.jpg',
  'holiday/day1/sunrise.mp4',
  'holiday/day1/dinner.mp4',
  'clips/one.mp4',
]

let rootId: number

beforeAll(() => {
  initDb(join(workspace, 'test.db'))
  rootId = addRoot(join(workspace, 'library')).id

  upsertMediaBatch(
    rootId,
    FILES.map((relPath) => ({
      relPath,
      name: relPath.split('/').pop() as string,
      ext: relPath.endsWith('.mp4') ? '.mp4' : '.jpg',
      kind: relPath.endsWith('.mp4') ? ('video' as const) : ('image' as const),
      size: 1_000,
      mtime: 1,
    })),
    Date.now(),
  )
})

afterAll(async () => {
  closeDb()
  await rm(workspace, { recursive: true, force: true })
})

function paths(query: Parameters<typeof listMedia>[0]): string[] {
  return listMedia(query).items.map((item) => item.relPath).sort()
}

describe('one folder at a time', () => {
  it('returns only the items sitting directly in the folder', () => {
    expect(paths({ rootId, pathPrefix: 'holiday/', directOnly: true, limit: 50, offset: 0 })).toEqual(
      ['holiday/beach.jpg', 'holiday/plane.mp4'],
    )
  })

  it('gives a root its own top-level files, not its whole tree', () => {
    expect(paths({ rootId, directOnly: true, limit: 50, offset: 0 })).toEqual([
      'also-top.jpg',
      'top.mp4',
    ])
  })

  it('reports a total matching what it returns, so paging is not wrong', () => {
    const page = listMedia({ rootId, pathPrefix: 'holiday/', directOnly: true, limit: 50, offset: 0 })
    expect(page.total).toBe(2)
  })

  it('still walks the whole tree when not asked to narrow', () => {
    expect(paths({ rootId, pathPrefix: 'holiday/', limit: 50, offset: 0 })).toEqual([
      'holiday/beach.jpg',
      'holiday/day1/dinner.mp4',
      'holiday/day1/sunrise.mp4',
      'holiday/plane.mp4',
    ])
  })

  it('leaves the deepest folder the same either way, having no subfolders', () => {
    const recursive = paths({ rootId, pathPrefix: 'holiday/day1/', limit: 50, offset: 0 })
    const direct = paths({ rootId, pathPrefix: 'holiday/day1/', directOnly: true, limit: 50, offset: 0 })
    expect(direct).toEqual(recursive)
  })
})

describe('the folders listed alongside them', () => {
  it('counts subfolders recursively, which is what selecting one would show', () => {
    const children = listChildFolders(rootId, '')
    expect(children.map((folder) => `${folder.name}:${folder.count}`).sort()).toEqual([
      'clips:1',
      'holiday:4',
    ])
  })

  it('marks a folder that has subfolders of its own', () => {
    expect(listChildFolders(rootId, '').find((f) => f.name === 'holiday')?.hasChildren).toBe(true)
    expect(listChildFolders(rootId, '').find((f) => f.name === 'clips')?.hasChildren).toBe(false)
  })
})
