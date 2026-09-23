import type {
  MediaItem,
  MediaKind,
  MediaPage,
  MediaQuery,
  PlaybackTier,
  SpriteLayout,
  StageState,
} from '@shared/types'
import type { ProbeResult } from '../scan/probe'
import { escapeLike } from './folders'
import { DURATION_BANDS, SIZE_BANDS } from '@shared/types'
import { getDb } from './index'

/** The columns that map onto a MediaItem, in one place so the two never drift. */
/** The same columns, for a query that joins from somewhere else. */
export const MEDIA_COLUMNS_FOR_JOIN = `
  m.id, m.root_id, m.rel_path, m.name, m.ext, m.kind, m.size, m.mtime,
  m.width, m.height, m.duration_ms, m.vcodec, m.acodec, m.fps, m.playback_tier,
  m.content_hash, m.phash,
  m.probe_state, m.thumb_state, m.sprite_state, m.hash_state, m.classify_state,
  m.sprite_frames, m.sprite_columns, m.sprite_cell_w, m.sprite_cell_h,
  m.added_at, m.missing, m.favorited_at
`

const MEDIA_COLUMNS = `
  m.id, m.root_id, m.rel_path, m.name, m.ext, m.kind, m.size, m.mtime,
  m.width, m.height, m.duration_ms, m.vcodec, m.acodec, m.fps, m.playback_tier,
  m.content_hash, m.phash,
  m.probe_state, m.thumb_state, m.sprite_state, m.hash_state, m.classify_state,
  m.sprite_frames, m.sprite_columns, m.sprite_cell_w, m.sprite_cell_h,
  m.added_at, m.missing, m.favorited_at
`

interface MediaRow {
  id: number
  root_id: number
  rel_path: string
  name: string
  ext: string
  kind: MediaKind
  size: number
  mtime: number
  width: number | null
  height: number | null
  duration_ms: number | null
  vcodec: string | null
  acodec: string | null
  fps: number | null
  playback_tier: PlaybackTier | null
  content_hash: string | null
  phash: string | null
  probe_state: StageState
  thumb_state: StageState
  sprite_state: StageState
  hash_state: StageState
  classify_state: StageState
  sprite_frames: number | null
  sprite_columns: number | null
  sprite_cell_w: number | null
  sprite_cell_h: number | null
  added_at: number
  missing: number
  favorited_at: number | null
}

/** A row of those columns as a MediaItem, for callers outside this file. */
export function toMediaItemRow(row: unknown): MediaItem {
  return toMediaItem(row as MediaRow)
}

function toMediaItem(row: MediaRow): MediaItem {
  return {
    id: row.id,
    rootId: row.root_id,
    relPath: row.rel_path,
    name: row.name,
    ext: row.ext,
    kind: row.kind,
    size: row.size,
    mtime: row.mtime,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    vcodec: row.vcodec,
    acodec: row.acodec,
    fps: row.fps,
    playbackTier: row.playback_tier,
    contentHash: row.content_hash,
    phash: row.phash,
    probeState: row.probe_state,
    thumbState: row.thumb_state,
    spriteState: row.sprite_state,
    hashState: row.hash_state,
    classifyState: row.classify_state,
    addedAt: row.added_at,
    missing: row.missing === 1,
    favoritedAt: row.favorited_at,
    sprite:
      row.sprite_frames && row.sprite_columns && row.sprite_cell_w && row.sprite_cell_h
        ? {
            frames: row.sprite_frames,
            columns: row.sprite_columns,
            cellWidth: row.sprite_cell_w,
            cellHeight: row.sprite_cell_h,
          }
        : null,
  }
}

// ---------------------------------------------------------------------------
// Writing: the scan pipeline
// ---------------------------------------------------------------------------

export interface UpsertEntry {
  relPath: string
  name: string
  ext: string
  kind: MediaKind
  size: number
  mtime: number
}

/**
 * Inserts or refreshes a batch of walked files in one transaction.
 *
 * The important part is the CASE clauses: if a file's size or mtime changed since
 * we last saw it, everything derived from its contents is stale and gets reset to
 * pending. If nothing changed, the existing thumbnails and hashes are kept, which
 * is what makes a rescan cheap and an interrupted scan resumable.
 */
