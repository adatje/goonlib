import { describe, expect, it } from 'vitest'
import {
  advance,
  currentIndex,
  emptyHistory,
  pickRandomFrom,
  pickRandomIndex,
  retreat,
  startHistory,
} from '../src/renderer/src/shuffle'

/** A deterministic random source cycling through the given values. */
function sequence(...values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length] as number
}

describe('pickRandomIndex', () => {
  it('returns null when there is nothing to pick', () => {
    expect(pickRandomIndex(0)).toBeNull()
    expect(pickRandomIndex(-1)).toBeNull()
    expect(pickRandomIndex(Number.NaN)).toBeNull()
  })

  it('always returns the only item in a library of one', () => {
    expect(pickRandomIndex(1)).toBe(0)
  })

  it('maps the random source across the whole range', () => {
    expect(pickRandomIndex(10, { random: sequence(0) })).toBe(0)
    expect(pickRandomIndex(10, { random: sequence(0.99) })).toBe(9)
  })

  it('never returns an out-of-range index, even if the source returns 1', () => {
    // Math.random() is documented as [0,1) but a stubbed or exotic source may not
    // be, and an out-of-range index would index past the end of the library.
    expect(pickRandomIndex(10, { random: sequence(1) })).toBe(9)
  })

  it('skips recently played items', () => {
    // First two draws land on excluded items; the third is accepted.
    const index = pickRandomIndex(10, { recent: [0, 1], random: sequence(0, 0.1, 0.5) })
    expect(index).toBe(5)
  })

  it('honours only half the library, so selection can never starve', () => {
    // Nine of ten "recent", but at most five are honoured — so index 0, which is
    // in the recent list but outside the capped window, remains selectable.
    const recent = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    const index = pickRandomIndex(10, { recent, random: sequence(0) })
    expect(index).toBe(0)
  })

  it('still returns something when every attempt collides', () => {
    // A source stuck on one excluded value must not loop forever or return null.
    const index = pickRandomIndex(4, { recent: [2], random: sequence(0.5) })
    expect(index).not.toBeNull()
    expect(index).toBeGreaterThanOrEqual(0)
    expect(index as number).toBeLessThan(4)
  })

  it('spreads across the library rather than clustering', () => {
    // Guards the actual user-visible property: shuffle shouldn't keep replaying
    // the same few items.
    const seen = new Set<number>()
    let recent: number[] = []

    for (let i = 0; i < 60; i += 1) {
      const index = pickRandomIndex(100, { recent })
      if (index === null) break
      seen.add(index)
      recent = [...recent, index].slice(-50)
    }

    expect(seen.size).toBeGreaterThan(40)
  })
})

describe('shuffle history', () => {
  it('starts empty and reports no current index', () => {
    expect(currentIndex(emptyHistory)).toBeNull()
  })

  it('advances to newly picked items', () => {
    let history = startHistory(3)
    history = advance(history, 10, sequence(0.7))

    expect(currentIndex(history)).toBe(7)
    expect(history.items).toEqual([3, 7])
  })

  it('steps back through what was actually played, not to a fresh random item', () => {
    // The whole point of "previous" is returning to what you just saw.
    let history = startHistory(3)
    history = advance(history, 10, sequence(0.7))
    history = advance(history, 10, sequence(0.5))
    expect(currentIndex(history)).toBe(5)

    history = retreat(history)
    expect(currentIndex(history)).toBe(7)
    history = retreat(history)
    expect(currentIndex(history)).toBe(3)
  })

  it('stays put when stepping back past the beginning', () => {
    let history = startHistory(3)
    history = retreat(history)
    history = retreat(history)
    expect(currentIndex(history)).toBe(3)
  })

  it('replays forward through history before picking anything new', () => {
    let history = startHistory(3)
    history = advance(history, 10, sequence(0.7))
    history = retreat(history)

    // Forward again must return to 7, not roll a new number.
    history = advance(history, 10, sequence(0.2))
    expect(currentIndex(history)).toBe(7)
    expect(history.items).toEqual([3, 7])
  })

  it('appends once the user advances past the end of history', () => {
    let history = startHistory(3)
    history = advance(history, 10, sequence(0.7))
    history = retreat(history)
    history = advance(history, 10, sequence(0.2))
    history = advance(history, 10, sequence(0.2))

    expect(history.items).toEqual([3, 7, 2])
    expect(currentIndex(history)).toBe(2)
  })

  it('does not move when there is nothing to pick', () => {
    const history = startHistory(0)
    expect(advance(history, 0)).toBe(history)
  })
})

describe('picking from a narrowed set', () => {
  it('only ever picks one of the candidates', () => {
    const candidates = [3, 8, 13]
    for (let i = 0; i < 50; i += 1) expect(candidates).toContain(pickRandomFrom(candidates))
  })

  it('avoids what was just shown when it can', () => {
    const picks = new Set<number | null>()
    for (let i = 0; i < 50; i += 1) picks.add(pickRandomFrom([3, 8], { recent: [3] }))
    expect(picks).toEqual(new Set([8]))
  })

  it('has nothing to pick from an empty set', () => {
    expect(pickRandomFrom([])).toBeNull()
  })
})

describe('shuffle narrowed to one kind', () => {
  it('only ever steps to a candidate', () => {
    const candidates = [2, 5, 9]
    let history = startHistory(5)
    for (let i = 0; i < 20; i += 1) {
      history = advance(history, 10, undefined, candidates)
      expect(candidates).toContain(currentIndex(history))
    }
  })

  it('stays put when nothing of that kind is showing', () => {
    const history = startHistory(3)
    expect(advance(history, 10, undefined, [])).toBe(history)
  })
})
