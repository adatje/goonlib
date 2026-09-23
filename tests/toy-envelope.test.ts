/**
 * The soundtrack, turned into a strength curve.
 *
 * What matters is how it feels: silence and room tone stay off, loud moments
 * land at once, and the level eases down afterwards instead of cutting out.
 */

import { describe, expect, it } from 'vitest'
import { envelope } from '../src/main/toy/envelope'

const RATE = 1000

/** A tone at `amplitude` (0–1) for `ms` milliseconds. */
function tone(amplitude: number, ms: number): number[] {
  const count = (RATE * ms) / 1000
  return Array.from({ length: count }, (_, i) =>
    Math.round(Math.sin(i * 0.9) * amplitude * 32767),
  )
}

describe('audio envelope', () => {
  it('gives one level per step', () => {
    const levels = envelope(Int16Array.from(tone(0.5, 1000)), RATE, 100)
    expect(levels).toHaveLength(10)
  })

  it('stays off through near-silence, and is all zero for a silent track', () => {
    const quietThenLoud = Int16Array.from([...tone(0.01, 1000), ...tone(0.8, 1000)])
    const levels = envelope(quietThenLoud, RATE, 100)
    expect(levels.slice(0, 10).every((level) => level === 0)).toBe(true)
    expect(Math.max(...levels.slice(10))).toBe(1)

    expect(envelope(new Int16Array(RATE), RATE, 100).every((level) => level === 0)).toBe(true)
  })

  it('rises at once and eases down afterwards', () => {
    const hit = Int16Array.from([...tone(0.8, 500), ...new Array<number>(RATE).fill(0)])
    const levels = envelope(hit, RATE, 100)
    expect(levels[0]).toBeGreaterThan(0.9)
    // The step right after the hit is lower but not yet off.
    expect(levels[5]).toBeGreaterThan(0)
    expect(levels[5]).toBeLessThan(1)
    expect(levels.at(-1)).toBe(0)
  })
})

describe('a dense mix', () => {
  // A constant bed of treble with a bass hit every second, like a track with
  // hi-hats and synths running over a kick. The complaint this guards against:
  // the toy hovering at mid strength throughout, instead of hitting on the beat.
  const rate = 4000

  function mix(seconds: number): Int16Array {
    const samples = new Int16Array(rate * seconds)
    for (let i = 0; i < samples.length; i += 1) {
      const t = i / rate
      const bed = 0.3 * Math.sin(2 * Math.PI * 1500 * t)
      const inBeat = t % 1
      const kick = inBeat < 0.2 ? 0.6 * Math.sin(2 * Math.PI * 60 * t) * (1 - inBeat / 0.2) : 0
      samples[i] = Math.round((bed + kick) * 32767 * 0.9)
    }
    return samples
  }

  it('hits on the beat and drops well away between them', () => {
    const levels = envelope(mix(10), rate, 100)
    // Skip the first second, while the curve learns what the track sounds like.
    const onBeat = levels.filter((_, step) => step >= 10 && step % 10 === 0)
    const between = levels.filter((_, step) => step >= 10 && step % 10 >= 5)

    const average = (values: number[]): number =>
      values.reduce((sum, value) => sum + value, 0) / values.length

    expect(average(onBeat)).toBeGreaterThan(0.8)
    expect(average(between)).toBeLessThan(0.35)
  })
})
