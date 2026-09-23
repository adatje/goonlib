/**
 * Moving a file, and working out where it lands.
 *
 * Kept free of electron and the database so all of it can be tested directly —
 * which matters more here than anywhere else in the app, because this is the
 * one place that relocates a user's actual files. The decisions worth proving:
 * which library root (if any) now owns a file, what to call it when that name
 * is already taken at the destination, and that nothing is ever overwritten.
 */

import { access, copyFile, rename, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'

export interface RootLike {
  id: number
  path: string
}

export interface Landing<T extends RootLike> {
  root: T
  /** Path of the destination directory relative to the root; '' is the root itself. */
  relDir: string
}

/**
 * The library root that contains `absDir`, or null when it sits outside all of
 * them.
 *
 * The most specific root wins: roots are allowed to nest, and a file dropped in
 * the inner one belongs to the inner one — the outer root would give it a
 * rel_path that the inner root's own scan would later claim as a second row.
 *
 * Disabled roots count. The file really is inside that tree, and pretending
 * otherwise would drop a row that the next scan of that root would recreate.
 */
export function containingRoot<T extends RootLike>(roots: readonly T[], absDir: string): Landing<T> | null {
  let best: Landing<T> | null = null

  for (const root of roots) {
    const relDir = relative(root.path, absDir)

    // Outside the root entirely, or reached only by climbing out of it.
    if (relDir.startsWith('..') || isAbsolute(relDir)) continue

    if (best === null || root.path.length > best.root.path.length) {
      best = { root, relDir }
    }
  }

  return best
}

/**
 * A filename that doesn't collide, suffixing " (2)", " (3)" and so on.
 *
 * `taken` is a directory listing exactly as it comes, and is compared
 * case-insensitively because the default macOS filesystem is: "Clip.webm" and
 * "clip.webm" are one file, and a case-sensitive check would hand back a name
 * that overwrites something on the way in. Normalising here rather than asking
 * the caller to do it means forgetting is not a way to lose a file.
 */
export function uniqueName(taken: Iterable<string>, fileName: string): string {
  const lower = new Set<string>()
  for (const name of taken) lower.add(name.toLowerCase())

  if (!lower.has(fileName.toLowerCase())) return fileName

  // A leading dot is part of the name, not an extension separator, so
  // '.hidden' keeps its whole name and gains the suffix at the end.
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''

  for (let n = 2; ; n += 1) {
    const candidate = `${stem} (${n})${ext}`
    if (!lower.has(candidate.toLowerCase())) return candidate
  }
}

/** Where a file ends up inside its root, as stored in `media.rel_path`. */
export function relPathFor(relDir: string, fileName: string): string {
  return relDir === '' ? fileName : join(relDir, fileName)
}

/**
 * Moves one file, refusing to overwrite anything.
 *
 * Two things make this more than a rename call. rename(2) replaces an existing
 * destination without a word, so the target is checked first — the name came
 * from a directory listing taken moments earlier, and this catches anything
 * that appeared in between. And rename(2) cannot cross a filesystem: dragging
 * clips off an external drive fails with EXDEV, which is an ordinary thing to
 * ask for here, so that case falls back to a copy and delete. COPYFILE_EXCL
 * keeps the no-overwrite promise on that path too, and the original is only
 * unlinked once the copy has landed.
 */
export async function moveFile(from: string, to: string): Promise<void> {
  if (await exists(to)) throw new Error(`${to} already exists`)

  try {
    await rename(from, to)
    return
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
  }

  await copyFile(from, to, constants.COPYFILE_EXCL)
  await unlink(from)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
