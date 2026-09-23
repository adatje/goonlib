/**
 * Undoing a Delete: the file comes back from the Trash to where it was.
 *
 * The system Trash is stood in for by a folder under a temporary home, and
 * trashItem by a rename into it that adds " 2" to the name, the way the real
 * Trash does on a clash — which is the case finding a file by its inode rather
 * than its name exists for.
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const workspace = await mkdtemp(join(tmpdir(), 'goonlib-undo-'))
const home = join(workspace, 'home')
const trashDir = join(home, process.platform === 'darwin' ? '.Trash' : '.local/share/Trash/files')

vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>()
  return { ...actual, homedir: () => home }
})

vi.mock('electron', () => ({
  app: { getPath: () => workspace },
  shell: {
    trashItem: async (path: string): Promise<void> => {
      const ext = extname(path)
      await rename(path, join(trashDir, `${basename(path, ext)} 2${ext}`))
    },
  },
}))

const { initDb, closeDb, getDb } = await import('../src/main/db')
const { addRoot } = await import('../src/main/db/queries')
const { upsertMediaBatch } = await import('../src/main/db/media')
const { trashHistory } = await import('../src/main/trash')

const library = join(workspace, 'library')
const clip = join(library, 'clip.mp4')
let mediaId: number

const missing = (): number =>
  (getDb().prepare('SELECT missing FROM media WHERE id = ?').get(mediaId) as { missing: number })
    .missing

beforeAll(async () => {
  await mkdir(library, { recursive: true })
  await mkdir(trashDir, { recursive: true })
  await writeFile(clip, 'the original bytes')

  initDb(join(workspace, 'test.db'))
  const root = addRoot(library)
  upsertMediaBatch(
    root.id,
    [{ relPath: 'clip.mp4', name: 'clip.mp4', ext: '.mp4', kind: 'video', size: 18, mtime: 1 }],
    Date.now(),
  )
  mediaId = (getDb().prepare('SELECT id FROM media').get() as { id: number }).id
})

afterAll(async () => {
  closeDb()
  await rm(workspace, { recursive: true, force: true })
})

describe('undoing a Delete', () => {
  it('finds the file in the Trash even though it was renamed there', async () => {
    const entry = await trashHistory.trash(mediaId, clip)
    trashHistory.record([entry])
    expect(entry.trashed).toBe(join(trashDir, 'clip 2.mp4'))
    expect(existsSync(clip)).toBe(false)
    expect(missing()).toBe(1)
  })

  it('puts it back where it was, and back in the library', async () => {
    const result = await trashHistory.undo()
    expect(result).toEqual({ moved: 1, failed: 0, canUndo: false, canRedo: true })
    expect(await readFile(clip, 'utf8')).toBe('the original bytes')
    expect(missing()).toBe(0)
  })

  it('trashes it again on redo, and can undo that too', async () => {
    const result = await trashHistory.redo()
    expect(result).toMatchObject({ moved: 1, canUndo: true, canRedo: false })
    expect(existsSync(clip)).toBe(false)
    expect((await trashHistory.undo()).moved).toBe(1)
    expect(existsSync(clip)).toBe(true)
  })

  it('leaves a file alone once it has been emptied from the Trash', async () => {
    trashHistory.record([await trashHistory.trash(mediaId, clip)])
    await rm(join(trashDir, 'clip 2.mp4'))

    const result = await trashHistory.undo()
    expect(result).toMatchObject({ moved: 0, failed: 1 })
    expect(missing()).toBe(1)
  })

  it('has nothing to do when there is nothing to undo', async () => {
    expect(await trashHistory.undo()).toMatchObject({ moved: 0, failed: 0, canUndo: false })
  })
})
