/**
 * On-disk cache locations for derived artifacts (thumbnails, sprite sheets, and
 * later transcodes).
 *
 * Paths are sharded by the low bits of the media id so no single directory ends up
 * holding a hundred thousand entries, which some filesystems handle poorly.
 */

import { mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

function shard(id: number): string {
  return (id % 256).toString(16).padStart(2, '0')
}

/**
 * Deliberately not `userData/cache` — Chromium owns that directory for its own HTTP
 * cache, and anything that clears it would take our thumbnails with it.
 */
export function cacheRoot(): string {
  return join(app.getPath('userData'), 'derived')
}

export function thumbDir(): string {
  return join(cacheRoot(), 'thumbs')
}

export function spriteDir(): string {
  return join(cacheRoot(), 'sprites')
}

export function transcodeDir(): string {
  return join(cacheRoot(), 'transcodes')
}

/** Strength curves worked out from a video's audio, for audio-reactive toys. */
export function hapticsDir(): string {
  return join(cacheRoot(), 'haptics')
}

export function thumbPathFor(id: number): string {
  return join(thumbDir(), shard(id), `${id}.webp`)
}

export function spritePathFor(id: number): string {
  return join(spriteDir(), shard(id), `${id}.webp`)
}

/**
 * Where a remuxed or transcoded copy of an item lives.
 *
 * The source mtime is part of the filename so that re-encoding a file in place
 * produces a different path rather than silently serving the stale preparation.
 * The old one becomes unreferenced and is reclaimed by cache eviction.
 */
export function preparedPathFor(id: number, mtime: number): string {
  return join(transcodeDir(), shard(id), `${id}-${mtime}.mp4`)
}

/**
 * Where an item's audio envelope lives. Keyed on mtime for the same reason a
 * transcode is: a file replaced in place must not keep the old file's curve.
 * And on the shaping's version, so a better curve replaces an older one.
 */
export function envelopePathFor(id: number, mtime: number, version: number): string {
  return join(hapticsDir(), shard(id), `${id}-${mtime}-v${version}.json`)
}

/** Creates the parent directory for a cache artifact. */
export function ensureParent(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
}

/**
 * Removes the derived files for media that no longer exists.
 *
 * Cache eviction only bounds prepared media — thumbnails and sprite sheets are
 * assumed to track the size of the library. Once rows can be deleted that stops
 * being true, and without this every removed file would leave its thumbnail
 * behind permanently.
 */
export async function discardDerived(ids: number[]): Promise<void> {
  await Promise.all(
    ids.flatMap((id) => [
      rm(thumbPathFor(id), { force: true }).catch(() => undefined),
      rm(spritePathFor(id), { force: true }).catch(() => undefined),
    ]),
  )
}

export function ensureCacheDirs(): void {
  for (const dir of [thumbDir(), spriteDir(), transcodeDir()]) {
    mkdirSync(dir, { recursive: true })
  }
}
