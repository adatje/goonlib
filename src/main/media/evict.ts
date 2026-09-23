/**
 * Keeps the prepared-media cache from growing without bound.
 *
 * Remuxes and transcodes are written to disk so that seeking works, which means a
 * library of HEVC files can quietly accumulate a second copy of everything. This
 * caps the directory and evicts least-recently-used entries.
 *
 * Recency comes from each file's mtime, which `touchPrepared` bumps whenever the
 * protocol handler serves one. atime would be the natural choice, but macOS mounts
 * volumes with relatime-like behaviour and the value can't be relied on.
 *
 * Only prepared media is evicted. Thumbnails and sprite sheets are small, are tied
 * to the size of the library rather than to usage, and deleting them would only
 * cause the next scan to rebuild them.
 */

import { readdir, rm, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'

export interface EvictionResult {
  removed: number
  freed: number
  remaining: number
}

/** Default ceiling for prepared media. */
export const DEFAULT_CACHE_CAP = 20 * 1024 * 1024 * 1024

interface Entry {
  path: string
  size: number
  mtimeMs: number
}

async function listEntries(dir: string): Promise<Entry[]> {
  const entries: Entry[] = []

  let shards: string[]
  try {
    shards = await readdir(dir)
  } catch {
    // No cache directory yet — nothing to evict.
    return entries
  }

  for (const shard of shards) {
    const shardPath = join(dir, shard)

    let names: string[]
    try {
      names = await readdir(shardPath)
    } catch {
      continue
    }

    for (const name of names) {
      const path = join(shardPath, name)
      try {
        const stats = await stat(path)
        if (stats.isFile()) entries.push({ path, size: stats.size, mtimeMs: stats.mtimeMs })
      } catch {
        // Vanished between listings; nothing to account for.
      }
    }
  }

  return entries
}

/** Total bytes currently held in a cache directory. */
export async function cacheSize(dir: string): Promise<number> {
  return (await listEntries(dir)).reduce((total, entry) => total + entry.size, 0)
}

/**
 * Deletes least-recently-used entries until the directory fits within `maxBytes`.
 */
export async function evictCache(dir: string, maxBytes: number): Promise<EvictionResult> {
  const entries = await listEntries(dir)
  let total = entries.reduce((sum, entry) => sum + entry.size, 0)

  if (total <= maxBytes) return { removed: 0, freed: 0, remaining: total }

  // Oldest first. Ties broken by path so the order is deterministic in tests.
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path))

  let removed = 0
  let freed = 0

  for (const entry of entries) {
    if (total <= maxBytes) break

    try {
      await rm(entry.path, { force: true })
      total -= entry.size
      freed += entry.size
      removed += 1
    } catch {
      // A file we can't delete shouldn't stop us reclaiming the rest.
    }
  }

  return { removed, freed, remaining: total }
}

/**
 * Marks a prepared file as just-used, so eviction treats it as recent.
 *
 * Failures are ignored: this is bookkeeping, and refusing to serve media because
 * a timestamp couldn't be updated would be a poor trade.
 */
export async function touchPrepared(path: string): Promise<void> {
  const now = new Date()
  await utimes(path, now, now).catch(() => undefined)
}
