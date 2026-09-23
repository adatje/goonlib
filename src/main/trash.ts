/**
 * Undo and redo for moving files to the Trash.
 *
 * Deleting has only ever meant the system Trash, so a file is never gone — but
 * getting it back meant finding it in Finder, choosing Put Back, and rescanning.
 * This makes Cmd/Ctrl+Z do that instead.
 *
 * The hard part is knowing where a file went. Electron's trashItem says
 * nothing, and the Trash renames on a clash ("clip 2.mp4"). A rename within a
 * volume keeps the file's inode, so the file's device and inode are noted
 * before it is trashed and matched against the Trash afterwards — which finds
 * it whatever it was called. Where it cannot be found (Windows, whose Recycle
 * Bin works differently) the batch is still recorded, and undo says it could
 * not bring that file back rather than pretending.
 *
 * History lives in memory for the session. After a restart the files are
 * still in the Trash; they are simply back to being put back by hand.
 */

import { existsSync } from 'node:fs'
import { lstat, mkdir, readdir, rename } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { basename, dirname, join, parse } from 'node:path'
import { shell } from 'electron'
import type { TrashUndoResult } from '@shared/types'
import { markMissing, markPresent } from './db/media'

/** One file moved to the Trash, and where it landed if that could be found. */
interface Trashed {
  id: number
  original: string
  trashed: string | null
}

/** Batches kept to step back through. A batch is one Delete, however many files. */
const HISTORY_LIMIT = 30


class TrashHistory {
  private readonly undoStack: Trashed[][] = []
  private readonly redoStack: Trashed[][] = []

  /**
   * Trashes one file, notes where it went, and marks it missing. Throws if the
   * file could not be trashed at all, leaving it where it was.
   */
  async trash(id: number, path: string): Promise<Trashed> {
    let identity: { dev: number; ino: number } | null = null
    try {
      const stats = await lstat(path)
      identity = { dev: stats.dev, ino: stats.ino }
    } catch {
      // Still try to trash it; it just cannot be found again afterwards.
    }

    // Never unlink: this is recoverable by design.
    await shell.trashItem(path)
    markMissing(id)

    const trashed = identity ? await locate(path, identity) : null
    if (!trashed) console.log('[trash] could not find where this went:', path)
    return { id, original: path, trashed }
  }

  /** Records a finished Delete. Anything that had been undone can no longer be redone. */
  record(batch: Trashed[]): void {
    if (batch.length === 0) return
    this.undoStack.push(batch)
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift()
    this.redoStack.length = 0
  }

  /** Puts the last Delete back where it came from. */
  async undo(): Promise<TrashUndoResult> {
    const batch = this.undoStack.pop()
    if (!batch) return this.result(0, 0)

    let moved = 0
    let failed = 0
    const back: Trashed[] = []

    for (const entry of batch) {
      if (!entry.trashed || !existsSync(entry.trashed) || existsSync(entry.original)) {
        // Gone from the Trash (emptied, or put back by hand), or something now
        // stands where it used to be. Either way, not ours to overwrite.
        failed += 1
        continue
      }
      try {
        await mkdir(dirname(entry.original), { recursive: true })
        await rename(entry.trashed, entry.original)
        markPresent(entry.id)
        back.push(entry)
        moved += 1
      } catch (err) {
        console.error('[trash] could not put back', entry.original, err)
        failed += 1
      }
    }

    if (back.length > 0) this.redoStack.push(back)
    return this.result(moved, failed)
  }

  /** Trashes again what the last undo put back. */
  async redo(): Promise<TrashUndoResult> {
    const batch = this.redoStack.pop()
    if (!batch) return this.result(0, 0)

    let moved = 0
    let failed = 0
    const again: Trashed[] = []

    for (const entry of batch) {
      try {
        again.push(await this.trash(entry.id, entry.original))
        moved += 1
      } catch (err) {
        console.error('[trash] could not trash again', entry.original, err)
        failed += 1
      }
    }

    if (again.length > 0) this.undoStack.push(again)
    return this.result(moved, failed)
  }

  private result(moved: number, failed: number): TrashUndoResult {
    return {
      moved,
      failed,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    }
  }
}

/**
 * Finds a just-trashed file by its device and inode, in the Trash folders
 * that could have taken it. Only names that start the way the file's did are
 * looked at: the Trash renames on a clash by adding to the end, never the
 * start, and checking every entry of a large Trash would be slow.
 */
async function locate(
  original: string,
  identity: { dev: number; ino: number },
): Promise<string | null> {
  const stem = parse(basename(original)).name

  for (const dir of await trashDirs(original, identity.dev)) {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.startsWith(stem)) continue
      const path = join(dir, entry)
      try {
        const stats = await lstat(path)
        if (stats.dev === identity.dev && stats.ino === identity.ino) return path
      } catch {
        // Vanished between listing and looking; not the one.
      }
    }
  }
  return null
}

/**
 * Where the system puts trashed files: the home Trash, and for a file on
 * another volume, that volume's own Trash — macOS's .Trashes/<uid>, or the
 * freedesktop .Trash-<uid>/files on Linux.
 */
async function trashDirs(original: string, dev: number): Promise<string[]> {
  const home = homedir()
  const uid = userInfo().uid
  const dirs =
    process.platform === 'darwin'
      ? [join(home, '.Trash')]
      : [join(home, '.local', 'share', 'Trash', 'files')]

  const root = await mountRoot(original, dev)
  if (root) {
    dirs.push(
      process.platform === 'darwin'
        ? join(root, '.Trashes', String(uid))
        : join(root, `.Trash-${uid}`, 'files'),
    )
  }
  return dirs
}

/** The top of the volume a path is on: the highest folder still on the same device. */
async function mountRoot(path: string, dev: number): Promise<string | null> {
  let current = dirname(path)
  let root: string | null = null
  while (true) {
    try {
      if ((await lstat(current)).dev !== dev) break
    } catch {
      break
    }
    root = current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return root
}

export const trashHistory = new TrashHistory()
