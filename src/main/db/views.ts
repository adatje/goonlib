/**
 * How often each item is opened in the viewer, and for how long in all.
 */

import type { MediaViews } from '@shared/types'
import { getDb } from './index'

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
    .prepare<[number], { view_count: number; watch_ms: number; last_viewed_at: number | null }>(
      'SELECT view_count, watch_ms, last_viewed_at FROM media_views WHERE media_id = ?',
    )
    .get(mediaId)
  return {
    viewCount: row?.view_count ?? 0,
    watchMs: row?.watch_ms ?? 0,
    lastViewedAt: row?.last_viewed_at ?? null,
  }
}
