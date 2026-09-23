/**
 * Runs the real sprite pipeline against real video.
 *
 * This suite exists because the first implementation used `-skip_frame nokey` and
 * produced a zero-byte file for every short clip — ffmpeg exited 0, the unit tests
 * all passed, and the whole feature was silently dead. Anything that asserts only
 * on argument lists would have missed it, so these assertions are about the image
 * that actually comes out.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ffmpegPath } from '../src/main/ffmpeg'
import { generateSprite, planSprite } from '../src/main/scan/sprites'

const run = promisify(execFile)

let dir: string
const at = (name: string): string => join(dir, name)

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goonlib-sprite-'))
  const ffmpeg = ffmpegPath()
  if (!ffmpeg) throw new Error('ffmpeg is required for this suite')

  // A ten-second clip. With x264's default ten-second GOP this holds essentially
  // one keyframe, which is precisely the case the original implementation broke on.
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=10',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    at('clip.mp4'),
  ])
}, 180_000)

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('generateSprite', () => {
  it('produces a real sheet for a clip with only one keyframe', async () => {
    const out = at('sheet.webp')
    const layout = await generateSprite({ absPath: at('clip.mp4'), durationMs: 10_000 }, out)

    expect(layout).not.toBeNull()
    // The exact failure that shipped: a file that exists but holds nothing.
    expect((await stat(out)).size).toBeGreaterThan(1000)
  }, 120_000)

  it('reports geometry matching the image it wrote', async () => {
    const out = at('sheet2.webp')
    const layout = await generateSprite({ absPath: at('clip.mp4'), durationMs: 10_000 }, out)
    if (!layout) throw new Error('expected a layout')

    const { width, height } = await sharp(out).metadata()
    const plan = planSprite(10_000)

    // If these drift apart the renderer's background-position maths lands between
    // cells and the scrub shows slivers of two frames at once.
    expect(width).toBe(layout.cellWidth * plan.columns)
    expect(height).toBe(layout.cellHeight * plan.rows)
    expect(layout.frames).toBe(plan.frames)
  }, 120_000)

  it('fills every cell, rather than leaving blank tiles at the end', async () => {
    const out = at('sheet3.webp')
    const layout = await generateSprite({ absPath: at('clip.mp4'), durationMs: 10_000 }, out)
    if (!layout) throw new Error('expected a layout')

    const plan = planSprite(10_000)
    const image = sharp(out)

    // Sample the last cell. A grid that ffmpeg under-filled leaves it flat black.
    const last = await image
      .extract({
        left: (plan.frames - 1) % plan.columns === 0 ? 0 : ((plan.frames - 1) % plan.columns) * layout.cellWidth,
        top: Math.floor((plan.frames - 1) / plan.columns) * layout.cellHeight,
        width: layout.cellWidth,
        height: layout.cellHeight,
      })
      .stats()

    // testsrc2 is vivid, so a real frame has substantial variation.
    expect(last.channels[0]?.stdev ?? 0).toBeGreaterThan(5)
  }, 120_000)

  it('skips clips too short to scrub', async () => {
    expect(await generateSprite({ absPath: at('clip.mp4'), durationMs: 1500 }, at('nope.webp'))).toBeNull()
    expect(await generateSprite({ absPath: at('clip.mp4'), durationMs: null }, at('nope.webp'))).toBeNull()
  })

  it('produces an equivalent sheet via the seek strategy used for long videos', async () => {
    // Claiming a duration above the threshold forces the seeking path on a file
    // short enough to test quickly.
    const out = at('seeked.webp')
    const layout = await generateSprite(
      { absPath: at('clip.mp4'), durationMs: 5 * 60 * 1000 },
      out,
    )

    expect(layout).not.toBeNull()
    expect((await stat(out)).size).toBeGreaterThan(1000)

    const { width, height } = await sharp(out).metadata()
    const plan = planSprite(5 * 60 * 1000)
    expect(width).toBe(layout!.cellWidth * plan.columns)
    expect(height).toBe(layout!.cellHeight * plan.rows)
  }, 180_000)
})
