/**
 * Holding a number to a range, which both processes need and each had its own
 * copy of - one flooring as it went, one not, which is exactly the kind of
 * difference that goes unnoticed until it matters.
 */

/** `value` held between `min` and `max`; anything that is not a number reads as `min`. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/** The same, rounded down to a whole number - for counts, limits and indexes. */
export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}

/** Held between 0 and 1, which is how levels, shares and confidences are carried. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
