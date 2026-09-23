/**
 * Random selection for shuffle playback and R in the viewer.
 *
 * Two things matter here beyond "call Math.random":
 *
 *  - Shuffle should not keep serving the same handful of items. Naive random
 *    picking repeats surprisingly often — with 20 items you'd expect a repeat
 *    within about 5 picks — which reads as broken rather than random.
 *
 *  - Avoiding repeats must never be able to hang. The avoid-set is capped at half
 *    the library so a random guess always has at least even odds, which keeps the
 *    retry loop bounded no matter how long you leave shuffle running.
 *
 * Pure, with the random source injectable, so the behaviour is actually testable.
 */

/** Never exclude more than this fraction of the library from selection. */
const MAX_AVOID_FRACTION = 0.5

/** Attempts before accepting a repeat. With ≥50% odds, exhausting this is remote. */
const MAX_ATTEMPTS = 40

export interface PickOptions {
  /** Most recently played indices, newest last. */
  recent?: readonly number[]
  random?: () => number
}

/**
 * Picks an index in [0, total), preferring one not among `recent`.
 * Returns null when there is nothing to pick from.
 */
export function pickRandomIndex(total: number, options: PickOptions = {}): number | null {
  const { recent = [], random = Math.random } = options

  if (!Number.isFinite(total) || total <= 0) return null
  if (total === 1) return 0

  // Cap how much history we honour, so selection can never paint itself into a
  // corner and start failing every attempt.
  const avoidCount = Math.min(recent.length, Math.floor(total * MAX_AVOID_FRACTION))
  const avoid = new Set(avoidCount > 0 ? recent.slice(-avoidCount) : [])

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const index = Math.floor(random() * total)
    // Guard against a random source that returns exactly 1.
    const clamped = Math.min(total - 1, Math.max(0, index))
    if (!avoid.has(clamped)) return clamped
  }

  // Every attempt collided. Fall back to the first index outside the avoid set,
  // and only then to a plain random pick.
  for (let index = 0; index < total; index += 1) {
    if (!avoid.has(index)) return index
  }

  return Math.min(total - 1, Math.max(0, Math.floor(random() * total)))
}

/**
 * A back/forward history of shuffled positions.
 *
 * Going back has to replay what you actually watched — picking a fresh random
 * item when the user asks for "previous" would make it impossible to return to
 * something you just saw, which is the main reason people press it.
 */
export interface ShuffleHistory {
  readonly items: readonly number[]
  /** Position within `items`; -1 when empty. */
  readonly pos: number
}

/**
 * Picks one of `candidates` — grid indices, not positions in the list —
 * preferring one not among `recent`, by the same rules as pickRandomIndex.
 * Used when Random is narrowed to videos or images: the candidates are where
 * those sit in the grid, and history is still kept in grid indices.
 */
export function pickRandomFrom(
  candidates: readonly number[],
  options: PickOptions = {},
): number | null {
  const position = new Map(candidates.map((index, at) => [index, at]))
  const recent = (options.recent ?? [])
    .map((index) => position.get(index))
    .filter((at): at is number => at !== undefined)
  const pick = pickRandomIndex(candidates.length, { ...options, recent })
  return pick === null ? null : (candidates[pick] ?? null)
}

export const emptyHistory: ShuffleHistory = { items: [], pos: -1 }

export function startHistory(index: number): ShuffleHistory {
  return { items: [index], pos: 0 }
}

/**
 * Advances one step. Replays forward through history if the user has stepped
 * back; otherwise picks a new index and appends it — from `candidates` when
 * shuffle is narrowed to videos or images, from the whole grid otherwise.
 */
export function advance(
  history: ShuffleHistory,
  total: number,
  random?: () => number,
  candidates?: readonly number[],
): ShuffleHistory {
  if (history.pos < history.items.length - 1) {
    return { items: history.items, pos: history.pos + 1 }
  }

  const next = candidates
    ? pickRandomFrom(candidates, { recent: history.items, random })
    : pickRandomIndex(total, { recent: history.items, random })
  if (next === null) return history

  // Trimming from the front keeps a long session from growing without bound.
  // Position is recomputed rather than incremented, since trimming shifts indices.
  const items = [...history.items, next].slice(-HISTORY_LIMIT)
  return { items, pos: items.length - 1 }
}

/** How far back shuffle remembers. Well beyond what anyone steps back through. */
export const HISTORY_LIMIT = 500

/** Steps back through what was actually played. Stays put at the beginning. */
export function retreat(history: ShuffleHistory): ShuffleHistory {
  if (history.pos <= 0) return history
  return { items: history.items, pos: history.pos - 1 }
}

/** The index currently pointed at, or null when the history is empty. */
export function currentIndex(history: ShuffleHistory): number | null {
  if (history.pos < 0 || history.pos >= history.items.length) return null
  return history.items[history.pos] ?? null
}
