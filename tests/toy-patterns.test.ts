/**
 * Patterns the user draws: cleaned up on the way in, played as drawn, and
 * saved so they survive a restart.
 *
 * A drawn shape reaches a device, and it can arrive from a stored row or a
 * guest's page as well as the editor, so the cleaning is the part that matters.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { customIdOf, normaliseShape, SHAPE_LIMITS, shapeBuzz, shapeLevel } from '../src/shared/toy'
import type { PatternShape } from '../src/shared/toy'

const workspace = await mkdtemp(join(tmpdir(), 'goonlib-patterns-'))

vi.mock('electron', () => ({ app: { getPath: () => workspace } }))

const { initDb, closeDb, getDb } = await import('../src/main/db')
const { deletePattern, getPattern, listPatterns, savePattern } = await import('../src/main/db/patterns')

beforeAll(() => {
  initDb(join(workspace, 'test.db'))
})

afterAll(async () => {
  closeDb()
  await rm(workspace, { recursive: true, force: true })
})

describe('cleaning up a drawn shape', () => {
  it('pins a point to each end, so the loop joins where it was drawn to', () => {
    expect(normaliseShape({ durationMs: 1000, points: [{ at: 400, level: 0.5 }] })).toEqual({
      durationMs: 1000,
      points: [
        { at: 0, level: 0.5 },
        { at: 400, level: 0.5 },
        { at: 1000, level: 0.5 },
      ],
    })
  })

  it('keeps everything inside the pattern, and between off and full', () => {
    const shape = normaliseShape({
      durationMs: 999_999,
      points: [
        { at: -50, level: 7 },
        { at: 10_000_000, level: -1 },
        { at: 'soon', level: 0.5 },
      ],
    })
    expect(shape?.durationMs).toBe(SHAPE_LIMITS.maxMs)
    expect(shape?.points).toEqual([
      { at: 0, level: 1 },
      { at: SHAPE_LIMITS.maxMs, level: 0 },
    ])
  })

  it('keeps two points on the same moment, in the order they were drawn', () => {
    const shape = normaliseShape({
      durationMs: 1000,
      points: [
        { at: 0, level: 1 },
        { at: 500, level: 1 },
        { at: 500, level: 0 },
        { at: 1000, level: 0 },
      ],
    })
    expect(shape?.points.map((p) => p.level)).toEqual([1, 1, 0, 0])
  })

  it('refuses something with nothing to play', () => {
    expect(normaliseShape(null)).toBeNull()
    expect(normaliseShape({ durationMs: 1000, points: [] })).toBeNull()
    expect(normaliseShape({ durationMs: 'long', points: [{ at: 0, level: 1 }] })).toBeNull()
  })
})

describe('playing a drawn shape', () => {
  const ramp: PatternShape = {
    durationMs: 1000,
    points: [
      { at: 0, level: 0 },
      { at: 1000, level: 1 },
    ],
  }

  it('follows the line between points, scaled by strength', () => {
    expect(shapeLevel(ramp, 1, 250)).toBeCloseTo(0.25)
    expect(shapeLevel(ramp, 0.5, 500)).toBeCloseTo(0.25)
  })

  it('loops', () => {
    expect(shapeLevel(ramp, 1, 1250)).toBeCloseTo(0.25)
  })

  it('makes a sheer edge where two points share a moment', () => {
    const pulse = normaliseShape({
      durationMs: 1000,
      points: [
        { at: 0, level: 1 },
        { at: 500, level: 1 },
        { at: 500, level: 0 },
        { at: 1000, level: 0 },
      ],
    })!
    expect(shapeLevel(pulse, 1, 499)).toBe(1)
    expect(shapeLevel(pulse, 1, 501)).toBe(0)
  })
})

describe('a guest picking a saved pattern', () => {
  const limits = { maxIntensity: 1, maxSeconds: 10 }
  const saved: PatternShape = { durationMs: 1000, points: [{ at: 0, level: 1 }, { at: 1000, level: 1 }] }

  it("plays the host's own copy of the shape", () => {
    const buzz = shapeBuzz({ pattern: 'custom:7', intensity: 1, seconds: 2 }, limits, (id) =>
      id === 7 ? saved : null,
    )
    expect(buzz).toMatchObject({ pattern: 'custom:7', shape: saved })
  })

  it('is turned away for a pattern the host does not have, and never takes a shape from the page', () => {
    const body = { pattern: 'custom:8', intensity: 1, seconds: 2, shape: saved }
    expect(shapeBuzz(body, limits, () => null)).toBeNull()
    expect(customIdOf('custom:0')).toBeNull()
    expect(customIdOf('custom:12')).toBe(12)
  })
})

describe('saved patterns', () => {
  it('are saved cleaned up, listed by name, and given back as stored', () => {
    const made = savePattern({ name: '  Tease  ', durationMs: 2000, points: [{ at: 1000, level: 0.8 }] })
    expect(made.name).toBe('Tease')
    expect(made.points).toHaveLength(3)
    savePattern({ name: 'another', durationMs: 1000, points: [{ at: 0, level: 0.2 }] })
    expect(listPatterns().map((p) => p.name)).toEqual(['another', 'Tease'])
    expect(getPattern(made.id)).toEqual(made)
  })

  it('update in place when saved again, and are gone when deleted', () => {
    const made = savePattern({ name: 'Draft', durationMs: 1000, points: [{ at: 0, level: 0.5 }] })
    const edited = savePattern({ ...made, name: 'Final', durationMs: 3000 })
    expect(edited.id).toBe(made.id)
    expect(getPattern(made.id)?.durationMs).toBe(3000)

    deletePattern(made.id)
    expect(getPattern(made.id)).toBeNull()
  })

  it('leave out a row that no longer reads, rather than playing it', () => {
    getDb()
      .prepare(
        "INSERT INTO toy_patterns (name, duration_ms, points, created_at, updated_at) VALUES ('broken', 1000, 'not json', 0, 0)",
      )
      .run()
    expect(listPatterns().some((p) => p.name === 'broken')).toBe(false)
  })
})
