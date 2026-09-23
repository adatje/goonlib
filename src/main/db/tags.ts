/**
 * Tags: a flat vocabulary over the library, shared by the user and the
 * classifier.
 *
 * They are deliberately not two separate systems. A label the model produced and
 * a tag typed by hand are the same row in `media_tags`, distinguished only by
 * `source` — which means renaming a tag fixes it everywhere, and a tag can be
 * half AI-suggested and half hand-curated without anything special happening.
 */

import type { Tag } from '@shared/types'
import { getDb } from './index'

interface TagRow {
  id: number
  name: string
  count: number
  ai_count: number
}

function toTag(row: TagRow): Tag {
  return { id: row.id, name: row.name, count: row.count, aiCount: row.ai_count }
}

const TAG_SELECT = `
  SELECT t.id, t.name,
         COUNT(mt.media_id) AS count,
         COALESCE(SUM(mt.source = 'ai'), 0) AS ai_count
    FROM tags t
    LEFT JOIN media_tags mt ON mt.tag_id = t.id
`

export function listTags(): Tag[] {
  return getDb()
    .prepare<[], TagRow>(`${TAG_SELECT} GROUP BY t.id ORDER BY t.name COLLATE NOCASE`)
    .all()
    .map(toTag)
}

export function getTag(id: number): Tag | null {
  const row = getDb()
    .prepare<[number], TagRow>(`${TAG_SELECT} WHERE t.id = ? GROUP BY t.id`)
    .get(id)
  return row ? toTag(row) : null
}

/**
 * The tag row for a name, creating it if there isn't one.
 *
 * `tags.name` is UNIQUE COLLATE NOCASE, so the lookup has to use the same
 * collation or a differently-cased name would fall through to an INSERT that
 * then fails on the constraint.
 */
export function findOrCreateTag(name: string): number {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A tag needs a name')

  const db = getDb()
  const existing = db
    .prepare<[string], { id: number }>('SELECT id FROM tags WHERE name = ? COLLATE NOCASE')
    .get(trimmed)
  if (existing) return existing.id

  return Number(db.prepare('INSERT INTO tags (name) VALUES (?)').run(trimmed).lastInsertRowid)
}

export function createTag(name: string): Tag {
  const created = getTag(findOrCreateTag(name))
  if (!created) throw new Error('Failed to read back the new tag')
  return created
}

/**
 * Renames a tag, merging into an existing one if the new name is already taken.
 *
 * Merging rather than erroring is the point: the common reason to rename a tag
 * is to fix a typo the classifier or a stray keystroke introduced, and the
 * useful outcome there is one tag, not a complaint that both exist.
 */
export function renameTag(id: number, name: string): Tag {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A tag needs a name')

  const db = getDb()

  const merge = db.transaction((): number => {
    const clash = db
      .prepare<[string, number], { id: number }>(
        'SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id <> ?',
      )
      .get(trimmed, id)

    if (!clash) {
      db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(trimmed, id)
      return id
    }

    // Move the assignments across, skipping any item that already carries the
    // surviving tag, then drop the now-empty one.
    db.prepare(
      `UPDATE OR IGNORE media_tags SET tag_id = ? WHERE tag_id = ?`,
    ).run(clash.id, id)
    db.prepare('DELETE FROM tags WHERE id = ?').run(id)

    return clash.id
  })

  const survivor = getTag(merge())
  if (!survivor) throw new Error('Failed to read back the renamed tag')
  return survivor
}

/** Drops a tag. `media_tags` cascades, so every assignment goes with it. */
export function deleteTag(id: number): void {
  getDb().prepare('DELETE FROM tags WHERE id = ?').run(id)
}

/**
 * Attaches a tag to items as the user's own.
 *
 * An AI row for the same pair is promoted to `manual` rather than left alone —
 * confirming the model's guess by hand should mean the next classification
 * can't quietly retract it.
 */
/**
 * Just the tag ids on one item.
 *
 * Deliberately lighter than `listAnnotations`, which also fetches the caption —
 * the context menu builds on every right-click and only needs to know which
 * boxes to tick.
 */
export function tagIdsFor(mediaId: number): number[] {
  return getDb()
    .prepare<[number], { tag_id: number }>('SELECT tag_id FROM media_tags WHERE media_id = ?')
    .all(mediaId)
    .map((row) => row.tag_id)
}

export function tagMedia(tagId: number, mediaIds: number[]): number {
  if (mediaIds.length === 0) return 0

  const db = getDb()
  const insert = db.prepare(
    `INSERT INTO media_tags (media_id, tag_id, source, confidence)
     VALUES (?, ?, 'manual', NULL)
     ON CONFLICT (media_id, tag_id) DO UPDATE SET source = 'manual', confidence = NULL`,
  )

  const attach = db.transaction((ids: number[]) => {
    let changed = 0
    for (const mediaId of ids) changed += insert.run(mediaId, tagId).changes
    return changed
  })

  return attach(mediaIds)
}

export function untagMedia(tagId: number, mediaIds: number[]): void {
  if (mediaIds.length === 0) return

  const db = getDb()
  const remove = db.prepare('DELETE FROM media_tags WHERE tag_id = ? AND media_id = ?')

  const detach = db.transaction((ids: number[]) => {
    for (const mediaId of ids) remove.run(tagId, mediaId)
  })

  detach(mediaIds)
}
