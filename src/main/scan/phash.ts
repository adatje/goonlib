/**
 * Perceptual hashing for near-duplicate detection.
 *
 * The classic DCT pHash: reduce to 32x32 greyscale, take the 2-D DCT, keep the
 * low-frequency 8x8 corner, and emit one bit per coefficient depending on whether
 * it sits above the median. The result survives re-encoding, rescaling, and mild
 * colour shifts, which is exactly what separates "the same clip downloaded twice"
 * from "a different clip".
 *
 * Pure maths on a pixel buffer — no image decoding here — so it can be tested
 * against synthetic inputs.
 */

import { popcount64 } from '../db/hamming'

/** Working size before the DCT. 32 is the usual choice: big enough to be stable. */
export const HASH_SIZE = 32

/** Side of the low-frequency block that actually becomes bits. 8x8 = 64 bits. */
export const LOW_FREQ = 8

/**
 * Precomputed DCT-II basis. Building this once turns the per-image cost into two
 * matrix multiplies instead of recomputing a cosine for every coefficient.
 */
const BASIS = buildBasis(HASH_SIZE)

function buildBasis(size: number): Float64Array {
  const basis = new Float64Array(size * size)

  for (let u = 0; u < size; u += 1) {
    const scale = u === 0 ? Math.sqrt(1 / size) : Math.sqrt(2 / size)
    for (let x = 0; x < size; x += 1) {
      basis[u * size + x] = scale * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size))
    }
  }

  return basis
}

/**
 * Coefficients are rounded to this many decimal places before anything is
 * compared.
 *
 * Without it, every coefficient that is mathematically zero — and on flat or
 * synthetic images that's most of them — ends up holding float rounding noise
 * around 1e-13. Comparing that against a median of zero makes those bits pure
 * chance, so merely brightening an image flipped a third of the hash. Quantising
 * sits far below any real signal and far above the noise.
 */
const QUANTUM = 1e6

/**
 * Acceptable range for the number of set bits.
 *
 * Splitting at the median should set about half of the 64 bits for any image with
 * real structure. A lopsided count means most coefficients *tied* with the median
 * — which happens when they're all zero, i.e. the image has almost no frequency
 * content. Those hashes collapse toward all-zeros and would match every other
 * featureless image. Since this feeds a screen offering to delete files, such
 * images get no perceptual hash rather than a misleading one.
 *
 * Checking the output directly catches every degenerate case; counting non-zero
 * coefficients beforehand does not, as a plain checkerboard demonstrated.
 */
const MIN_SET_BITS = 16
const MAX_SET_BITS = 48

/**
 * Computes the 64-bit hash of a greyscale HASH_SIZE x HASH_SIZE pixel buffer,
 * returned as 16 hex characters — or null when the image carries too little
 * detail to fingerprint meaningfully.
 */
export function perceptualHash(pixels: Uint8Array | Buffer): string | null {
  const n = HASH_SIZE
  if (pixels.length < n * n) {
    throw new Error(`Expected at least ${n * n} greyscale pixels, got ${pixels.length}`)
  }

  // Rows first, then columns — a separable 2-D DCT.
  const rows = new Float64Array(n * n)
  for (let y = 0; y < n; y += 1) {
    for (let u = 0; u < n; u += 1) {
      let sum = 0
      for (let x = 0; x < n; x += 1) {
        sum += (pixels[y * n + x] as number) * (BASIS[u * n + x] as number)
      }
      rows[y * n + u] = sum
    }
  }

  // Only the top-left LOW_FREQ columns survive, so the column pass can stop early.
  const coefficients = new Float64Array(LOW_FREQ * LOW_FREQ)
  for (let u = 0; u < LOW_FREQ; u += 1) {
    for (let v = 0; v < LOW_FREQ; v += 1) {
      let sum = 0
      for (let y = 0; y < n; y += 1) {
        sum += (rows[y * n + v] as number) * (BASIS[u * n + y] as number)
      }
      coefficients[u * LOW_FREQ + v] = sum
    }
  }

  const quantised = Array.from(coefficients).map((value) => Math.round(value * QUANTUM) / QUANTUM)

  // The DC term encodes overall brightness, which would make every dark image
  // look alike. Excluded from the median and from the bits.
  const ac = quantised.slice(1)
  const median = medianOf(ac)

  let hash = 0n
  for (let i = 0; i < 64; i += 1) {
    hash <<= 1n
    // Bit 0 is the DC slot; keeping it always-zero preserves a fixed 64-bit width.
    if (i > 0 && (quantised[i] as number) > median) hash |= 1n
  }

  const setBits = popcount64(hash)
  if (setBits < MIN_SET_BITS || setBits > MAX_SET_BITS) return null

  return hash.toString(16).padStart(16, '0')
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1

  if (sorted.length % 2 === 1) return sorted[middle] as number
  return (((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2)
}

/**
 * Splits a hash into 8 one-byte bands.
 *
 * Used to find candidate pairs without comparing everything to everything. By the
 * pigeonhole principle two hashes differing in at most 7 bits must agree on at
 * least one of 8 bands, so bucketing by band finds every pair within that
 * threshold while examining a tiny fraction of the n² possibilities.
 */
export function hashBands(hash: string): string[] {
  const bands: string[] = []
  for (let i = 0; i < 8; i += 1) {
    bands.push(`${i}:${hash.slice(i * 2, i * 2 + 2)}`)
  }
  return bands
}

/**
 * The largest Hamming distance the banding scheme is guaranteed to find. Beyond
 * this, pairs can be missed because they may differ in every band.
 */
export const MAX_RELIABLE_DISTANCE = 7
