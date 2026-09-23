import { describe, expect, it } from 'vitest'
import { midpoint } from '../src/main/db/collections'

/**
 * Collection order is stored as a REAL so a move rewrites one row instead of
 * renumbering the list. `midpoint` is where that scheme lives or dies.
 */
describe('midpoint', () => {
  it('places the only item at a sensible starting position', () => {
    expect(midpoint(undefined, undefined)).toBe(1)
  })

  it('places an item before the current first', () => {
    expect(midpoint(undefined, 5)).toBe(4)
  })

  it('places an item after the current last', () => {
    expect(midpoint(5, undefined)).toBe(6)
  })

  it('splits the gap between two neighbours', () => {
    expect(midpoint(1, 2)).toBe(1.5)
    expect(midpoint(2, 8)).toBe(5)
  })

  it('keeps splitting as the gap narrows', () => {
    // Dragging repeatedly into the same slot halves the gap each time; this has
    // to keep producing a value strictly between the neighbours.
    let low = 1
    const high = 2

    for (let i = 0; i < 15; i += 1) {
      const next = midpoint(low, high)
      expect(next, `iteration ${i}`).not.toBeNull()
      expect(next as number).toBeGreaterThan(low)
      expect(next as number).toBeLessThan(high)
      low = next as number
    }
  })

  it('reports exhaustion instead of returning a duplicate position', () => {
    // Once the gap is below the threshold, a "midpoint" would round to one of the
    // neighbours and two items would share a position — silently scrambling the
    // order. Returning null is what triggers renormalisation instead.
    expect(midpoint(1, 1 + 1e-9)).toBeNull()
    expect(midpoint(1, 1)).toBeNull()
  })

  it('handles negative positions, which arise from repeated prepends', () => {
    expect(midpoint(undefined, -3)).toBe(-4)
    expect(midpoint(-4, -3)).toBe(-3.5)
  })
})
