/**
 * Fast recursive directory walk over a library root.
 *
 * This is stage 1 of the scan and the one the user actually feels — it's what makes
 * the library appear at all — so it does the minimum possible work per file: one
 * readdir per directory and one stat per media file, with the stats batched.
 *
 * Yields as it goes rather than collecting, so the indexer can start writing rows
 * while a large tree is still being walked.
 */

import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { MediaKind } from '@shared/types'
import { extensionOf, kindForExtension } from './extensions'
import { sniffFile } from './sniff'

export interface WalkEntry {
  /** Path relative to the root, always with forward slashes. */
  relPath: string
  name: string
  ext: string
  kind: MediaKind
  size: number
  mtime: number
}

export interface WalkOptions {
  signal?: AbortSignal
  /** Called for directories that can't be read. Walking continues past them. */
  onError?: (path: string, error: Error) => void
  /** How many stat() calls to issue at once. */
  statBatch?: number
}

export async function* walk(
  root: string,
  options: WalkOptions = {},
): AsyncGenerator<WalkEntry, void, undefined> {
  const { signal, onError, statBatch = 64 } = options
  const stack: string[] = [root]

  while (stack.length > 0) {
    if (signal?.aborted) return

    const dir = stack.pop()
    if (dir === undefined) break

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (err) {
      // An unreadable directory (permissions, a drive yanked mid-scan) should
      // never abort the whole scan.
      onError?.(dir, err as Error)
      continue
    }

    const files: string[] = []
    const unknown: string[] = []

    for (const entry of entries) {
      // Skip dotfiles and dot-directories: .DS_Store, .git, Synology/Dropbox
      // metadata, and so on. None of it is library content.
      if (entry.name.startsWith('.')) continue

      // Symlinks are skipped outright. Directory links can form cycles, and file
      // links would be refused by the protocol handler's confinement check at
      // playback time anyway — better to never index something we can't serve.
      if (entry.isSymbolicLink()) continue

      const full = join(dir, entry.name)

      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue

      // Files whose extension we recognise are taken at face value. Anything else
      // is set aside for a content check rather than dropped — browsers routinely
      // save media with no extension at all.
      if (kindForExtension(extensionOf(entry.name)) === null) {
        if (worthSniffing(entry.name)) unknown.push(full)
        continue
      }

      files.push(full)
    }

    for (let i = 0; i < files.length; i += statBatch) {
      if (signal?.aborted) return

      const batch = files.slice(i, i + statBatch)
      const stats = await Promise.all(
        batch.map(async (path) => {
          try {
            return { path, stats: await stat(path) }
          } catch {
            // Vanished between readdir and stat. Nothing to report; the next
            // scan will pick it up if it comes back.
            return null
          }
        }),
      )

      for (const result of stats) {
        if (!result) continue

        const name = result.path.slice(result.path.lastIndexOf(sep) + 1)
        const ext = extensionOf(name)
        const kind = kindForExtension(ext)
        if (!kind) continue

        yield {
          relPath: toPosix(relative(root, result.path)),
          name,
          ext,
          kind,
          size: result.stats.size,
          mtime: Math.floor(result.stats.mtimeMs),
        }
      }
    }

    // Unrecognised names, resolved by reading their first bytes. Done after the
    // named files so the bulk of the library still appears immediately.
    for (const path of unknown) {
      if (signal?.aborted) return

      const sniffed = await sniffFile(path)
      if (!sniffed) continue

      let stats
      try {
        stats = await stat(path)
      } catch {
        continue
      }

      const name = path.slice(path.lastIndexOf(sep) + 1)

      yield {
        relPath: toPosix(relative(root, path)),
        name,
        // The extension the content implies, so playback classification and
        // thumbnailing behave as if the file had been named properly.
        ext: sniffed.ext,
        kind: sniffed.kind,
        size: stats.size,
        mtime: Math.floor(stats.mtimeMs),
      }
    }
  }
}

/**
 * Whether a name with no usable extension is worth opening.
 *
 * Extensions that are definitely not media are excluded outright: a library of
 * saved web pages contains far more .js and .css than anything else, and opening
 * every one of them would make the walk needlessly slow.
 */
const NEVER_MEDIA = new Set([
  '.js', '.mjs', '.cjs', '.css', '.html', '.htm', '.json', '.xml', '.txt', '.md',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.ico', '.map', '.zip', '.gz',
  '.pdf', '.doc', '.docx', '.rtf', '.log', '.plist', '.db', '.sqlite',
])

export function worthSniffing(name: string): boolean {
  const ext = extensionOf(name)
  // No extension at all is the case this exists for.
  if (ext === '') return true
  return !NEVER_MEDIA.has(ext)
}

/** Store paths with forward slashes so a library survives moving between platforms. */
function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}
