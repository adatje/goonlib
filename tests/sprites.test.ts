import { describe, expect, it } from 'vitest'
import { planSprite } from '../src/main/scan/sprites'
import { cellPosition, sheetSize } from '../src/renderer/src/sprite'

describe('planSprite', () => {
  it('scales the frame count with duration', () => {
    // Roughly one frame per two seconds of footage.
    expect(planSprite(60_000).frames).toBe(32)
    expect(planSprite(20_000).frames).toBe(16)
  })

  it('never drops below a usable minimum', () => {
    // A four-second clip would otherwise get two frames, which isn't a scrub.
    expect(planSprite(4000).frames).toBeGreaterThanOrEqual(8)
  })

  it('caps the frame count so a feature film costs the same as a short', () => {
    expect(planSprite(2 * 60 * 60 * 1000).frames).toBeLessThanOrEqual(40)
  })

  it('always fills the tile grid exactly', () => {
    // A partly filled grid leaves blank cells that flash during a scrub.
    for (const duration of [3000, 10_000, 45_000, 300_000, 7_200_000]) {
      const plan = planSprite(duration)
      expect(plan.frames, `duration ${duration}`).toBe(plan.columns * plan.rows)
    }
  })
})

describe('cellPosition', () => {
  it('puts the first frame at the origin', () => {
    expect(cellPosition(0, 8, 5)).toBe('0% 0%')
  })

  it('puts the last frame at the far corner', () => {
    // Frame 39 of a 8x5 sheet is the bottom-right cell.
    expect(cellPosition(39, 8, 5)).toBe('100% 100%')
  })

  it('walks across a row then wraps to the next', () => {
    expect(cellPosition(1, 8, 5)).toBe(`${(1 / 7) * 100}% 0%`)
    expect(cellPosition(8, 8, 5)).toBe(`0% ${(1 / 4) * 100}%`)
  })

  it('does not divide by zero on a single-column or single-row sheet', () => {
    expect(cellPosition(0, 1, 1)).toBe('0% 0%')
    expect(cellPosition(3, 1, 4)).toBe('0% 100%')
    expect(cellPosition(3, 4, 1)).toBe('100% 0%')
  })
})

describe('sheetSize', () => {
  it('sizes the sheet so one cell exactly fills the card', () => {
    expect(sheetSize(8, 5)).toBe('800% 500%')
  })
})
