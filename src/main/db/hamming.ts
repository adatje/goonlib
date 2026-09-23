/**
 * Hamming distance between two 64-bit perceptual hashes, each given as 16 hex
 * characters.
 *
 * Kept in its own module (free of any electron/sqlite import) so it can be unit
 * tested directly and registered as a SQLite UDF from db/index.ts.
 */

const U64 = 0xffffffffffffffffn

/** Population count of a 64-bit value, via the standard SWAR bit trick. */
export function popcount64(v: bigint): number {
  let x = v & U64
  x = x - ((x >> 1n) & 0x5555555555555555n)
  x = (x & 0x3333333333333333n) + ((x >> 2n) & 0x3333333333333333n)
  x = (x + (x >> 4n)) & 0x0f0f0f0f0f0f0f0fn
  // The final step sums the bytes by multiplying and reading the top one. The C
  // original depends on uint64 multiplication wrapping; BigInt keeps every carry
  // bit instead, so the product must be masked back to 64 bits before shifting.
  return Number(((x * 0x0101010101010101n) & U64) >> 56n)
}

const HEX64 = /^[0-9a-fA-F]{16}$/

/**
 * Returns the number of differing bits, or `null` when either hash is absent or
 * malformed — SQL treats that as "unknown", which correctly excludes the row from
 * any `hamming(...) <= threshold` filter.
 */
export function hamming(a: string | null, b: string | null): number | null {
  if (a === null || b === null) return null
  if (!HEX64.test(a) || !HEX64.test(b)) return null
  return popcount64(BigInt(`0x${a}`) ^ BigInt(`0x${b}`))
}
