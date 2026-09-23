/**
 * Stage 3 of the scan: a still thumbnail for every item.
 *
 * ffmpeg is used only to *decode* — it hands back one raw frame as PNG on stdout
 * and sharp does all the resizing and WebP encoding. That split is deliberate:
 * ffmpeg builds vary wildly in which encoders they were compiled with (Homebrew's
 * default ffmpeg has no libwebp at all), whereas sharp's libvips always has WebP.
 * Asking ffmpeg to encode would make thumbnails silently fail on some machines.
 *
 * Images go straight through sharp; anything sharp can't open — an exotic HEIC, an
 * unusual TIFF — falls back to the same ffmpeg decode path.
 */

import { rm } from 'node:fs/promises'
import sharp from 'sharp'
import type { MediaKind } from '@shared/types'
import { ensureParent, thumbPathFor } from '../cache'
import { runFfmpegCapture } from '../media/ffmpeg-run'

/** Longest edge of a generated thumbnail, in pixels. */
export const THUMB_MAX = 512

export interface ThumbnailRequest {
  id: number
  absPath: string
  kind: MediaKind
  durationMs: number | null
}

export async function generateThumbnail(
  request: ThumbnailRequest,
  signal?: AbortSignal,
): Promise<string> {
  const out = thumbPathFor(request.id)
  ensureParent(out)

  if (request.kind === 'image') {
    try {
      await encodeThumbnail(request.absPath, out)
      return out
    } catch {
      // sharp couldn't open it. Fall through to ffmpeg rather than giving up —
      // it decodes far more formats than libvips does.
      await discard(out)
    }
  }

  const frame = await extractFrame(request, signal)
  await encodeThumbnail(frame, out)
  return out
}

/**
 * Resize and encode to WebP. Takes either a path or an already-decoded buffer.
 */
async function encodeThumbnail(source: string | Buffer, out: string): Promise<void> {
  await sharp(source, {
    // Don't reject a file for a recoverable defect — a slightly truncated JPEG
    // should still get a thumbnail.
    failOn: 'none',
    // Take the first frame of an animated GIF/WebP rather than the whole sequence.
    animated: false,
  })
    // No argument means "apply the EXIF orientation", which has to happen before
    // the resize or the output is both sideways and wrongly proportioned.
    .rotate()
    .resize(THUMB_MAX, THUMB_MAX, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(out)
}

/** Pulls a single frame out of a file as PNG on stdout. */
async function extractFrame(request: ThumbnailRequest, signal?: AbortSignal): Promise<Buffer> {
  const args = ['-v', 'error']

  if (request.kind === 'video') {
    // Seek before -i so ffmpeg jumps by keyframe instead of decoding from the
    // start — the difference between milliseconds and minutes on a long file.
    args.push('-ss', seekSecondsFor(request.durationMs).toFixed(3))
  }

  args.push(
    '-i',
    request.absPath,
    '-frames:v',
    '1',
    // PNG is a built-in ffmpeg encoder, present in every build.
    '-c:v',
    'png',
    '-f',
    'image2pipe',
    'pipe:1',
  )

  return runFfmpegCapture(args, {
    signal,
    timeoutMs: 60_000,
    // One decoded frame; even 8K RGBA lands far under this.
    maxBytes: 256 * 1024 * 1024,
  })
}

/**
 * Where to grab the poster frame. 10% in avoids the black frames and fade-ins that
 * so many videos open on, while staying inside even a very short clip.
 */
export function seekSecondsFor(durationMs: number | null): number {
  if (durationMs === null || durationMs <= 0) return 0

  const tenPercent = (durationMs * 0.1) / 1000
  // Never seek within 100ms of the end, or the grab can land past the last frame.
  const latest = Math.max(0, (durationMs - 100) / 1000)

  return Math.min(tenPercent, latest)
}

async function discard(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => undefined)
}