export function upsertMediaBatch(rootId: number, entries: UpsertEntry[], seenAt: number): void {
  if (entries.length === 0) return

  const db = getDb()
  const statement = db.prepare(`
    INSERT INTO media (root_id, rel_path, name, ext, kind, size, mtime, added_at, seen_at, missing)
    VALUES (@rootId, @relPath, @name, @ext, @kind, @size, @mtime, @now, @now, 0)
    ON CONFLICT (root_id, rel_path) DO UPDATE SET
      size    = excluded.size,
      mtime   = excluded.mtime,
      seen_at = excluded.seen_at,
      missing = 0,
      probe_state  = CASE WHEN media.mtime <> excluded.mtime OR media.size <> excluded.size
                          THEN 'pending' ELSE media.probe_state END,
      thumb_state  = CASE WHEN media.mtime <> excluded.mtime OR media.size <> excluded.size
                          THEN 'pending' ELSE media.thumb_state END,
      sprite_state = CASE WHEN media.mtime <> excluded.mtime OR media.size <> excluded.size
                          THEN 'pending' ELSE media.sprite_state END,
      hash_state   = CASE WHEN media.mtime <> excluded.mtime OR media.size <> excluded.size
                          THEN 'pending' ELSE media.hash_state END,
      classify_state = CASE WHEN media.mtime <> excluded.mtime OR media.size <> excluded.size
                          THEN 'pending' ELSE media.classify_state END
  `)

  const insertAll = db.transaction((batch: UpsertEntry[]) => {
    for (const entry of batch) {
      statement.run({ ...entry, rootId, now: seenAt })
    }
  })

  insertAll(entries)
}

/** Ids in a root that this scan didn't see — the files that are no longer there. */
export function missingMediaIds(rootId: number, seenAt: number): number[] {
  return getDb()
    .prepare<[number, number], { id: number }>(
      'SELECT id FROM media WHERE root_id = ? AND seen_at < ?',
    )
    .all(rootId, seenAt)
    .map((row) => row.id)
}

/**
 * Forgets media entirely.
 *
 * Cascades take the tags and collection memberships with it, and a collection
 * whose cover this was falls back to null. That is the intended effect — the
 * file is gone, so a tag pointing at it is not information — but it is also why
 * the caller has to be sure the file is really gone rather than merely
 * unreachable.
 */
export function deleteMedia(ids: number[]): number {
  if (ids.length === 0) return 0

  const db = getDb()
  const remove = db.prepare('DELETE FROM media WHERE id = ?')

  const removeAll = db.transaction((batch: number[]) => {
    let removed = 0
    for (const id of batch) removed += remove.run(id).changes
    return removed
  })

  return removeAll(ids)
}

export interface PendingItem {
  id: number
  rootPath: string
  relPath: string
  ext: string
  kind: MediaKind
  durationMs: number | null
}

export type StageColumn =
  | 'probe_state'
  | 'thumb_state'
  | 'sprite_state'
  | 'hash_state'
  | 'classify_state'

/**
 * Rows still needing a given stage. Nothing is marked in-flight, which means a
 * crash mid-stage simply leaves the work pending for next time.
 *
 * `kind` narrows the claim rather than having the caller claim-and-discard. The
 * classify stage can be limited to images, and leaving the videos *pending*
 * (instead of marking them skipped) is what lets the user turn videos on later
 * and have the next scan simply pick them up.
 */
export function claimPending(stage: StageColumn, limit: number, kind?: MediaKind): PendingItem[] {
  // `stage` and the presence of `kind` are both compile-time literals here, never
  // renderer input; the kind *value* is still bound as a parameter.
  const params: unknown[] = []
  let clause = ''
  if (kind) {
    clause = 'AND m.kind = ?'
    params.push(kind)
  }

  const rows = getDb()
    .prepare<
      unknown[],
      { id: number; root_path: string; rel_path: string; ext: string; kind: MediaKind; duration_ms: number | null }
    >(
      `SELECT m.id, r.path AS root_path, m.rel_path, m.ext, m.kind, m.duration_ms
         FROM media m
         JOIN roots r ON r.id = m.root_id
        WHERE m.${stage} = 'pending' AND m.missing = 0 AND r.enabled = 1
          ${clause}
        ORDER BY m.id
        LIMIT ?`,
    )
    .all(...params, limit)

  return rows.map((row) => ({
    id: row.id,
    rootPath: row.root_path,
    relPath: row.rel_path,
    ext: row.ext,
    kind: row.kind,
    durationMs: row.duration_ms,
  }))
}

