import { describe, expect, it } from 'vitest'
import { hamming } from '../src/main/db/hamming'
import { HASH_SIZE, hashBands, perceptualHash } from '../src/main/scan/phash'

/** A HASH_SIZE² greyscale buffer produced by `shade(x, y)`. */
function image(shade: (x: number, y: number) => number): Uint8Array {
  const pixels = new Uint8Array(HASH_SIZE * HASH_SIZE)
  for (let y = 0; y < HASH_SIZE; y += 1) {
    for (let x = 0; x < HASH_SIZE; x += 1) {
      pixels[y * HASH_SIZE + x] = Math.max(0, Math.min(255, Math.round(shade(x, y))))
    }
  }
  return pixels
}

/**
 * Broad-spectrum textures, which is what a photograph looks like to a DCT.
 * Synthetic shapes are deliberately *not* used as the happy path here: a
 * checkerboard or a gradient has almost no frequency content and is exactly the
 * degenerate case the implementation now refuses.
 */
const photo = (x: number, y: number): number =>
  128 + 90 * Math.sin(x / 3 + y / 5) + 40 * Math.cos(x / 7 - y / 2)

const otherPhoto = (x: number, y: number): number =>
  128 + 90 * Math.sin(y / 2 - x / 6) + 40 * Math.cos(x / 3 + y / 9)

/** Deterministic pseudo-noise, so nothing here can flake. */
function withNoise(shade: (x: number, y: number) => number, amplitude: number): Uint8Array {
  let seed = 99
  return image((x, y) => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return shade(x, y) + ((seed % (amplitude * 2 + 1)) - amplitude)
  })
}

describe('perceptualHash', () => {
  it('returns a 16-character hex hash for an image with real structure', () => {
    expect(perceptualHash(image(photo))).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is deterministic', () => {
    expect(perceptualHash(image(photo))).toBe(perceptualHash(image(photo)))
  })

  it('is unchanged by noise, which is what a re-encode looks like', () => {
    // The whole point of a perceptual hash: the same clip downloaded twice at
    // different qualities must land on the same fingerprint.
    const distance = hamming(perceptualHash(image(photo)), perceptualHash(withNoise(photo, 4)))
    expect(distance).toBe(0)
  })

  it('separates genuinely different images well beyond the match threshold', () => {
    const distance = hamming(perceptualHash(image(photo)), perceptualHash(image(otherPhoto)))
    expect(distance as number).toBeGreaterThan(12)
  })

  it('splits the bits roughly evenly, as a median split should', () => {
    const hash = perceptualHash(image(photo))
    const ones = [...(hash as string)]
      .map((c) => parseInt(c, 16).toString(2).padStart(4, '0'))
      .join('')
      .split('')
      .filter((bit) => bit === '1').length

    expect(ones).toBeGreaterThanOrEqual(16)
    expect(ones).toBeLessThanOrEqual(48)
  })
})

describe('perceptualHash — images it refuses to fingerprint', () => {
  // Each of these has so little frequency content that its coefficients tie with
  // the median, collapsing the hash toward all-zeros. Two unrelated featureless
  // images would then look identical — unacceptable when the result feeds a
  // screen that offers to delete files.

  it('refuses a solid colour', () => {
    expect(perceptualHash(image(() => 128))).toBeNull()
  })

  it('refuses a black frame', () => {
    expect(perceptualHash(image(() => 0))).toBeNull()
  })

  it('refuses a plain gradient', () => {
    expect(perceptualHash(image((x, y) => x * 4 + y * 2))).toBeNull()
  })

  it('refuses a flat checkerboard', () => {
    expect(perceptualHash(image((x, y) => ((((x >> 2) ^ (y >> 2)) & 1) ? 210 : 35)))).toBeNull()
  })

  it('rejects a buffer that is too small rather than hashing garbage', () => {
    expect(() => perceptualHash(new Uint8Array(10))).toThrow(/greyscale pixels/)
  })
})

describe('hashBands', () => {
  it('splits a hash into eight labelled one-byte bands', () => {
    expect(hashBands('0123456789abcdef')).toEqual([
      '0:01',
      '1:23',
      '2:45',
      '3:67',
      '4:89',
      '5:ab',
      '6:cd',
      '7:ef',
    ])
  })

  it('labels bands by position, so equal bytes in different slots never collide', () => {
    expect(new Set(hashBands('aaaaaaaaaaaaaaaa')).size).toBe(8)
  })

  it('shares a band with any hash within the pigeonhole bound', () => {
    // Flipping bits in only seven of the eight bands leaves one band intact, which
    // is what guarantees the bucketing finds every near-duplicate pair.
    const base = '0000000000000000'
    const nearby = '1111111100000000'

    const shared = hashBands(base).filter((band) => hashBands(nearby).includes(band))
    expect(shared.length).toBeGreaterThan(0)
  })
})
