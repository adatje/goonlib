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
 * Whether a filename is the kind a download or a copy leaves behind.
 *
 * "clip (1).webm", "clip copy.webm", "clip - Copy 2.webm": the browser and the
 * file manager both make these when something is saved twice, and the name
 * without the suffix is the one that was there first. Only the stem is looked
 * at, so an extension is never mistaken for part of the marker.
 */
export function looksLikeACopy(name: string): boolean {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  return /\s*\(\d+\)$/.test(stem) || /\s*-?\s*copy(\s*\d+)?$/i.test(stem)
}

/**
 * Marks every copy except the one being kept, for each of `within`.
 *
 * The keeper is normally the largest. A hearted copy takes that job instead -
 * hearting is as clear a "keep this one" as the user can give, and it should
 * decide *which* copy survives rather than merely add itself to the survivors.
 * Sparing the favourite and the largest both left two copies standing and made
 * the button look as though it had missed some.
 *
 * Every favourite in a group is kept, since each one is its own such answer;
 * a group that is favourites all the way down is simply left alone.
 *
 * Failing a favourite, a name that carries no "(1)" wins over one that does,
 * even against a slightly larger file. Copies of one video are usually byte
 * for byte the same size, which left the largest-first order to break the tie
 * arbitrarily and it kept picking the suffixed one.
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
    const favorited = group.items.filter((item) => item.favoritedAt !== null)
    // Largest first already, so the first unsuffixed name is the biggest one
    // of them, and items[0] is the fallback when every name is a copy.
    const plainest = group.items.find((item) => !looksLikeACopy(item.name)) ?? group.items[0]
    const keeping = new Set(
      (favorited.length > 0 ? favorited : plainest ? [plainest] : []).map((item) => item.id),
    )

    for (const item of group.items) {
      if (!keeping.has(item.id)) next.add(item.id)
    }
  }

  // Putting a copy back can only ever satisfy more groups, never fewer, so a
  // single pass settles it. Only groups with no favourite can reach here: a
  // favourited file is kept by every group it appears in, because it is
  // favourited in all of them.
  for (const group of all) {
    if (group.items.some((item) => !next.has(item.id))) continue
    // The same choice as above, so the copy that comes back is the one that
    // would have been kept had this group been the one clicked.
    const keeper = group.items.find((item) => !looksLikeACopy(item.name)) ?? group.items[0]
    if (keeper) next.delete(keeper.id)
  }

  return next
}
