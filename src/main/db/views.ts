/**
 * How often each item is opened in the viewer, how long for, and where a video
 * was left.
 *
 * The rules about a position are here rather than in the viewer, so every way
 * in agrees: a video watched to the end has no position to go back to, a
 * glance at the first few seconds is not worth resuming, and one left months
 * ago is not where you are any more.
 */

import type { MediaItem, MediaViews } from '@shared/types'
import { getDb } from './index'
import { MEDIA_COLUMNS_FOR_JOIN, toMediaItemRow } from './media'

/** Past this much of a video, it counts as watched: nothing is kept. */
const FINISHED_AT = 0.95

/** Under this, there is nothing worth carrying on from. */
const MIN_POSITION_MS = 30_000

/** A position older than this is stale, and ignored. */
const STALE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Counts one opening of an item, and the time it was on screen. The time is
 * held to a day, so a viewer left open overnight cannot run the total up.
 */
export function recordView(mediaId: number, watchedMs: number, now = Date.now()): void {
  const ms = Number.isFinite(watchedMs) ? Math.min(86_400_000, Math.max(0, Math.round(watchedMs))) : 0
  getDb()
    .prepare(
      `INSERT INTO media_views (media_id, view_count, watch_ms, last_viewed_at)
       SELECT id, 1, ?, ? FROM media WHERE id = ?
       ON CONFLICT (media_id) DO UPDATE SET
         view_count     = view_count + 1,
         watch_ms       = watch_ms + excluded.watch_ms,
         last_viewed_at = excluded.last_viewed_at`,
    )
    .run(ms, now, mediaId)
}

export function viewsOf(mediaId: number): MediaViews {
  const row = getDb()
    .prepare<
      [number],
      {
        view_count: number
        watch_ms: number
        last_viewed_at: number | null
        position_ms: number | null
      }
    >('SELECT view_count, watch_ms, last_viewed_at, position_ms FROM media_views WHERE media_id = ?')
    .get(mediaId)
  return {
    viewCount: row?.view_count ?? 0,
    watchMs: row?.watch_ms ?? 0,
    lastViewedAt: row?.last_viewed_at ?? null,
    positionMs: row?.position_ms ?? null,
  }
}

/**
 * Notes where a video was left. A position past the end-mark, or too near the
 * start, clears whatever was there rather than being written.
 */
export function recordPosition(
  mediaId: number,
  positionMs: number,
  durationMs: number,
  now = Date.now(),
): void {
  const position = Number.isFinite(positionMs) ? Math.max(0, Math.round(positionMs)) : 0
  const duration = Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0
  const finished = duration > 0 && position >= duration * FINISHED_AT
  const keep = position >= MIN_POSITION_MS && !finished

  getDb()
    .prepare(
      `INSERT INTO media_views (media_id, view_count, watch_ms, position_ms, position_at)
       SELECT id, 0, 0, ?, ? FROM media WHERE id = ?
       ON CONFLICT (media_id) DO UPDATE SET
         position_ms = excluded.position_ms,
         position_at = excluded.position_at`,
    )
    .run(keep ? position : null, keep ? now : null, mediaId)
}

/** Where to carry on from, or null: never left, finished, too early, or stale. */
export function positionOf(mediaId: number, now = Date.now()): number | null {
  const row = getDb()
    .prepare<[number], { position_ms: number | null; position_at: number | null }>(
      'SELECT position_ms, position_at FROM media_views WHERE media_id = ?',
    )
    .get(mediaId)

  if (!row?.position_ms || !row.position_at) return null
  if (now - row.position_at > STALE_MS) return null
  return row.position_ms
}

/** Videos left part-way through, the most recently left first. */
export function continueWatching(limit: number, now = Date.now()): MediaItem[] {
  const rows = getDb()
    .prepare<[number, number], never>(
      `SELECT ${MEDIA_COLUMNS_FOR_JOIN}
         FROM media_views v
         JOIN media m ON m.id = v.media_id
         JOIN roots r ON r.id = m.root_id
        WHERE v.position_ms IS NOT NULL
          AND v.position_at > ?
          AND m.missing = 0
          AND r.enabled = 1
        ORDER BY v.position_at DESC
        LIMIT ?`,
    )
    .all(now - STALE_MS, Math.min(100, Math.max(1, Math.floor(limit))))

  return rows.map(toMediaItemRow)
}

/** Forgets every count, time and position. */
export function clearHistory(): number {
  return getDb().prepare('DELETE FROM media_views').run().changes
}
