/**
 * Turning a video's position into how hard the toy should go.
 *
 * These are the rules a user actually feels: a script must go quiet between
 * scenes, fast strokes must buzz harder than slow ones, and a stop must mean
 * zero — not the faint hum a rounded-up 1% becomes on a real motor.
 */

import { describe, expect, it } from 'vitest'
import {
  actionIndexAt,
  curveOf,
  FULL_SPEED,
  levelAt,
  parseFunscript,
  patternLevel,
  shapeBuzz,
  toSteps,
} from '../src/shared/toy'
import type { ToyScript } from '../src/shared/toy'

describe('reading a funscript', () => {
  it('sorts, clamps and deduplicates what real editors write', () => {
    const actions = parseFunscript(
      JSON.stringify({
        actions: [
          { at: 1000, pos: 120 },
          { at: 0, pos: -5 },
          { at: 500, pos: 40 },
          { at: 500, pos: 60 },
          { at: 'soon', pos: 10 },
        ],
      }),
    )
    expect(actions).toEqual([
      { at: 0, pos: 0 },
      { at: 500, pos: 60 },
      { at: 1000, pos: 100 },
    ])
  })

  it('flips an inverted script once, here', () => {
    const actions = parseFunscript(
      JSON.stringify({ inverted: true, actions: [{ at: 0, pos: 10 }, { at: 100, pos: 90 }] }),
    )
    expect(actions.map((a) => a.pos)).toEqual([90, 10])
  })

  it('says so when a file is not a funscript at all', () => {
    expect(() => parseFunscript('not json')).toThrow(/not valid JSON/)
    expect(() => parseFunscript('{"version":"1.0"}')).toThrow(/no actions/)
    expect(() => parseFunscript('{"actions":[{"at":0,"pos":0}]}')).toThrow(/fewer than two/)
  })
})

describe('finding the current action', () => {
  const actions = [0, 100, 200, 300].map((at) => ({ at, pos: 0 }))

  it('is -1 before the first, and the last one at or before otherwise', () => {
    expect(actionIndexAt(actions, -1)).toBe(-1)
    expect(actionIndexAt(actions, 0)).toBe(0)
    expect(actionIndexAt(actions, 150)).toBe(1)
    expect(actionIndexAt(actions, 300)).toBe(3)
    expect(actionIndexAt(actions, 9999)).toBe(3)
  })
})

describe('how hard a stroke script buzzes', () => {
  // A slow full stroke, then a fast one, then nothing for a while.
  const script: ToyScript = {
    kind: 'strokes',
    actions: [
      { at: 0, pos: 0 },
      { at: 1000, pos: 100 },
      { at: 1125, pos: 0 },
      { at: 5000, pos: 0 },
    ],
  }

  it('buzzes harder the faster the stroke', () => {
    const slow = levelAt(script, 500)
    const fast = levelAt(script, 1100)
    expect(slow).toBeCloseTo(100 / FULL_SPEED)
    // 100 positions in an eighth of a second is past flat out, so it clips.
    expect(fast).toBe(1)
    expect(fast).toBeGreaterThan(slow)
  })

  it('goes quiet where the script holds still, and outside it', () => {
    expect(levelAt(script, 3000)).toBe(0)
    expect(levelAt(script, -100)).toBe(0)
    expect(levelAt(script, 6000)).toBe(0)
  })

  it('can follow depth instead of speed', () => {
    expect(levelAt(script, 500, 'position')).toBeCloseTo(0.5)
    expect(levelAt(script, 1000, 'position')).toBeCloseTo(1)
  })
})

describe('a level script, as the soundtrack produces', () => {
  it('reads the step the moment falls in', () => {
    const script: ToyScript = { kind: 'levels', stepMs: 100, levels: [0, 0.5, 1] }
    expect(levelAt(script, 50)).toBe(0)
    expect(levelAt(script, 150)).toBe(0.5)
    expect(levelAt(script, 299)).toBe(1)
    expect(levelAt(script, 300)).toBe(0)
  })
})

describe('patterns', () => {
  it('pulses half a second on, half off', () => {
    expect(patternLevel('pulse', 0.8, 100)).toBe(0.8)
    expect(patternLevel('pulse', 0.8, 700)).toBe(0)
    expect(patternLevel('pulse', 0.8, 1100)).toBe(0.8)
  })

  it('builds over the length it was given, or repeats when open-ended', () => {
    expect(patternLevel('escalate', 1, 2500, 5000)).toBeCloseTo(0.5)
    expect(patternLevel('escalate', 1, 5000, 5000)).toBe(1)
    expect(patternLevel('escalate', 1, 12_500)).toBeCloseTo(0.25)
  })

  it('never goes past the strength asked for', () => {
    for (let t = 0; t < 3000; t += 37) {
      expect(patternLevel('wave', 0.6, t)).toBeLessThanOrEqual(0.6)
    }
  })
})

describe('rounding onto motor steps', () => {
  it('keeps a near-zero level off, rather than rounding it up to a hum', () => {
    expect(toSteps(0.01, 20)).toBe(0)
    expect(toSteps(0, 20)).toBe(0)
  })

  it('reaches the top step, and no further', () => {
    expect(toSteps(1, 20)).toBe(20)
    expect(toSteps(3, 20)).toBe(20)
    expect(toSteps(Number.NaN, 20)).toBe(0)
  })
})

describe("shaping a guest's buzz", () => {
  const limits = { maxIntensity: 0.6, maxSeconds: 10 }

  it("holds strength and length to the host's ceilings, whatever was sent", () => {
    expect(shapeBuzz({ pattern: 'pulse', intensity: 5, seconds: 600 }, limits)).toEqual({
      pattern: 'pulse',
      intensity: 0.6,
      durationMs: 10_000,
    })
  })

  it('turns away anything that is not a known pattern and two numbers', () => {
    expect(shapeBuzz({ pattern: 'rm -rf', intensity: 0.5, seconds: 2 }, limits)).toBeNull()
    expect(shapeBuzz({ pattern: 'pulse', intensity: 'lots', seconds: 2 }, limits)).toBeNull()
    expect(shapeBuzz(null, limits)).toBeNull()
  })
})

describe('the curve drawn under the player', () => {
  it('keeps each bucket\'s strongest moment, so a short hit still shows', () => {
    const levels = new Array<number>(100).fill(0)
    levels[37] = 0.9 // one tenth of a second, in a ten-second video
    const curve = curveOf({ kind: 'levels', stepMs: 100, levels }, 10_000, 10)
    expect(curve).toEqual([0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0])
  })

  it('draws a stroke script as the strength it would be felt at', () => {
    const script: ToyScript = {
      kind: 'strokes',
      actions: [
        { at: 0, pos: 0 },
        { at: 1000, pos: 100 },
        { at: 2000, pos: 100 },
      ],
    }
    const curve = curveOf(script, 2000, 2)
    expect(curve[0]).toBeCloseTo(100 / FULL_SPEED, 2)
    expect(curve[1]).toBe(0)
  })

  it('is flat for a video with no length yet', () => {
    expect(curveOf({ kind: 'levels', stepMs: 100, levels: [1] }, 0, 5)).toEqual([0, 0, 0, 0, 0])
  })
})
