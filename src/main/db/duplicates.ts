/**
 * Duplicate grouping.
 *
 * Exact duplicates come straight from SQL — identical content hashes, no
 * ambiguity. Near-duplicates are found in JavaScript rather than with a SQL
 * self-join: comparing every perceptual hash against every other is O(n²), which
 * is 7.5 million comparisons at 2,700 items and utterly hopeless at 100,000.
 * Bucketing by one-byte bands first reduces that to the pairs that could plausibly
 * match (see hashBands for why that's safe).
 */

import type { DuplicateGroup, MediaItem } from '@shared/types'
import { hamming } from './hamming'
import { getDb } from './index'
import { getMedia } from './media'
import { hashBands, MAX_RELIABLE_DISTANCE } from '../scan/phash'

/** Default Hamming distance for "looks like the same image". */
export const DEFAULT_DISTANCE = 6

export function findExactDuplicates(): DuplicateGroup[] {
  const rows = getDb()
    .prepare<[], { content_hash: string; ids: string }>(
      `SELECT m.content_hash, group_concat(m.id) AS ids
         FROM media m
         JOIN roots r ON r.id = m.root_id
        WHERE m.content_hash IS NOT NULL
          AND m.missing = 0
          AND r.enabled = 1
        GROUP BY m.content_hash
       HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC`,
    )
    .all()

  return rows
    .map((row) => buildGroup('exact', row.content_hash, parseIds(row.ids), 0))
    .filter((group): group is DuplicateGroup => group !== null)
}

export function findNearDuplicates(distance = DEFAULT_DISTANCE): DuplicateGroup[] {
  const threshold = Math.min(distance, MAX_RELIABLE_DISTANCE)

  const rows = getDb()
    .prepare<[], { id: number; phash: string; content_hash: string | null }>(
      `SELECT m.id, m.phash, m.content_hash
         FROM media m
         JOIN roots r ON r.id = m.root_id
        WHERE m.phash IS NOT NULL
          AND m.missing = 0
          AND r.enabled = 1`,
    )
    .all()

  // Bucket by band, so each item is only compared against plausible neighbours.
  const buckets = new Map<string, number[]>()
  const hashes = new Map<number, string>()
  const contentHashes = new Map<number, string | null>()

  for (const row of rows) {
    hashes.set(row.id, row.phash)
    contentHashes.set(row.id, row.content_hash)
    for (const band of hashBands(row.phash)) {
      const bucket = buckets.get(band)
      if (bucket) bucket.push(row.id)
      else buckets.set(band, [row.id])
    }
  }

  // Union-find over confirmed pairs, so a chain of similar images becomes one
  // group rather than a pile of overlapping pairs.
  const parent = new Map<number, number>()
  const find = (id: number): number => {
    let root = id
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) as number
    // Path compression keeps repeated lookups cheap on long chains.
    let walk = id
    while ((parent.get(walk) ?? walk) !== walk) {
      const next = parent.get(walk) as number
      parent.set(walk, root)
      walk = next
    }
    return root
  }
  const union = (a: number, b: number): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootA, rootB)
  }

  const compared = new Set<string>()

  for (const bucket of buckets.values()) {
    // A band shared by a huge number of items (flat colour, black frames) would
    // reintroduce the quadratic blow-up we came here to avoid.
    if (bucket.length < 2 || bucket.length > 400) continue

    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i] as number
        const b = bucket[j] as number

        const key = a < b ? `${a}:${b}` : `${b}:${a}`
        if (compared.has(key)) continue
        compared.add(key)

        const distanceBetween = hamming(hashes.get(a) ?? null, hashes.get(b) ?? null)
        if (distanceBetween !== null && distanceBetween <= threshold) union(a, b)
      }
    }
  }

  const grouped = new Map<number, number[]>()
  for (const id of hashes.keys()) {
    const root = find(id)
    if (root === id && (parent.get(id) ?? id) === id) {
      // Only a member of a group if something actually joined it.
    }
    const members = grouped.get(root)
    if (members) members.push(id)
    else grouped.set(root, [id])
  }

  const groups: DuplicateGroup[] = []

  for (const [root, members] of grouped) {
    if (members.length < 2) continue

    // Byte-identical copies share a perceptual hash, so they land in the same
    // component as anything either of them resembles. Listing all of them here
    // would repeat what the exact group already says, and count the same bytes
    // again in the reclaimable total — so one copy stands in for the set. A group
    // that was nothing but identical copies collapses to a single item and drops
    // out here, which is what should happen: it is not a near-duplicate at all.
    const representatives = collapseIdenticalContent(members, contentHashes)
    if (representatives.length < 2) continue

    const group = buildGroup('near', `phash:${root}`, representatives, threshold)
    if (group) groups.push(group)
  }

  // Biggest piles first — that's where the space is.
  return groups.sort((a, b) => b.items.length - a.items.length)
}

/**
 * Keeps one id per distinct content hash.
 *
 * Identical content means an identical file size, so there is no "biggest copy"
 * to prefer — the lowest id simply makes the choice deterministic between runs.
 * Items with no content hash yet are never merged; each stands alone.
 */
export function collapseIdenticalContent(
  ids: number[],
  contentHashes: Map<number, string | null>,
): number[] {
  const byContent = new Map<string, number>()

  for (const id of ids) {
    const hash = contentHashes.get(id) ?? null
    // Both sides are prefixed, so a stand-in key can never collide with a real
    // hash and quietly swallow an unrelated file.
    const key = hash === null ? `id:${id}` : `hash:${hash}`
    const existing = byContent.get(key)
    if (existing === undefined || id < existing) byContent.set(key, id)
  }

  return [...byContent.values()]
}

function parseIds(ids: string): number[] {
  return ids
    .split(',')
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value))
}

function buildGroup(
  kind: 'exact' | 'near',
  key: string,
  ids: number[],
  distance: number,
): DuplicateGroup | null {
  const items = ids
    .map((id) => getMedia(id))
    .filter((item): item is MediaItem => item !== null)

  if (items.length < 2) return null

  // Largest first: the biggest file is usually the one worth keeping, so it reads
  // as the default even though nothing is selected automatically.
  items.sort((a, b) => b.size - a.size)

  return {
    key,
    kind,
    distance,
    items,
    // What you'd reclaim by keeping exactly one.
    reclaimable: items.slice(1).reduce((total, item) => total + item.size, 0),
  }
}
