/**
 * Making, emptying and removing folders inside a library source.
 *
 * Folders in GoonLib are a view over the `rel_path` on each item rather than a
 * table, so these are the only operations that touch real directories. They are
 * kept together because they share one rule: nothing is ever overwritten, and
 * nothing leaves the library without the user being told.
 *
 * Moving is deliberately flat. Everything beneath the folder lands together in
 * the target and the subfolders stay where they are - emptied, not moved - which
 * is what "move the contents of this into that" means when the point is sorting.
 */

import { mkdir, readdir, rename, rmdir } from 'node:fs/promises'
import { shell } from 'electron'
import { dirname, join } from 'node:path'
import type { FolderActionResult } from '@shared/types'
import { getDb } from './db/index'
import { escapeLike } from './db/folders'
import { markMissing } from './db/media'
import { getMediaLocation, listRoots, removeRoot } from './db/queries'
import { resolveWithinRoot } from './protocol/confine'
import { containingRoot, uniqueName } from './relocate'
import { trashHistory } from './trash'

/** One item under a folder, with the absolute path it lives at. */
interface Beneath {
  id: number
  relPath: string
  path: string
}

const EMPTY: FolderActionResult = { ok: false, moved: 0, renamed: 0, failed: 0, dropped: 0, message: null }

/** The absolute directory a (rootId, relative path) pair names, or null. */
async function resolveDir(rootId: number, relPath: string): Promise<string | null> {
  const root = listRoots().find((entry) => entry.id === rootId)
  if (!root) return null
  // '' is the root itself, which resolveWithinRoot handles as an empty segment.
  return relPath === '' ? root.path : resolveWithinRoot(root.path, relPath)
}

/**
 * Every item anywhere beneath a folder, deepest paths included.
 *
 * Missing rows are skipped: they name a file that is not there, and moving one
 * would only fail. Their rows keep pointing at the old place, which the next
 * scan tidies up.
 */
async function itemsBeneath(rootId: number, prefix: string): Promise<Beneath[]> {
  const rows = getDb()
    .prepare(
      `SELECT m.id AS id, m.rel_path AS relPath, r.path AS rootPath
         FROM media m
         JOIN roots r ON r.id = m.root_id
        WHERE m.root_id = ? AND m.missing = 0 AND m.rel_path LIKE ? ESCAPE '\\'
        ORDER BY m.rel_path`,
    )
    .all(rootId, `${escapeLike(prefix)}%`) as Array<{ id: number; relPath: string; rootPath: string }>

  const found: Beneath[] = []
  for (const row of rows) {
    const path = await resolveWithinRoot(row.rootPath, row.relPath)
    if (path) found.push({ id: row.id, relPath: row.relPath, path })
  }
  return found
}

/** Makes a folder inside another one. The name is a single segment, never a path. */
export async function createFolder(
  rootId: number,
  parentRelPath: string,
  name: string,
): Promise<FolderActionResult> {
  const clean = name.trim().replace(/[/\\]/g, '')
  if (!clean || clean === '.' || clean === '..') {
    return { ...EMPTY, message: 'That is not a name a folder can have.' }
  }

  const parent = await resolveDir(rootId, parentRelPath)
  if (!parent) return { ...EMPTY, message: 'That folder is not there any more.' }

  try {
    // Never recursive, and never over something: mkdir without `recursive`
    // fails when the name is taken, which is the answer we want.
    await mkdir(join(parent, clean))
    return { ...EMPTY, ok: true }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EEXIST') return { ...EMPTY, message: `"${clean}" is already there.` }
    return { ...EMPTY, message: err instanceof Error ? err.message : String(err) }
  }
}

/** How many items are beneath a folder, for the confirmation before deleting it. */
export async function countBeneath(rootId: number, relPath: string): Promise<number> {
  return (await itemsBeneath(rootId, relPath)).length
}

/**
 * Sends a folder and everything under it to the Trash.
 *
 * The files go one at a time through the trash history, so one Ctrl+Z puts the
 * whole folder back - undo recreates the directories on its way. The emptied
 * directories are then removed deepest-first; any that still hold something the
 * library does not know about are left alone rather than taken with it.
 */
