import { describe, expect, it } from 'vitest'
import { collapseIdenticalContent } from '../src/main/db/duplicates'

/**
 * Byte-identical copies share a perceptual hash, so they always land in the same
 * near-duplicate component as anything either of them resembles. Collapsing them
 * to one representative is what keeps a file from being listed — and its bytes
 * counted as reclaimable — twice over.
 */
describe('collapseIdenticalContent', () => {
  const hashes = (entries: [number, string | null][]): Map<number, string | null> =>
    new Map(entries)

  it('leaves a group of genuinely distinct files alone', () => {
    const map = hashes([
      [1, 'aaa'],
      [2, 'bbb'],
      [3, 'ccc'],
    ])

    expect(collapseIdenticalContent([1, 2, 3], map)).toEqual([1, 2, 3])
  })

  it('keeps one representative per content hash', () => {
    // 1 and 2 are the same bytes; the exact group already reports that pair.
    const map = hashes([
      [1, 'aaa'],
      [2, 'aaa'],
      [3, 'bbb'],
    ])

    expect(collapseIdenticalContent([1, 2, 3], map)).toEqual([1, 3])
  })

  it('collapses a group of nothing but identical copies to a single item', () => {
    // The caller drops this: it is an exact duplicate, not a near one.
    const map = hashes([
      [1, 'aaa'],
      [2, 'aaa'],
      [3, 'aaa'],
    ])

    expect(collapseIdenticalContent([1, 2, 3], map)).toHaveLength(1)
  })

  it('picks the same representative whatever order the ids arrive in', () => {
    // Identical content means an identical size, so there is no biggest copy to
    // prefer — only the lowest id keeps two runs from disagreeing.
    const map = hashes([
      [7, 'aaa'],
      [3, 'aaa'],
      [9, 'aaa'],
      [5, 'bbb'],
    ])

    expect(collapseIdenticalContent([7, 3, 9, 5], map)).toEqual([3, 5])
    expect(collapseIdenticalContent([9, 5, 3, 7], map)).toEqual([3, 5])
  })

  it('never merges files that have not been hashed yet', () => {
    // A missing hash means "not known to be identical", which is not the same as
    // "identical to the other unhashed ones".
    const map = hashes([
      [1, null],
      [2, null],
      [3, 'aaa'],
    ])

    expect(collapseIdenticalContent([1, 2, 3], map)).toEqual([1, 2, 3])
  })

  it('does not confuse a missing hash with a real one that looks like its key', () => {
    const map = hashes([
      [1, null],
      [2, 'id:1'],
    ])

    expect(collapseIdenticalContent([1, 2], map)).toHaveLength(2)
  })
})
