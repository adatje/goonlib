import type { LibraryStats, MediaKind, PlaybackTier, Root } from '@shared/types'
import { getDb } from './index'

interface RootRow {
  id: number
  path: string
  enabled: number
  added_at: number
}

function toRoot(row: RootRow): Root {
  return {
    id: row.id,
    path: row.path,
    enabled: row.enabled === 1,
    addedAt: row.added_at,
  }
}

export function listRoots(): Root[] {
  const rows = getDb()
    .prepare<[], RootRow>('SELECT id, path, enabled, added_at FROM roots ORDER BY added_at')
    .all()
  return rows.map(toRoot)
}

export function getRoot(id: number): Root | null {
  const row = getDb()
    .prepare<[number], RootRow>('SELECT id, path, enabled, added_at FROM roots WHERE id = ?')
    .get(id)
  return row ? toRoot(row) : null
}

/**
 * Registers a folder as a library root. Adding a path that is already registered
 * returns the existing row rather than erroring — re-picking the same folder in
 * the dialog should be a no-op, not a failure.
 */
export function addRoot(path: string): Root {
  const db = getDb()
  const existing = db
    .prepare<[string], RootRow>('SELECT id, path, enabled, added_at FROM roots WHERE path = ?')
    .get(path)
  if (existing) return toRoot(existing)

  const info = db
    .prepare('INSERT INTO roots (path, enabled, added_at) VALUES (?, 1, ?)')
    .run(path, Date.now())

  const row = db
    .prepare<[number], RootRow>('SELECT id, path, enabled, added_at FROM roots WHERE id = ?')
    .get(Number(info.lastInsertRowid))
  if (!row) throw new Error(`Failed to read back newly inserted root for ${path}`)
  return toRoot(row)
}

export function removeRoot(id: number): void {
  // ON DELETE CASCADE clears the media rows; the files themselves are untouched.
  getDb().prepare('DELETE FROM roots WHERE id = ?').run(id)
}

export function setRootEnabled(id: number, enabled: boolean): void {
  getDb().prepare('UPDATE roots SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
}

export interface MediaLocation {
  rootPath: string
  relPath: string
  playbackTier: PlaybackTier | null
  kind: MediaKind
}

/**
 * Everything the media:// handler needs to turn an opaque id into a file on disk.
 * Returns null for unknown ids and for roots that have been disabled, so disabling
 * a root immediately stops it serving media.
 */
export function getMediaLocation(id: number): MediaLocation | null {
  const row = getDb()
    .prepare<[number], { root_path: string; rel_path: string; playback_tier: PlaybackTier | null; kind: MediaKind }>(
      `SELECT r.path AS root_path, m.rel_path, m.playback_tier, m.kind
         FROM media m
         JOIN roots r ON r.id = m.root_id
        WHERE m.id = ? AND r.enabled = 1`,
    )
    .get(id)

  if (!row) return null
  return {
    rootPath: row.root_path,
    relPath: row.rel_path,
    playbackTier: row.playback_tier,
    kind: row.kind,
  }
}

export function libraryStats(): LibraryStats {
  const row = getDb()
    .prepare<[], LibraryStats>(
      `SELECT
         COUNT(*)                                        AS total,
         COALESCE(SUM(kind = 'image'), 0)                AS images,
         COALESCE(SUM(kind = 'video'), 0)                AS videos,
         COALESCE(SUM(missing = 1), 0)                   AS missing,
         COALESCE(SUM(favorited_at IS NOT NULL), 0)      AS favorites
       FROM media`,
    )
    .get()

  return row ?? { total: 0, images: 0, videos: 0, missing: 0, favorites: 0 }
}
