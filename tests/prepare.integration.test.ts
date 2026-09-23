/**
 * End-to-end check of the playback preparation ladder.
 *
 * Unlike the other suites this one actually runs ffmpeg, because the thing worth
 * proving is that the argument lists produce a file Chromium could decode — not
 * merely that we assembled the flags we intended to.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { planPlayback } from '../src/main/media/capability'
import { buildPrepareArgs } from '../src/main/media/encoder'
import { runFfmpeg } from '../src/main/media/ffmpeg-run'
import { ffmpegPath, ffprobePath } from '../src/main/ffmpeg'

const run = promisify(execFile)

let dir: string
const source = (name: string): string => join(dir, name)

interface Probe {
  container: string
  vcodec: string | null
  acodec: string | null
  width: number | null
  durationMs: number | null
}

async function probe(path: string): Promise<Probe> {
  const { stdout } = await run(ffprobePath() as string, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    path,
  ])

  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number }>
    format?: { format_name?: string; duration?: string }
  }

  const video = parsed.streams?.find((s) => s.codec_type === 'video')
  const audio = parsed.streams?.find((s) => s.codec_type === 'audio')

  return {
    container: parsed.format?.format_name ?? '',
    vcodec: video?.codec_name ?? null,
    acodec: audio?.codec_name ?? null,
    width: video?.width ?? null,
    durationMs: parsed.format?.duration ? Math.round(Number(parsed.format.duration) * 1000) : null,
  }
}

async function prepare(input: string, ext: string, output: string): Promise<void> {
  const info = await probe(input)
  const plan = planPlayback(ext, info.vcodec, info.acodec)

  await runFfmpeg(
    buildPrepareArgs({
      input,
      output,
      plan,
      // Exercise the software path so the test behaves the same everywhere.
      hardware: false,
      width: info.width,
      height: null,
    }),
    { timeoutMs: 120_000 },
  )
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goonlib-prepare-'))
  const ffmpeg = ffmpegPath()
  if (!ffmpeg) throw new Error('ffmpeg is required for this suite')

  const make = (args: string[]): Promise<unknown> =>
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args])

  // Short clips keep the suite fast while still exercising a real mux.
  await make([
    '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    source('remuxable.mkv'),
  ])

  await make([
    '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    source('silent.mkv'),
  ])

  await make([
    '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2',
    '-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p',
    source('hevc.mp4'),
  ])
}, 180_000)

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('preparation — remux', () => {
  it('turns an MKV into a playable MP4 without touching the video stream', async () => {
    const out = source('out-remux.mp4')
    await prepare(source('remuxable.mkv'), '.mkv', out)

    const result = await probe(out)
    expect(result.container).toContain('mp4')
    // Bit-identical video: this is the whole point of the remux tier.
    expect(result.vcodec).toBe('h264')
    expect(result.acodec).toBe('aac')
    expect(result.width).toBe(320)
    expect(result.durationMs).toBeGreaterThan(1500)
  }, 120_000)

  it('produces a faststart file, so playback can begin before the whole download', async () => {
    const out = source('out-remux.mp4')
    const head = await readFile(out)
    const moov = head.indexOf('moov')
    const mdat = head.indexOf('mdat')

    expect(moov).toBeGreaterThan(-1)
    expect(mdat).toBeGreaterThan(-1)
    expect(moov).toBeLessThan(mdat)
  }, 120_000)

  it('handles a silent source rather than failing on the missing audio map', async () => {
    const out = source('out-silent.mp4')
    await prepare(source('silent.mkv'), '.mkv', out)

    const result = await probe(out)
    expect(result.vcodec).toBe('h264')
    expect(result.acodec).toBeNull()
    expect((await stat(out)).size).toBeGreaterThan(0)
  }, 120_000)
})

describe('preparation — transcode', () => {
  it('converts HEVC to H.264 that the player can actually decode', async () => {
    const out = source('out-hevc.mp4')
    await prepare(source('hevc.mp4'), '.mp4', out)

    const result = await probe(out)
    expect(result.container).toContain('mp4')
    expect(result.vcodec).toBe('h264')
    expect(result.width).toBe(320)
    expect(result.durationMs).toBeGreaterThan(1500)
  }, 180_000)
})
