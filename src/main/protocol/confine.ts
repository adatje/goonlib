/**
 * Path confinement for the media:// protocol.
 *
 * The renderer only ever names media by opaque row id, but the path we look up
 * still has to be proven safe before we stream it: a symlink planted inside a
 * library root could otherwise point anywhere on disk. Everything is resolved
 * through realpath first, so the check happens on the true target, not the link.
 *
 * Pure and electron-free so it can be tested directly.
 */

import { isAbsolute, join, relative, resolve } from 'node:path'
import { realpath } from 'node:fs/promises'

export interface ConfineDeps {
  /** Injectable for tests; defaults to fs.promises.realpath. */
  realpath: (path: string) => Promise<string>
}

const defaultDeps: ConfineDeps = { realpath }

/**
 * Resolves `relPath` inside `rootPath` and returns the real absolute path, or
 * `null` if it does not exist or escapes the root.
 */
export async function resolveWithinRoot(
  rootPath: string,
  relPath: string,
  deps: ConfineDeps = defaultDeps,
): Promise<string | null> {
  // Reject absolute or traversing relative paths before touching the filesystem.
  if (isAbsolute(relPath)) return null

  const candidate = resolve(join(rootPath, relPath))

  let realFile: string
  let realRoot: string
  try {
    ;[realFile, realRoot] = await Promise.all([deps.realpath(candidate), deps.realpath(rootPath)])
  } catch {
    // Missing file, broken symlink, or unreadable root — all indistinguishable
    // from the caller's point of view, and all mean "no".
    return null
  }

  const rel = relative(realRoot, realFile)

  // '' means the path *is* the root (a directory, not media). '..' means it
  // escaped. An absolute result means the two live on different volumes.
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null

  return realFile
}