export async function deleteFolder(rootId: number, relPath: string): Promise<FolderActionResult> {
  const dir = await resolveDir(rootId, relPath)
  if (!dir) return { ...EMPTY, message: 'That folder is not there any more.' }

  const items = await itemsBeneath(rootId, relPath)
  const result: FolderActionResult = { ...EMPTY, ok: true }

  /*
   * A source's own folder goes in one piece, and does not join the undo
   * history. Removing the root takes its media rows with it, so the history
   * would be holding ids that no longer name anything and undo could put
   * nothing back - which is exactly what happened the first time. The folder
   * still sits in the Trash to be recovered by hand; it simply is not a Ctrl+Z.
   */
  if (relPath === '') {
    try {
      await shell.trashItem(dir)
    } catch (err) {
      return { ...EMPTY, message: err instanceof Error ? err.message : String(err) }
    }
    removeRoot(rootId)
    return { ...result, moved: items.length }
  }

  const trashed = []
  for (const item of items) {
    try {
      trashed.push(await trashHistory.trash(item.id, item.path))
      result.moved += 1
    } catch (err) {
      console.error('[folders] could not trash', item.path, err)
      result.failed += 1
    }
  }
  // One batch, so one undo brings the folder back whole.
  if (trashed.length > 0) trashHistory.record(trashed)

  await removeEmptied(dir)
  return result
}

/** Removes a directory tree, deepest first, stopping at anything not empty. */
async function removeEmptied(dir: string): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }

  for (const entry of entries) {
    // Only directories are followed; a stray file keeps its folder alive.
    await removeEmptied(join(dir, entry)).catch(() => undefined)
  }

  try {
    await rmdir(dir)
  } catch {
    // Still holds something that is not ours. Leaving it is the safe answer.
  }
}

/**
 * Moves every item beneath one folder into another, flat.
 *
 * The subfolders are left behind, emptied. Names are made unique at the
 * destination as the batch lands, so two files from different subfolders that
 * share a name cannot overwrite one another. An item landing outside every
 * source is dropped from the library, which is the one outcome worth counting
 * separately.
 */
export async function moveFolderContents(
  rootId: number,
  relPath: string,
  targetRootId: number,
  targetRelPath: string,
): Promise<FolderActionResult> {
  const items = await itemsBeneath(rootId, relPath)
  if (items.length === 0) return { ...EMPTY, ok: true, message: 'Nothing in there to move.' }
  return moveInto(items, targetRootId, targetRelPath)
}

/** The same move, for a set of items picked by hand rather than a whole folder. */
export async function moveMediaTo(
  mediaIds: number[],
  targetRootId: number,
  targetRelPath: string,
): Promise<FolderActionResult> {
  const items: Beneath[] = []
  for (const id of mediaIds) {
    const location = getMediaLocation(id)
    if (!location) continue
    const path = await resolveWithinRoot(location.rootPath, location.relPath)
    if (path) items.push({ id, relPath: location.relPath, path })
  }
  if (items.length === 0) return { ...EMPTY, ok: true, message: 'Nothing to move.' }
  return moveInto(items, targetRootId, targetRelPath)
}

async function moveInto(
  items: Beneath[],
  targetRootId: number,
  targetRelPath: string,
): Promise<FolderActionResult> {
  const target = await resolveDir(targetRootId, targetRelPath)
  if (!target) return { ...EMPTY, message: 'That folder is not there any more.' }

  const roots = listRoots()
  const landing = containingRoot(roots, target)

  let taken: Set<string>
  try {
    taken = new Set(await readdir(target))
  } catch (err) {
    return { ...EMPTY, message: err instanceof Error ? err.message : String(err) }
  }

  const db = getDb()
  const rehome = db.prepare('UPDATE media SET root_id = ?, rel_path = ?, name = ? WHERE id = ?')
  const result: FolderActionResult = { ...EMPTY, ok: true }

  for (const item of items) {
    if (dirname(item.path) === target) continue

    const current = item.relPath.split('/').pop() ?? item.relPath
    const name = uniqueName(taken, current)
    try {
      await rename(item.path, join(target, name))
    } catch (err) {
      console.error('[folders] could not move', item.path, err)
      result.failed += 1
      continue
    }
    taken.add(name)
    if (name !== current) result.renamed += 1

    if (landing) {
      const rel = landing.relDir === '' ? name : `${landing.relDir}/${name}`
      rehome.run(landing.root.id, rel, name, item.id)
      result.moved += 1
    } else {
      // Outside every source now, so it is no longer in the library.
      markMissing(item.id)
      result.dropped += 1
    }
  }

  return result
}
