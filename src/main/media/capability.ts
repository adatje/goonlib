/**
 * Decides how a given video has to be delivered to a <video> element.
 *
 * This is the heart of "play everything". Chromium's decoder set is fixed and
 * fairly narrow, so every file gets sorted into one of three tiers at probe time
 * and the protocol handler acts on the answer.
 *
 * The distinction that matters most is remux vs transcode. MKV is everywhere, and
 * an MKV holding H.264 needs nothing but a container swap — copying the streams is
 * essentially free, while re-encoding the same file would take minutes. Collapsing
 * those two cases together would make the app feel broken on a very common format.
 *
 * Pure and dependency-free, so the whole matrix is unit tested.
 */

import type { PlaybackTier } from '@shared/types'

export interface PlaybackPlan {
  tier: PlaybackTier
  /** Whether the video stream can be copied rather than re-encoded. */
  copyVideo: boolean
  /** Whether the audio stream can be copied rather than re-encoded. */
  copyAudio: boolean
  /** Human-readable explanation, shown in the UI when a file needs preparing. */
  reason: string
}

/** Video codecs Chromium can decode, given an acceptable container. */
const DECODABLE_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1', 'theora'])

/** Audio codecs Chromium can decode, given an acceptable container. */
const DECODABLE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])

/**
 * Container rules. A file is native only if its extension, video codec, and audio
 * codec all line up — Chromium checks the combination, not the codecs alone.
 */
const CONTAINERS: Array<{
  exts: Set<string>
  video: Set<string>
  audio: Set<string>
}> = [
  {
    // The MP4 family. Chromium's mov/mp4 demuxer handles .mov the same as .mp4.
    exts: new Set(['.mp4', '.m4v', '.mov']),
    video: new Set(['h264', 'av1', 'vp9']),
    audio: new Set(['aac', 'mp3', 'opus', 'flac']),
  },
  {
    exts: new Set(['.webm']),
    video: new Set(['vp8', 'vp9', 'av1']),
    audio: new Set(['opus', 'vorbis']),
  },
  {
    exts: new Set(['.ogv', '.ogg']),
    video: new Set(['theora', 'vp8']),
    audio: new Set(['vorbis', 'opus', 'flac']),
  },
]

/** Friendlier names for the codecs a user is most likely to be told about. */
const CODEC_LABELS: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  h265: 'HEVC',
  av1: 'AV1',
  vp8: 'VP8',
  vp9: 'VP9',
  vc1: 'VC-1',
  wmv3: 'WMV',
  mpeg4: 'MPEG-4 part 2',
  mpeg2video: 'MPEG-2',
  prores: 'ProRes',
  theora: 'Theora',
}

function label(codec: string | null): string {
  if (!codec) return 'unknown'
  return CODEC_LABELS[codec] ?? codec.toUpperCase()
}

function normalise(codec: string | null | undefined): string | null {
  if (!codec) return null
  const lower = codec.toLowerCase().trim()
  return lower === '' ? null : lower
}

/**
 * Works out the delivery plan for a video.
 *
 * `ext` must be the lower-cased, dot-prefixed extension. Codecs are ffprobe's
 * `codec_name` values; pass null for a stream that isn't present.
 */
export function planPlayback(
  ext: string,
  videoCodec: string | null | undefined,
  audioCodec: string | null | undefined,
): PlaybackPlan {
  const video = normalise(videoCodec)
  const audio = normalise(audioCodec)

  // A file with no video stream at all can't be handled by the video path.
  if (!video) {
    return {
      tier: 'transcode',
      copyVideo: false,
      copyAudio: false,
      reason: 'No video stream was found',
    }
  }

  const videoOk = DECODABLE_VIDEO.has(video)
  // Silent files are fine; there's simply nothing to check.
  const audioOk = audio === null || DECODABLE_AUDIO.has(audio)

  if (!videoOk) {
    return {
      tier: 'transcode',
      copyVideo: false,
      // Even in a transcode we copy the audio when we can — it's the video encode
      // that costs, and re-encoding good audio only loses quality.
      copyAudio: audioOk,
      reason: `${label(video)} video cannot be decoded by the player`,
    }
  }

  const container = CONTAINERS.find((c) => c.exts.has(ext))
  const containerOk =
    container !== undefined &&
    container.video.has(video) &&
    (audio === null || container.audio.has(audio))

  if (containerOk) {
    return {
      tier: 'native',
      copyVideo: true,
      copyAudio: true,
      reason: 'Plays directly',
    }
  }

  // Video is decodable but the packaging isn't right — a container swap, plus an
  // audio re-encode only if the audio itself is undecodable. Both are cheap.
  return {
    tier: 'remux',
    copyVideo: true,
    copyAudio: audioOk,
    reason: audioOk
      ? `${ext.replace('.', '').toUpperCase()} container needs repackaging`
      : `${label(audio)} audio needs re-encoding`,
  }
}

/** Convenience wrapper for callers that only care about the tier. */
export function classifyPlayback(
  ext: string,
  videoCodec: string | null | undefined,
  audioCodec: string | null | undefined,
): PlaybackTier {
  return planPlayback(ext, videoCodec, audioCodec).tier
}
