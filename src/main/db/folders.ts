/**
 * Folder navigation, derived entirely from the `rel_path` already stored on each
 * item. There is no folders table and no extra scanning: the hierarchy is a view
 * over paths we've had since the walk.
 *
 * Children are queried one level at a time so an expanded tree costs a query per
 * open node rather than a full table scan of every path in the library.
 */

import type { FolderNode } from '@shared/types'
import { getDb } from './index'

/**
 * Escapes the LIKE wildcards `%` and `_` (and the escape character itself).
 *
 * Folder names contain these more often than you'd guess — `100%_done`, `foo_bar`
 * — and unescaped they'd silently match sibling folders.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

interface ChildRow {
  folder: string
  total: number
  has_children: number
}

interface FolderParams {
  rootId: number
  like: string
  plen: number
}

/**
 * Immediate subfolders of `prefix` within a root.
 *
 * `prefix` is '' for the root itself, otherwise a path ending in '/'.
 * Counts are recursive — the number of items anywhere beneath each child — which
 * matches what selecting the folder will show.
 */
export function listChildFolders(rootId: number, prefix: string): FolderNode[] {
  // Named parameters, not `?1`-style numbered ones: better-sqlite3 binds
  // positionally only for anonymous `?`, and numbered placeholders bound as an
  // argument list fail rather than filling in.
  const rows = getDb()
    .prepare<FolderParams, ChildRow>(
      `WITH rest AS (
         SELECT substr(rel_path, @plen + 1) AS r
           FROM media
          WHERE root_id = @rootId
            AND missing = 0
            AND rel_path LIKE @like ESCAPE '\\'
       )
       SELECT
         substr(r, 1, instr(r, '/') - 1)                                    AS folder,
         COUNT(*)                                                           AS total,
         -- A child has its own subfolders if anything below it still contains
         -- a separator after its own name is stripped.
         MAX(CASE WHEN instr(substr(r, instr(r, '/') + 1), '/') > 0 THEN 1 ELSE 0 END)
                                                                            AS has_children
       FROM rest
       -- No separator means a file sitting directly here, not a folder.
       WHERE instr(r, '/') > 0
       GROUP BY folder
       ORDER BY folder COLLATE NOCASE`,
    )
    .all({ rootId, like: `${escapeLike(prefix)}%`, plen: prefix.length })

  return rows.map((row) => ({
    name: row.folder,
    path: `${prefix}${row.folder}/`,
    count: row.total,
    hasChildren: row.has_children === 1,
  }))
}

/** Number of items directly in a folder, excluding its subfolders. */
export function countDirectFiles(rootId: number, prefix: string): number {
  const row = getDb()
    .prepare<FolderParams, { n: number }>(
      `SELECT COUNT(*) AS n
         FROM media
        WHERE root_id = @rootId
          AND missing = 0
          AND rel_path LIKE @like ESCAPE '\\'
          AND instr(substr(rel_path, @plen + 1), '/') = 0`,
    )
    .get({ rootId, like: `${escapeLike(prefix)}%`, plen: prefix.length })

  return row?.n ?? 0
}
