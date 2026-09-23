import { describe, expect, it } from 'vitest'
import { hamming, popcount64 } from '../src/main/db/hamming'

describe('popcount64', () => {
  it('counts bits across the full 64-bit width', () => {
    expect(popcount64(0n)).toBe(0)
    expect(popcount64(1n)).toBe(1)
    expect(popcount64(0xffn)).toBe(8)
    expect(popcount64(0xffffffffffffffffn)).toBe(64)
    // The high bit alone — the case a naive Number-based implementation loses.
    expect(popcount64(0x8000000000000000n)).toBe(1)
    expect(popcount64(0xaaaaaaaaaaaaaaaan)).toBe(32)
  })
})

describe('hamming', () => {
  it('reports zero distance for identical hashes', () => {
    expect(hamming('0123456789abcdef', '0123456789abcdef')).toBe(0)
  })

  it('reports maximum distance for inverted hashes', () => {
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64)
  })

  it('counts a single differing bit', () => {
    expect(hamming('0000000000000000', '0000000000000001')).toBe(1)
  })

  it('does not lose precision in the high bits', () => {
    // 0x8000... vs 0x0000... differs only above 2^53, where a double would round.
    expect(hamming('8000000000000000', '0000000000000000')).toBe(1)
    expect(hamming('ffffffffffffffff', '7fffffffffffffff')).toBe(1)
  })

  it('is case-insensitive', () => {
    expect(hamming('ABCDEF0123456789', 'abcdef0123456789')).toBe(0)
  })

  it('returns null when either hash is absent, so SQL filters exclude the row', () => {
    expect(hamming(null, '0000000000000000')).toBeNull()
    expect(hamming('0000000000000000', null)).toBeNull()
    expect(hamming(null, null)).toBeNull()
  })

  it('returns null for malformed hashes rather than guessing', () => {
    expect(hamming('short', '0000000000000000')).toBeNull()
    expect(hamming('zzzzzzzzzzzzzzzz', '0000000000000000')).toBeNull()
    expect(hamming('0000000000000000000', '0000000000000000')).toBeNull()
  })
})
