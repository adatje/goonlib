/**
 * Collections: manually curated, manually ordered sets of media.
 *
 * Order is stored as a REAL `position` rather than a contiguous integer index, so
 * moving one item rewrites exactly one row instead of renumbering everything after
 * it. Repeated moves into the same gap do eventually exhaust the precision of a
 * double, so a move that would land in too small a gap renormalises the whole
 * collection first — rare, cheap, and it keeps the common case a single UPDATE.
 */

import type { Collection } from '@shared/types'
import { getDb } from './index'

/** Below this gap between neighbours, fractional insertion stops being safe. */
const MIN_GAP = 1e-6

interface CollectionRow {
  id: number
  name: string
  cover_media_id: number | null
  created_at: number
  count: number
}

function toCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    name: row.name,
    coverMediaId: row.cover_media_id,
    createdAt: row.created_at,
    count: row.count,
  }
}

export function listCollections(): Collection[] {
  const rows = getDb()
    .prepare<[], CollectionRow>(
      `SELECT c.id, c.name, c.cover_media_id, c.created_at,
              COUNT(ci.media_id) AS count
         FROM collections c
         LEFT JOIN collection_items ci ON ci.collection_id = c.id
        GROUP BY c.id
        ORDER BY c.name COLLATE NOCASE`,
    )
    .all()

  return rows.map(toCollection)
}

export function getCollection(id: number): Collection | null {
  const row = getDb()
    .prepare<[number], CollectionRow>(
      `SELECT c.id, c.name, c.cover_media_id, c.created_at,
              COUNT(ci.media_id) AS count
         FROM collections c
         LEFT JOIN collection_items ci ON ci.collection_id = c.id
        WHERE c.id = ?
        GROUP BY c.id`,
    )
    .get(id)

  return row ? toCollection(row) : null
}

export function createCollection(name: string): Collection {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A collection needs a name')

  const info = getDb()
    .prepare('INSERT INTO collections (name, created_at) VALUES (?, ?)')
    .run(trimmed, Date.now())

  const created = getCollection(Number(info.lastInsertRowid))
  if (!created) throw new Error('Failed to read back the new collection')
  return created
}

/**
 * The collection with this name, creating it if there isn't one.
 *
 * Auto-sorting calls this once per label per item, so the match is deliberately
 * case-insensitive: 'Portraits' and 'portraits' must not end up as two
 * collections holding half the results each.
 */
export function findOrCreateCollection(name: string): Collection {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A collection needs a name')

  const existing = getDb()
    .prepare<[string], { id: number }>(
      'SELECT id FROM collections WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1',
    )
    .get(trimmed)

  if (existing) {
    const collection = getCollection(existing.id)
    if (collection) return collection
  }

  return createCollection(trimmed)
}

export function renameCollection(id: number, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A collection needs a name')
  getDb().prepare('UPDATE collections SET name = ? WHERE id = ?').run(trimmed, id)
}

export function deleteCollection(id: number): void {
  // ON DELETE CASCADE clears the membership rows. The media itself is untouched —
  // a collection is a view over the library, not a container for it.
  getDb().prepare('DELETE FROM collections WHERE id = ?').run(id)
}

/**
 * Appends media to the end of a collection. Items already present are left where
 * they are rather than jumping to the end.
 */
export function addToCollection(collectionId: number, mediaIds: number[]): number {
  if (mediaIds.length === 0) return 0

  const db = getDb()
  const nextPosition = db
    .prepare<[number], { next: number }>(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next FROM collection_items WHERE collection_id = ?',
    )
    .get(collectionId)

  let position = nextPosition?.next ?? 1

  const insert = db.prepare(
    `INSERT INTO collection_items (collection_id, media_id, position)
     VALUES (?, ?, ?)
     ON CONFLICT (collection_id, media_id) DO NOTHING`,
  )

  const addAll = db.transaction((ids: number[]) => {
    let added = 0
    for (const mediaId of ids) {
      const result = insert.run(collectionId, mediaId, position)
      if (result.changes > 0) {
        added += 1
        position += 1
      }
    }
    return added
  })

  return addAll(mediaIds)
}

