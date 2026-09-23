/**
 * Patterns the user has drawn for their toy.
 *
 * Every row is passed back through `normaliseShape` on the way out as well as
 * on the way in, so a hand-edited or half-written row plays as something sane
 * — or is left out — rather than reaching a device as whatever it says.
 */

import type { CustomPatternDraft } from '@shared/types'
import type { CustomPattern } from '@shared/toy'
import { normaliseShape, SHAPE_LIMITS } from '@shared/toy'
import { getDb } from './index'

interface PatternRow {
  id: number
  name: string
  duration_ms: number
  points: string
}

function toPattern(row: PatternRow): CustomPattern | null {
  let points: unknown
  try {
    points = JSON.parse(row.points)
  } catch {
    return null
  }
  const shape = normaliseShape({ durationMs: row.duration_ms, points })
  return shape ? { id: row.id, name: row.name, ...shape } : null
}

export function listPatterns(): CustomPattern[] {
  return getDb()
    .prepare<[], PatternRow>(
      'SELECT id, name, duration_ms, points FROM toy_patterns ORDER BY name COLLATE NOCASE, id',
    )
    .all()
    .map(toPattern)
    .filter((pattern): pattern is CustomPattern => pattern !== null)
}

export function getPattern(id: number): CustomPattern | null {
  const row = getDb()
    .prepare<[number], PatternRow>('SELECT id, name, duration_ms, points FROM toy_patterns WHERE id = ?')
    .get(id)
  return row ? toPattern(row) : null
}

/**
 * Inserts a new pattern, or replaces an existing one when the draft carries an
 * id that is still there. An id that has since been deleted is saved as new
 * rather than lost.
 */
export function savePattern(draft: CustomPatternDraft, now = Date.now()): CustomPattern {
  const shape = normaliseShape(draft)
  if (!shape) throw new Error('A pattern needs at least one point')

  const name =
    (typeof draft.name === 'string' ? draft.name : '').trim().slice(0, SHAPE_LIMITS.maxName) ||
    'Untitled pattern'
  const points = JSON.stringify(shape.points)
  const db = getDb()

  const existing =
    typeof draft.id === 'number' && Number.isSafeInteger(draft.id) ? getPattern(draft.id) : null

  if (existing) {
    db.prepare(
      'UPDATE toy_patterns SET name = ?, duration_ms = ?, points = ?, updated_at = ? WHERE id = ?',
    ).run(name, shape.durationMs, points, now, existing.id)
    return { id: existing.id, name, ...shape }
  }

  const result = db
    .prepare(
      `INSERT INTO toy_patterns (name, duration_ms, points, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(name, shape.durationMs, points, now, now)
  return { id: Number(result.lastInsertRowid), name, ...shape }
}

export function deletePattern(id: number): void {
  getDb().prepare('DELETE FROM toy_patterns WHERE id = ?').run(id)
}