export function countPending(stage: StageColumn, kind?: MediaKind): number {
  const params: unknown[] = kind ? [kind] : []

  const row = getDb()
    .prepare<unknown[], { n: number }>(
      `SELECT COUNT(*) AS n
         FROM media m JOIN roots r ON r.id = m.root_id
        WHERE m.${stage} = 'pending' AND m.missing = 0 AND r.enabled = 1
          ${kind ? 'AND m.kind = ?' : ''}`,
    )
    .get(...params)
  return row?.n ?? 0
}

export function applyProbeResult(id: number, result: ProbeResult): void {
  getDb()
    .prepare(
      `UPDATE media SET
         width = ?, height = ?, duration_ms = ?, vcodec = ?, acodec = ?, fps = ?,
         playback_tier = ?, probe_state = 'done'
       WHERE id = ?`,
    )
    .run(
      result.width,
      result.height,
      result.durationMs,
      result.vcodec,
      result.acodec,
      result.fps,
      result.playbackTier,
      id,
    )
}

/** Flags a single item as gone, e.g. right after we moved it to the Trash. */
export function markMissing(id: number): void {
  getDb().prepare('UPDATE media SET missing = 1 WHERE id = ?').run(id)
}

/** The reverse, for a file put back where it was — by undo, not by a rescan. */
export function markPresent(id: number): void {
  getDb().prepare('UPDATE media SET missing = 0 WHERE id = ?').run(id)
}

export function applyHashResult(
  id: number,
  result: { contentHash: string; phash: string | null },
): void {
  getDb()
    .prepare("UPDATE media SET content_hash = ?, phash = ?, hash_state = 'done' WHERE id = ?")
    .run(result.contentHash, result.phash, id)
}

export function applySpriteResult(id: number, layout: SpriteLayout | null): void {
  // A null layout means the clip was too short to be worth scrubbing. That's a
  // completed outcome, not a failure, so it's recorded as 'skipped'.
  getDb()
    .prepare(
      `UPDATE media SET
         sprite_frames = ?, sprite_columns = ?, sprite_cell_w = ?, sprite_cell_h = ?,
         sprite_state = ?
       WHERE id = ?`,
    )
    .run(
      layout?.frames ?? null,
      layout?.columns ?? null,
      layout?.cellWidth ?? null,
      layout?.cellHeight ?? null,
      layout ? 'done' : 'skipped',
      id,
    )
}

export function setStageState(id: number, stage: StageColumn, state: StageState): void {
  // `stage` is a union of literals, never user input, so interpolating it is safe.
  getDb().prepare(`UPDATE media SET ${stage} = ? WHERE id = ?`).run(state, id)
}

// ---------------------------------------------------------------------------
// Reading: the grid
// ---------------------------------------------------------------------------

const SORT_COLUMNS: Record<NonNullable<MediaQuery['sort']>, string> = {
  added: 'm.added_at',
  name: 'm.name COLLATE NOCASE',
  size: 'm.size',
  duration: 'm.duration_ms',
  manual: 'ci.position',
  // Replaced by a seeded expression in buildMediaQuery.
  shuffle: 'm.id',
}

/**
 * A shuffled order that holds still: each id hashed with the seed. The same
 * seed always gives the same order, so pages load consistently and "select
 * all" matches the grid; a new seed is a new shuffle.
 */
function shuffleOrder(seed: number | undefined): string {
  const raw = Number.isFinite(seed) ? Math.abs(Math.trunc(seed as number)) % 2147483647 : 0
  // Spread the seed across every bit first, so neighbouring seeds (1 and 2)
  // shuffle as differently as any two others.
  const safe = Math.imul(raw ^ 0x5bd1e995, 0x85ebca6b) >>> 0
  // Hash the id, XOR it with the seed (SQLite has no ^, so (a | b) - (a & b)),
  // and hash again. Adding the seed instead would only rotate one fixed order.
  const hashed = '((m.id * 2654435761) % 4294967291)'
  return `(((${hashed} | ${safe}) - (${hashed} & ${safe})) * 40503 % 4294967291)`
}

/**
 * Everything `listMedia` and `listMediaIds` agree on: which rows match, and in
 * what order.
 *
 * Shared rather than written twice because the two have to stay in lockstep —
 * "select all" hands the ids straight to a delete, so an id list that matched a
 * slightly different set of rows than the grid is showing would be a very bad
 * way to find out the two had drifted.
 */