/** The collections one item is in, by id. */
export function collectionsOf(mediaId: number): number[] {
  return getDb()
    .prepare<[number], { collection_id: number }>(
      'SELECT collection_id FROM collection_items WHERE media_id = ?',
    )
    .all(mediaId)
    .map((row) => row.collection_id)
}

export function removeFromCollection(collectionId: number, mediaIds: number[]): void {
  if (mediaIds.length === 0) return

  const db = getDb()
  const remove = db.prepare(
    'DELETE FROM collection_items WHERE collection_id = ? AND media_id = ?',
  )

  const removeAll = db.transaction((ids: number[]) => {
    for (const mediaId of ids) remove.run(collectionId, mediaId)
  })

  removeAll(mediaIds)
}

export function setCollectionCover(collectionId: number, mediaId: number | null): void {
  getDb()
    .prepare('UPDATE collections SET cover_media_id = ? WHERE id = ?')
    .run(mediaId, collectionId)
}

/**
 * Moves an item to `toIndex` in the collection's current order.
 *
 * The new position is the midpoint of its target neighbours, so only the moved row
 * changes. If that midpoint would be indistinguishable from its neighbours in
 * floating point, positions are rewritten as 1..n first and the move retried.
 */
export function moveInCollection(collectionId: number, mediaId: number, toIndex: number): void {
  const db = getDb()

  const move = db.transaction(() => {
    const order = orderedMediaIds(collectionId)
    const from = order.findIndex((entry) => entry.mediaId === mediaId)
    if (from === -1) throw new Error('That item is not in this collection')

    // Work against the list with the item lifted out, so an index means the same
    // thing whether the item moves forwards or backwards.
    const without = order.filter((entry) => entry.mediaId !== mediaId)
    const target = Math.min(without.length, Math.max(0, Math.floor(toIndex)))

    const before = target > 0 ? without[target - 1] : undefined
    const after = target < without.length ? without[target] : undefined

    const position = midpoint(before?.position, after?.position)

    if (position === null) {
      renormalise(collectionId)
      const renumbered = orderedMediaIds(collectionId).filter((e) => e.mediaId !== mediaId)
      const newBefore = target > 0 ? renumbered[target - 1] : undefined
      const newAfter = target < renumbered.length ? renumbered[target] : undefined
      const retry = midpoint(newBefore?.position, newAfter?.position)
      if (retry === null) throw new Error('Could not find a position for that item')

      db.prepare(
        'UPDATE collection_items SET position = ? WHERE collection_id = ? AND media_id = ?',
      ).run(retry, collectionId, mediaId)
      return
    }

    db.prepare(
      'UPDATE collection_items SET position = ? WHERE collection_id = ? AND media_id = ?',
    ).run(position, collectionId, mediaId)
  })

  move()
}

interface OrderEntry {
  mediaId: number
  position: number
}

function orderedMediaIds(collectionId: number): OrderEntry[] {
  return getDb()
    .prepare<[number], { media_id: number; position: number }>(
      'SELECT media_id, position FROM collection_items WHERE collection_id = ? ORDER BY position, media_id',
    )
    .all(collectionId)
    .map((row) => ({ mediaId: row.media_id, position: row.position }))
}

/** Midpoint between two positions, or null when the gap is too small to split. */
export function midpoint(before: number | undefined, after: number | undefined): number | null {
  if (before === undefined && after === undefined) return 1
  if (before === undefined && after !== undefined) return after - 1
  if (before !== undefined && after === undefined) return before + 1

  const low = before as number
  const high = after as number
  if (high - low < MIN_GAP) return null

  return low + (high - low) / 2
}

/** Rewrites positions as 1..n, restoring room to insert between any two items. */
function renormalise(collectionId: number): void {
  const db = getDb()
  const update = db.prepare(
    'UPDATE collection_items SET position = ? WHERE collection_id = ? AND media_id = ?',
  )

  orderedMediaIds(collectionId).forEach((entry, index) => {
    update.run(index + 1, collectionId, entry.mediaId)
  })
}
