/**
 * Favorites: one bit of filing per item, set by hand and never by the classifier.
 *
 * Stored as `media.favorited_at` rather than as a tag. A tag can be renamed,
 * merged, deleted wholesale, or recreated by an AI pass; a favorite is none of
 * those things, and folding it into the tag vocabulary would put it one "clear AI
 * labels" away from being lost.
 */

import { getDb } from './index'

/**
 * Favorites or unfavorites a batch of items. Resolves with how many actually
 * changed, so re-favoriting something keeps its original timestamp and is not
 * counted.
 */
export function setFavorite(mediaIds: number[], favorite: boolean, now = Date.now()): number {
  if (mediaIds.length === 0) return 0

  const db = getDb()
  const statement = favorite
    ? db.prepare('UPDATE media SET favorited_at = ? WHERE id = ? AND favorited_at IS NULL')
    : db.prepare('UPDATE media SET favorited_at = NULL WHERE id = ? AND favorited_at IS NOT NULL')

  const applyAll = db.transaction((ids: number[]) => {
    let changed = 0
    for (const id of ids) {
      changed += (favorite ? statement.run(now, id) : statement.run(id)).changes
    }
    return changed
  })

  return applyAll(mediaIds)
}

export function isFavorite(mediaId: number): boolean {
  const row = getDb()
    .prepare<[number], { favorite: number }>(
      'SELECT favorited_at IS NOT NULL AS favorite FROM media WHERE id = ?',
    )
    .get(mediaId)
  return row?.favorite === 1
}