function buildMediaQuery(query: Omit<MediaQuery, 'limit' | 'offset'>): {
  from: string
  clause: string
  params: unknown[]
  sort: string
  order: 'ASC' | 'DESC'
} {
  const where: string[] = ['r.enabled = 1']
  const params: unknown[] = []

  if (!query.includeMissing) where.push('m.missing = 0')

  if (query.kind && query.kind !== 'all') {
    where.push('m.kind = ?')
    params.push(query.kind)
  }

  if (query.rootId !== undefined) {
    where.push('m.root_id = ?')
    params.push(query.rootId)
  }

  if (query.pathPrefix) {
    // Selecting a folder shows everything beneath it, so this is a prefix match
    // rather than an exact-directory match. Escaped, because folder names really
    // do contain % and _.
    where.push("m.rel_path LIKE ? ESCAPE '\\'")
    params.push(`${escapeLike(query.pathPrefix)}%`)
  }

  // Every tag has to be there, not any of them: picking two tags means the
  // things that carry both, which is what narrowing means everywhere else.
  for (const tagId of query.tagIds ?? []) {
    where.push('EXISTS (SELECT 1 FROM media_tags mt WHERE mt.media_id = m.id AND mt.tag_id = ?)')
    params.push(tagId)
  }

  const exts = (query.exts ?? []).filter((ext) => typeof ext === 'string' && ext.length > 0)
  if (exts.length > 0) {
    where.push(`m.ext IN (${exts.map(() => '?').join(', ')})`)
    params.push(...exts.map((ext) => ext.toLowerCase()))
  }

  const bands = (query.durations ?? []).map((band) => DURATION_BANDS[band]).filter(Boolean)
  if (bands.length > 0) {
    // A picture has no length, so asking about length excludes them.
    where.push(
      `(m.duration_ms IS NOT NULL AND (${bands
        .map(() => '(m.duration_ms >= ? AND (? IS NULL OR m.duration_ms < ?))')
        .join(' OR ')}))`,
    )
    for (const band of bands) params.push(band.from, band.to, band.to)
  }

  const sizes = (query.sizes ?? []).map((band) => SIZE_BANDS[band]).filter(Boolean)
  if (sizes.length > 0) {
    where.push(`(${sizes.map(() => '(m.size >= ? AND (? IS NULL OR m.size < ?))').join(' OR ')})`)
    for (const band of sizes) params.push(band.from, band.to, band.to)
  }

  if (query.directOnly) {
    // Nothing left after the prefix may contain a separator, which is exactly
    // "in this folder, not in one of its subfolders". Works with an empty
    // prefix too, giving the items sitting at the top of a root.
    where.push('instr(substr(m.rel_path, ? + 1), ?) = 0')
    params.push((query.pathPrefix ?? '').length, '/')
  }

  const joins: string[] = []

  if (query.collectionId !== undefined) {
    joins.push('JOIN collection_items ci ON ci.media_id = m.id AND ci.collection_id = ?')
    // The join parameter comes before every WHERE parameter in the final SQL, so
    // it has to be unshifted rather than pushed.
    params.unshift(query.collectionId)
  }

  if (query.favorite) {
    where.push('m.favorited_at IS NOT NULL')
  }

  if (query.tagId !== undefined) {
    // EXISTS rather than a join: an item carries a tag once, but expressing it
    // as a join alongside the collection join makes the row count depend on the
    // join order, and the total would then be wrong.
    where.push('EXISTS (SELECT 1 FROM media_tags mt WHERE mt.media_id = m.id AND mt.tag_id = ?)')
    params.push(query.tagId)
  }

  const fts = toFtsQuery(query.search)
  if (fts) {
    joins.push('JOIN media_fts ON media_fts.rowid = m.id')
    where.push('media_fts MATCH ?')
    params.push(fts)
  }

  const clause = `WHERE ${where.join(' AND ')}`
  const from = `FROM media m JOIN roots r ON r.id = m.root_id ${joins.join(' ')}`

  // Manual order only exists inside a collection; anywhere else it has no column
  // to sort by, so fall back to recency rather than producing an invalid query.
  const requested = query.sort ?? 'added'
  const effective = requested === 'manual' && query.collectionId === undefined ? 'added' : requested

  const sort = effective === 'shuffle' ? shuffleOrder(query.seed) : SORT_COLUMNS[effective]
  // A hand-ordered list reads top-to-bottom, so manual order is always ascending.
  const order = effective === 'manual' || query.order === 'asc' ? 'ASC' : 'DESC'

  return { from, clause, params, sort, order }
}

