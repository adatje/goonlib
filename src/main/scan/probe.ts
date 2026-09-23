/**
 * Stage 2 of the scan: read real metadata out of each file with ffprobe.
 *
 * The JSON parsing is separated from the spawning so the awkward parts — rotated
 * phone video, cover art masquerading as a video stream, fractional frame rates —
 * can be tested against captured ffprobe output without running anything.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PlaybackTier } from '@shared/types'
import { planPlayback } from '../media/capability'
import { requireFfprobe } from '../ffmpeg'

const run = promisify(execFile)

export interface ProbeResult {
  width: number | null
  height: number | null
  durationMs: number | null
  vcodec: string | null
  acodec: string | null
  fps: number | null
  playbackTier: PlaybackTier | null
}

/** The subset of ffprobe's output we care about. */
interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  duration?: string
  r_frame_rate?: string
  avg_frame_rate?: string
  disposition?: { attached_pic?: number }
  side_data_list?: Array<{ rotation?: number }>
  tags?: { rotate?: string }
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: { duration?: string }
}

export async function probeFile(
  absPath: string,
  ext: string,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const { stdout } = await run(
    requireFfprobe(),
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      absPath,
    ],
    {
      signal,
      // Pathological files can produce a lot of stream metadata.
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    },
  )

  return parseProbeOutput(stdout, ext)
}

export function parseProbeOutput(stdout: string, ext: string): ProbeResult {
  let parsed: FfprobeOutput
  try {
    parsed = JSON.parse(stdout) as FfprobeOutput
  } catch {
    return empty()
  }

  const streams = parsed.streams ?? []

  // A cover-art thumbnail inside an MP3 or MKV is reported as a video stream. Take
  // the first *real* one, or the file's dimensions come from its album art.
  const video =
    streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1) ?? null
  const audio = streams.find((s) => s.codec_type === 'audio') ?? null

  let width = video?.width ?? null
  let height = video?.height ?? null

  // Video shot in portrait is stored landscape with a rotation flag. Report the
  // dimensions as displayed, or every phone clip gets a sideways thumbnail slot.
  if (isQuarterTurn(rotationOf(video))) {
    ;[width, height] = [height, width]
  }

  const vcodec = video?.codec_name ?? null
  const acodec = audio?.codec_name ?? null

  const isVideo = isVideoExt(ext)

  // ffprobe reports a nominal duration for single-frame images (a JPEG comes back
  // as 0.04s at 25fps). That's meaningless and would let stills sort in among
  // real clips, so duration is only kept for actual video. Animated GIFs are the
  // deliberate exception — their duration is real.
  const rawDuration = parseDuration(parsed.format?.duration ?? video?.duration ?? audio?.duration)
  const durationMs = isVideo || isAnimatedImage(vcodec) ? rawDuration : null

  return {
    width: positiveOrNull(width),
    height: positiveOrNull(height),
    durationMs,
    vcodec,
    acodec,
    fps: parseFrameRate(video?.avg_frame_rate) ?? parseFrameRate(video?.r_frame_rate),
    // Images never need a playback plan.
    playbackTier: isVideo ? planPlayback(ext, vcodec, acodec).tier : null,
  }
}

/** Formats that are images by extension but genuinely have a running time. */
function isAnimatedImage(codec: string | null): boolean {
  return codec === 'gif' || codec === 'webp' || codec === 'apng'
}

function empty(): ProbeResult {
  return {
    width: null,
    height: null,
    durationMs: null,
    vcodec: null,
    acodec: null,
    fps: null,
    playbackTier: null,
  }
}

function rotationOf(stream: FfprobeStream | null): number {
  if (!stream) return 0

  // Modern ffprobe reports rotation in side_data_list; older files carry a
  // `rotate` tag instead. Both show up in the wild.
  const fromSideData = stream.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation
  if (typeof fromSideData === 'number') return normaliseAngle(fromSideData)

  const fromTag = stream.tags?.rotate
  if (fromTag !== undefined) {
    const parsed = Number(fromTag)
    if (Number.isFinite(parsed)) return normaliseAngle(parsed)
  }

  return 0
}

function normaliseAngle(angle: number): number {
  return ((Math.round(angle) % 360) + 360) % 360
}

function isQuarterTurn(angle: number): boolean {
  return angle === 90 || angle === 270
}

function parseDuration(value: string | undefined): number | null {
  if (value === undefined) return null
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return Math.round(seconds * 1000)
}

/** ffprobe reports frame rates as a rational string, e.g. "30000/1001". */
function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null

  const [numeratorText, denominatorText] = value.split('/')
  const numerator = Number(numeratorText)
  const denominator = denominatorText === undefined ? 1 : Number(denominatorText)

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null
  // "0/0" is ffprobe's way of saying it doesn't know.
  if (denominator === 0 || numerator === 0) return null

  const fps = numerator / denominator
  if (!Number.isFinite(fps) || fps <= 0) return null

  return Math.round(fps * 1000) / 1000
}

function positiveOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && value > 0 ? value : null
}

function isVideoExt(ext: string): boolean {
  // Cheap local check rather than importing the extension tables — probe only
  // needs to know whether a playback plan is meaningful.
  return !IMAGE_EXTS.has(ext)
}

const IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.svg',
  '.heic',
  '.heif',
  '.tif',
  '.tiff',
  '.jxl',
])
