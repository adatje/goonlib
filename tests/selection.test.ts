import { describe, expect, it } from 'vitest'
import type { DuplicateGroup, MediaItem } from '@shared/types'
import { markAllButLargest, rangeBetween } from '../src/renderer/src/selection'

/**
 * The screen this feeds moves files to the Trash, so the property that matters
 * is not which copies get marked but which one does not: every group has to come
 * out of this with at least one copy left standing.
 */

/**
 * A group of `[id, size]` pairs, largest first as buildGroup leaves them.
 * `favorites` are the ids the user has hearted.
 */
function group(
  key: string,
  items: [number, number][],
  favorites: number[] = [],
  names: Record<number, string> = {},
): DuplicateGroup {
  return {
    key,
    kind: 'exact',
    distance: 0,
    items: [...items]
      .sort((a, b) => b[1] - a[1])
      .map(
        ([id, size]) =>
          ({
            id,
            size,
            // Plain by default, so only the tests that care about copy
            // suffixes have to say anything about names.
            name: names[id] ?? `${id}.webm`,
            favoritedAt: favorites.includes(id) ? 1 : null,
          }) as MediaItem,
      ),
    reclaimable: 0,
  }
}

const ids = (selection: Set<number>): number[] => [...selection].sort((a, b) => a - b)

describe('markAllButLargest', () => {
  it('marks every copy but the largest', () => {
    const a = group('a', [
      [1, 300],
      [2, 200],
      [3, 100],
    ])

    expect(ids(markAllButLargest(new Set(), [a], [a]))).toEqual([2, 3])
  })

  it('keeps what was already marked', () => {
    const a = group('a', [
      [1, 300],
      [2, 200],
    ])
    const b = group('b', [
      [3, 300],
      [4, 200],
    ])

    expect(ids(markAllButLargest(new Set([4]), [a], [a, b]))).toEqual([2, 4])
  })

  it('marks across every group at once', () => {
    const a = group('a', [
      [1, 300],
      [2, 200],
    ])
    const b = group('b', [
      [3, 300],
      [4, 200],
    ])

    expect(ids(markAllButLargest(new Set(), [a, b], [a, b]))).toEqual([2, 4])
  })

  it('never leaves a group with every copy marked', () => {
    // 2 is the largest of its own group but a lesser copy of `a`, so marking
    // `a` would otherwise wipe out both copies in `b`.
    const a = group('a', [
      [1, 300],
      [2, 200],
    ])
    const b = group('b', [
      [2, 200],
      [3, 100],
    ])

    const marked = markAllButLargest(new Set(), [a, b], [a, b])

    expect(b.items.some((item) => !marked.has(item.id))).toBe(true)
    expect(ids(marked)).toEqual([3])
  })

  it('protects a group the user did not click', () => {
    const a = group('a', [
      [1, 300],
      [2, 200],
    ])
    const b = group('b', [
      [2, 200],
      [3, 100],
    ])

    // Only `a` is marked, but `b` is the group that would have been emptied.
    const marked = markAllButLargest(new Set([3]), [a], [a, b])

    expect(b.items.some((item) => !marked.has(item.id))).toBe(true)
  })

  it('leaves something standing in every group of a long overlapping chain', () => {
    // Each group shares a copy with the next, which is where a single-pass fix
    // would come unstuck if putting one back could empty another.
    const chain = [
      group('a', [
        [1, 400],
        [2, 300],
      ]),
      group('b', [
        [2, 300],
        [3, 200],
      ]),
      group('c', [
        [3, 200],
        [4, 100],
      ]),
    ]

    const marked = markAllButLargest(new Set(), chain, chain)

    for (const g of chain) {
      expect(g.items.some((item) => !marked.has(item.id)), `group ${g.key}`).toBe(true)
    }
  })

  it('keeps the favorite instead of the largest, not as well as it', () => {
    const a = group(
      'a',
      [
        [1, 300],
        [2, 200],
        [3, 100],
      ],
      [2],
    )

    // 2 is hearted, so it is the copy that survives and the largest goes with
    // the rest. Sparing both left two standing, which is not "all but one".
    expect(ids(markAllButLargest(new Set(), [a], [a]))).toEqual([1, 3])
  })

  it('keeps every favorite in a group', () => {
    const a = group(
      'a',
      [
        [1, 300],
        [2, 200],
        [3, 100],
      ],
      [2, 3],
    )

    expect(ids(markAllButLargest(new Set(), [a], [a]))).toEqual([1])
  })

  it('leaves a group of nothing but favorites alone', () => {
    const a = group(
      'a',
      [
        [1, 300],
        [2, 200],
      ],
      [1, 2],
    )

    expect(ids(markAllButLargest(new Set(), [a], [a]))).toEqual([])
  })

  it('keeps the unsuffixed name over a "(1)" of the same size', () => {
    const a = group(
      'a',
      [
        [1, 300],
        [2, 300],
        [3, 300],
      ],
      [],
      { 1: 'clip (1).webm', 2: 'clip (1).webm', 3: 'clip.webm' },
    )

    // Equal sizes leave the largest-first order to break the tie, which used
    // to hand it to whichever suffixed copy happened to sort first.
    expect(ids(markAllButLargest(new Set(), [a], [a]))).toEqual([1, 2])
  })

  it('falls back to the largest when every name is a copy', () => {
    const a = group(
      'a',
      [
        [1, 300],
        [2, 200],
      ],
      [],
      { 1: 'clip (1).webm', 2: 'clip copy.webm' },
    )

    expect(ids(markAllButLargest(new Set(), [a], [a]))).toEqual([2])
  })

  it('lets a favorite outrank a plain name', () => {
    const a = group(
      'a',
      [
        [1, 300],
        [2, 200],
      ],
      [2],
      { 1: 'clip.webm', 2: 'clip (1).webm' },
    )

    expect(ids(markAllButLargest(new Set(), [a], [a]))).toEqual([1])
  })

  it('is idempotent', () => {
    const a = group('a', [
      [1, 300],
      [2, 200],
    ])
    const b = group('b', [
      [2, 200],
      [3, 100],
    ])

    const once = markAllButLargest(new Set(), [a, b], [a, b])
    const twice = markAllButLargest(once, [a, b], [a, b])

    expect(ids(twice)).toEqual(ids(once))
  })
})