export function listMedia(query: MediaQuery): MediaPage {
  const db = getDb()
  const { from, clause, params, sort, order } = buildMediaQuery(query)

  const totalRow = db
    .prepare<unknown[], { n: number; bytes: number | null }>(
      `SELECT COUNT(*) AS n, SUM(m.size) AS bytes ${from} ${clause}`,
    )
    .get(...params)

  const rows = db
    .prepare<unknown[], MediaRow>(
      // The id tiebreaker keeps paging stable when many rows share a sort value.
      `SELECT ${MEDIA_COLUMNS} ${from} ${clause}
       ORDER BY ${sort} ${order} NULLS LAST, m.id ${order}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, query.limit, query.offset)

  return { items: rows.map(toMediaItem), total: totalRow?.n ?? 0, totalBytes: totalRow?.bytes ?? 0 }
}

/**
 * Every id matching a query, in the order the grid shows them.
 *
 * This is what "select all" and shift-range selection run on: the grid only ever
 * holds the pages you have scrolled through, so it cannot answer "what is item
 * 40,000" on its own. Ids only — the rows themselves would be megabytes for a
 * large library, and nothing here needs more than identity and position.
 */
export function listMediaIds(query: Omit<MediaQuery, 'limit' | 'offset'>): number[] {
  const { from, clause, params, sort, order } = buildMediaQuery(query)

  return getDb()
    .prepare<unknown[], { id: number }>(
      `SELECT m.id ${from} ${clause} ORDER BY ${sort} ${order} NULLS LAST, m.id ${order}`,
    )
    .all(...params)
    .map((row) => row.id)
}

/**
 * Re-homes a row after its file moved to a new place inside the library.
 *
 * The FTS triggers fire on rel_path and name, so search follows along, and
 * everything keyed by media id — tags, collection membership, the cached
 * thumbnail and sprite sheet — is untouched by design.
 *
 * Any other row already claiming that exact spot is cleared out first. The
 * caller only ever passes a path it just proved was free on disk, so such a row
 * describes a file that is no longer there, and leaving it would break the
 * (root_id, rel_path) unique constraint over a stale record.
 */
export function relocateMedia(id: number, rootId: number, relPath: string, name: string): void {
  const db = getDb()

  db.prepare('DELETE FROM media WHERE root_id = ? AND rel_path = ? AND id <> ?').run(
    rootId,
    relPath,
    id,
  )

  db.prepare(
    `UPDATE media
        SET root_id = ?, rel_path = ?, name = ?, missing = 0
      WHERE id = ?`,
  ).run(rootId, relPath, name, id)
}

/** Drops a row outright — used when its file has left the library for good. */
export function forgetMedia(id: number): void {
  getDb().prepare('DELETE FROM media WHERE id = ?').run(id)
}

export function getMedia(id: number): MediaItem | null {
  const row = getDb()
    .prepare<[number], MediaRow>(
      `SELECT ${MEDIA_COLUMNS} FROM media m WHERE m.id = ?`,
    )
    .get(id)
  return row ? toMediaItem(row) : null
}

/**
 * Turns user text into an FTS5 query.
 *
 * Every token is quoted so that FTS operators the user didn't intend — `NEAR`, a
 * stray `*`, an unbalanced quote — are treated as literal text rather than
 * blowing up the query. A trailing `*` on each token gives prefix matching, so
 * results narrow as you type.
 */
export function toFtsQuery(search: string | undefined): string | null {
  if (!search) return null

  const tokens = search
    .trim()
    // FTS5 tokenizes on non-alphanumerics anyway; splitting here keeps the quoting simple.
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

  if (tokens.length === 0) return null

  return tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(' ')
}

/** Every file type in the library, commonest first. */
export function listExtensions(): Array<{ ext: string; count: number }> {
  return getDb()
    .prepare<[], { ext: string; count: number }>(
      `SELECT m.ext AS ext, COUNT(*) AS count
         FROM media m JOIN roots r ON r.id = m.root_id
        WHERE m.missing = 0 AND r.enabled = 1 AND m.ext <> ''
        GROUP BY m.ext
        ORDER BY count DESC, m.ext`,
    )
    .all()
}
