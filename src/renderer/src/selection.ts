/**
 * Working out which copies to mark for deletion.
 *
 * Kept apart from the component (free of any React or DOM import) so the rule
 * that stops a group being emptied can be tested directly — it is the one piece
 * of this screen where being wrong costs somebody a file.
 */

import type { DuplicateGroup } from '@shared/types'

/**
 * The ids between two grid positions, inclusive, in either direction.
 *
 * Shift-clicking upwards is as ordinary as shift-clicking downwards, and an
 * index can point past the end of the list when rows were trashed between the
 * anchor being set and the range being drawn — so the bounds are sorted and
 * clamped rather than trusted.
 */
export function rangeBetween(all: readonly number[], from: number, to: number): number[] {
  if (all.length === 0) return []

  const low = Math.max(0, Math.min(from, to))
  const high = Math.min(all.length - 1, Math.max(from, to))
  if (low > high) return []

  return all.slice(low, high + 1)
}

/**
 * Marks every copy except the largest, for each of `within`. Favorites are never
 * marked: hearting a copy is as clear a "keep this one" as the user can give.
 *
 * The same file can belong to two groups — an exact copy of one thing and a near
 * copy of another — so marking "all but the largest" group by group can leave
 * some *other* group with every one of its copies marked. Since the only thing
 * this feeds is a button that moves files to the Trash, a group that would be
 * emptied gets its largest copy put back: whatever else happens, one of
 * everything survives.
 *
 * `all` is every group on screen, not just the ones being marked, because the
 * group that ends up emptied is rarely the one that was clicked.
 */
export function markAllButLargest(
  current: Set<number>,
  within: DuplicateGroup[],
  all: DuplicateGroup[],
): Set<number> {
  const next = new Set(current)

  for (const group of within) {
    for (const item of group.items.slice(1)) {
      if (item.favoritedAt === null) next.add(item.id)
    }
  }

  // Putting a copy back can only ever satisfy more groups, never fewer, so a
  // single pass settles it.
  for (const group of all) {
    if (group.items.some((item) => !next.has(item.id))) continue
    const largest = group.items[0]
    if (largest) next.delete(largest.id)
  }

  return next
}