/**
 * Shift-click ranges. The indices come from the grid and the ids from a cached
 * query, and those two can disagree — a scan or a trash can shorten the list
 * between the anchor being dropped and the range being drawn.
 */
describe('rangeBetween', () => {
  const all = [10, 20, 30, 40, 50]

  it('includes both ends', () => {
    expect(rangeBetween(all, 1, 3)).toEqual([20, 30, 40])
  })

  it('reads the same backwards', () => {
    expect(rangeBetween(all, 3, 1)).toEqual([20, 30, 40])
  })

  it('selects a single item when both ends are the same', () => {
    expect(rangeBetween(all, 2, 2)).toEqual([30])
  })

  it('spans the whole list', () => {
    expect(rangeBetween(all, 0, 4)).toEqual(all)
  })

  it('clamps an index that ran off the end', () => {
    // The list shrank under the anchor; take what still exists rather than
    // returning undefined holes into a delete.
    expect(rangeBetween(all, 3, 99)).toEqual([40, 50])
  })

  it('clamps a negative index', () => {
    expect(rangeBetween(all, -5, 1)).toEqual([10, 20])
  })

  it('never yields holes, whatever the bounds', () => {
    for (const [from, to] of [
      [0, 0],
      [-3, 99],
      [99, 99],
      [4, 0],
    ] as [number, number][]) {
      const span = rangeBetween(all, from, to)
      expect(span.every((id) => typeof id === 'number'), `${from}..${to}`).toBe(true)
    }
  })

  it('has nothing to select in an empty list', () => {
    expect(rangeBetween([], 0, 5)).toEqual([])
  })
})
