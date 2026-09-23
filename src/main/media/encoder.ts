/**
 * Builds the ffmpeg argument list for preparing a video for playback.
 *
 * Kept pure — no spawning, no filesystem — so the argument lists for each tier can
 * be asserted directly in tests. Getting `-c:v copy` wrong here is the difference
 * between an instant remux and a ten-minute re-encode.
 */

import type { PlaybackPlan } from './capability'

export interface EncodeOptions {
  input: string
  output: string
  plan: PlaybackPlan
  /** Whether a hardware H.264 encoder is available. */
  hardware: boolean
  /** Source pixel dimensions, used to pick a target bitrate. */
  width: number | null
  height: number | null
}

export function buildPrepareArgs(options: EncodeOptions): string[] {
  const { input, output, plan } = options

  const args = [
    '-v',
    'error',
    // Machine-readable progress on stdout instead of the usual stats on stderr.
    '-progress',
    'pipe:1',
    '-nostats',
    '-y',
    '-i',
    input,
    // First video stream, and the first audio stream *if there is one* — the `?`
    // is what stops a silent file failing outright.
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    // Subtitles and data streams have no place in the MP4 we're about to serve,
    // and a text subtitle track would make the mux fail.
    '-sn',
    '-dn',
  ]

  if (plan.copyVideo) {
    args.push('-c:v', 'copy')
  } else {
    args.push(...videoEncoderArgs(options))
  }

  args.push(...(plan.copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k', '-ac', '2']))

  args.push(
    // Put the moov atom at the front so playback can start without reading to
    // the end of the file first.
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    output,
  )

  return args
}

function videoEncoderArgs(options: EncodeOptions): string[] {
  const bitrate = targetBitrate(options.width, options.height)

  if (options.hardware) {
    return [
      '-c:v',
      'h264_videotoolbox',
      '-b:v',
      bitrate,
      // Chromium will not decode H.264 in a pixel format other than 8-bit 4:2:0,
      // which matters because the sources needing transcode are often 10-bit HEVC.
      '-pix_fmt',
      'yuv420p',
      '-tag:v',
      'avc1',
    ]
  }

  return [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '21',
    '-pix_fmt',
    'yuv420p',
    '-tag:v',
    'avc1',
  ]
}

/**
 * A rough bitrate ladder. VideoToolbox has no CRF-style constant-quality mode we
 * can rely on across versions, so it needs a number; these are generous enough
 * that the re-encode isn't the visible bottleneck in quality.
 */
export function targetBitrate(width: number | null, height: number | null): string {
  const pixels = (width ?? 1920) * (height ?? 1080)

  if (pixels <= 640 * 480) return '2M'
  if (pixels <= 1280 * 720) return '5M'
  if (pixels <= 1920 * 1080) return '10M'
  if (pixels <= 2560 * 1440) return '18M'
  return '30M'
}
