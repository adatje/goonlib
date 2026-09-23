/**
 * Deciding what the toy does when several things want it at once.
 *
 * The rules: a playing video has the toy to itself, a pattern of yours waits
 * for it and takes over again when it stops, a guest is never held back, one
 * intensity scales all of them, and a stopped toy gets nothing at all no
 * matter who is asking.
 */

import { describe, expect, it } from 'vitest'
import type { ToyScript } from '../src/shared/toy'
import { mix, positionNow, StrokeFollower } from '../src/main/toy/driver'
import type { Anchor, MixInput } from '../src/main/toy/driver'
import { TOY_DEFAULTS } from '../src/main/toy/prefs'

const flat: ToyScript = { kind: 'levels', stepMs: 100, levels: new Array(100).fill(0.5) }

function input(overrides: Partial<MixInput> = {}): MixInput {
  return {
    armed: true,
    prefs: { ...TOY_DEFAULTS, leadMs: 0 },
    anchor: { mediaId: 1, playing: true, positionMs: 0, rate: 1, at: 0 },
    script: flat,
    manual: null,
    guestLevel: 0,
    ...overrides,
  }
}

describe('following the video', () => {
  it('projects the position forward from the last report', () => {
    const anchor: Anchor = { mediaId: 1, playing: true, positionMs: 1000, rate: 2, at: 5000 }
    expect(positionNow(anchor, 5500)).toBe(2000)
    expect(positionNow({ ...anchor, playing: false }, 9999)).toBe(1000)
  })

  it('plays the script while the video plays, and nothing while it is paused', () => {
    expect(mix(input(), 1000)).toBe(0.5)
    expect(mix(input({ anchor: { ...input().anchor!, playing: false } }), 1000)).toBe(0)
  })

  it('reads ahead by the lead, to make up for Bluetooth lag', () => {
    const script: ToyScript = { kind: 'levels', stepMs: 100, levels: [0, 0, 1] }
    const early = input({ script, prefs: { ...TOY_DEFAULTS, leadMs: 150 } })
    // 50 ms in, the picture is at step 0 but the toy is already at step 2.
    expect(mix(early, 50)).toBe(1)
  })

  it('ignores the script when following videos is turned off', () => {
    expect(mix(input({ prefs: { ...TOY_DEFAULTS, followVideo: false } }), 1000)).toBe(0)
  })
})

describe('several sources at once', () => {
  const manual = { pattern: 'steady' as const, intensity: 0.8, startedAt: 0 }
  const paused = { mediaId: 1, playing: false, positionMs: 0, rate: 1, at: 0 }

  it('holds a pattern back while a video is playing, and lets it through again after', () => {
    // The video's own curve is what you came for, so the pattern waits.
    expect(mix(input({ manual }), 1000)).toBe(0.5)
    expect(mix(input({ manual, anchor: paused }), 1000)).toBe(0.8)
    expect(mix(input({ manual, script: null }), 1000)).toBe(0.8)
    expect(mix(input({ manual, prefs: { ...TOY_DEFAULTS, leadMs: 0, followVideo: false } }), 1000)).toBe(0.8)
  })

  it('never holds a guest back, whatever else is running', () => {
    expect(mix(input({ manual, guestLevel: 0.9 }), 1000)).toBe(0.9)
    expect(mix(input({ guestLevel: 0.9 }), 1000)).toBe(0.9)
  })

  it('scales every source by the one intensity', () => {
    const prefs = { ...TOY_DEFAULTS, leadMs: 0, maxIntensity: 0.3 }
    expect(mix(input({ prefs, guestLevel: 1 }), 1000)).toBe(0.3)
    expect(mix(input({ prefs, guestLevel: 0.5 }), 1000)).toBeCloseTo(0.15)
  })

  it('gives nothing at all while stopped', () => {
    const manual = { pattern: 'steady' as const, intensity: 1, startedAt: 0 }
    expect(mix(input({ armed: false, manual, guestLevel: 1 }), 1000)).toBe(0)
  })
})

describe('a stroker following a funscript', () => {
  const actions = [
    { at: 0, pos: 0 },
    { at: 400, pos: 100 },
    { at: 800, pos: 0 },
  ]

  it('is sent each move once, aimed at where the video is heading', () => {
    const follower = new StrokeFollower()
    expect(follower.next(actions, 100)).toEqual({ position: 1, durationMs: 300 })
    // Still on the way there: nothing new to say.
    expect(follower.next(actions, 200)).toBeNull()
    expect(follower.next(actions, 450)).toEqual({ position: 0, durationMs: 350 })
    expect(follower.next(actions, 900)).toBeNull()
  })

  it('starts over from wherever the video now is after a reset', () => {
    const follower = new StrokeFollower()
    follower.next(actions, 100)
    follower.reset()
    expect(follower.next(actions, 150)).toEqual({ position: 1, durationMs: 250 })
  })
})
