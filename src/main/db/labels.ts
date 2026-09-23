/**
 * Labels, stored in the `tags` / `media_tags` tables that shipped unused in v1.
 *
 * A label carries its source, so a model's guess and the user's own filing live
 * side by side without either being able to overwrite the other: re-running
 * classification replaces every `ai` row for an item and leaves `manual` rows
 * untouched.
 */

import type { MediaAnnotations, MediaLabel } from '@shared/types'
import type { Classification } from '../ai/prompt'
import { getDb } from './index'
import { findOrCreateTag } from './tags'

/**
 * Replaces an item's AI labels with a fresh set, in one transaction so a crash
 * mid-write can't leave an item holding half of two different classifications.
 *
 * Only `ai` rows are touched. A tag the user applied by hand survives every
 * re-classification, including one that no longer suggests it.
 */
export function applyClassification(mediaId: number, result: Classification): void {
  const db = getDb()

  const clear = db.prepare("DELETE FROM media_tags WHERE media_id = ? AND source = 'ai'")
  // DO NOTHING, not DO UPDATE: the clear above already removed every `ai` row for
  // this item, so a surviving row for the same pair can only be a manual one —
  // and re-suggesting a tag the user already applied must not demote it back to
  // a guess that the next classification is free to retract.
  const insert = db.prepare(
    `INSERT INTO media_tags (media_id, tag_id, source, confidence)
     VALUES (?, ?, 'ai', ?)
     ON CONFLICT (media_id, tag_id) DO NOTHING`,
  )

  // Only written when the model actually produced one, so turning captions off
  // for a re-run leaves the descriptions you already paid for in place.
  const setCaption = db.prepare('UPDATE media SET caption = ? WHERE id = ?')

  const replace = db.transaction((entry: Classification) => {
    clear.run(mediaId)

    for (const label of entry.labels) {
      const name = label.label.trim()
      if (!name) continue
      insert.run(mediaId, findOrCreateTag(name), label.confidence)
    }

    if (entry.caption !== null) setCaption.run(entry.caption, mediaId)
  })

  replace(result)
}

/** One item's labels and caption; labels most confident first, manual on top. */
export function listAnnotations(mediaId: number): MediaAnnotations {
  const caption = getDb()
    .prepare<[number], { caption: string | null }>('SELECT caption FROM media WHERE id = ?')
    .get(mediaId)

  return { labels: listLabels(mediaId), caption: caption?.caption ?? null }
}

function listLabels(mediaId: number): MediaLabel[] {
  return getDb()
    .prepare<[number], { name: string; source: string; confidence: number | null }>(
      `SELECT t.name, mt.source, mt.confidence
         FROM media_tags mt
         JOIN tags t ON t.id = mt.tag_id
        WHERE mt.media_id = ?
        ORDER BY mt.source = 'ai', mt.confidence DESC NULLS LAST, t.name COLLATE NOCASE`,
    )
    .all(mediaId)
    .map((row) => ({
      label: row.name,
      source: row.source === 'ai' ? ('ai' as const) : ('manual' as const),
      confidence: row.source === 'ai' ? row.confidence : null,
    }))
}

/**
 * Queues items for the classify stage.
 *
 * `all` re-runs everything, including items that already carry labels — the
 * escape hatch for when the category list changed and the old answers are
 * against the wrong vocabulary. Otherwise only items that have never produced a
 * label are queued, which also picks up ones that previously errored.
 */
export function queueForClassification(all: boolean): number {
  const db = getDb()

  if (all) {
    return db.prepare("UPDATE media SET classify_state = 'pending' WHERE missing = 0").run().changes
  }

  return db
    .prepare(
      `UPDATE media SET classify_state = 'pending'
        WHERE missing = 0
          AND classify_state <> 'pending'
          AND NOT EXISTS (
            SELECT 1 FROM media_tags mt WHERE mt.media_id = media.id AND mt.source = 'ai'
          )`,
    )
    .run().changes
}
