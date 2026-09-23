import { describe, expect, it } from 'vitest'
import { planPlayback } from '../src/main/media/capability'
import { buildPrepareArgs, targetBitrate } from '../src/main/media/encoder'

function argsFor(
  ext: string,
  vcodec: string | null,
  acodec: string | null,
  hardware = true,
): string[] {
  return buildPrepareArgs({
    input: '/in.mkv',
    output: '/out.mp4',
    plan: planPlayback(ext, vcodec, acodec),
    hardware,
    width: 1920,
    height: 1080,
  })
}

/** Reads the value following a flag, e.g. valueOf(args, '-c:v'). */
function valueOf(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

describe('buildPrepareArgs — remux', () => {
  it('copies both streams for MKV/H.264+AAC', () => {
    // The single most consequential assertion in this file. If either of these
    // stops being `copy`, opening an MKV silently becomes a full re-encode.
    const args = argsFor('.mkv', 'h264', 'aac')
    expect(valueOf(args, '-c:v')).toBe('copy')
    expect(valueOf(args, '-c:a')).toBe('copy')
  })

  it('copies video but re-encodes audio for MKV/H.264+DTS', () => {
    const args = argsFor('.mkv', 'h264', 'dts')
    expect(valueOf(args, '-c:v')).toBe('copy')
    expect(valueOf(args, '-c:a')).toBe('aac')
  })

  it('never invokes a video encoder on a remux', () => {
    const args = argsFor('.mkv', 'h264', 'aac').join(' ')
    expect(args).not.toContain('libx264')
    expect(args).not.toContain('videotoolbox')
  })
})

describe('buildPrepareArgs — transcode', () => {
  it('uses the hardware encoder when one is available', () => {
    const args = argsFor('.mp4', 'hevc', 'aac', true)
    expect(valueOf(args, '-c:v')).toBe('h264_videotoolbox')
  })

  it('falls back to libx264 when it is not', () => {
    const args = argsFor('.mp4', 'hevc', 'aac', false)
    expect(valueOf(args, '-c:v')).toBe('libx264')
    expect(valueOf(args, '-crf')).toBe('21')
  })

  it('forces 8-bit 4:2:0, which is all the player will decode', () => {
    // The sources that need transcoding are frequently 10-bit HEVC; carrying the
    // pixel format through would produce an H.264 file Chromium still refuses.
    expect(valueOf(argsFor('.mp4', 'hevc', 'aac', true), '-pix_fmt')).toBe('yuv420p')
    expect(valueOf(argsFor('.mp4', 'hevc', 'aac', false), '-pix_fmt')).toBe('yuv420p')
  })

  it('still copies good audio while re-encoding the video', () => {
    expect(valueOf(argsFor('.mp4', 'hevc', 'aac'), '-c:a')).toBe('copy')
  })

  it('re-encodes audio too when it is also undecodable', () => {
    expect(valueOf(argsFor('.wmv', 'wmv3', 'wmav2'), '-c:a')).toBe('aac')
  })
})

describe('buildPrepareArgs — muxing', () => {
  it('makes the audio stream optional so silent files do not fail', () => {
    expect(argsFor('.mkv', 'h264', null)).toContain('0:a:0?')
  })

  it('drops subtitle and data streams, which MP4 cannot always carry', () => {
    const args = argsFor('.mkv', 'h264', 'aac')
    expect(args).toContain('-sn')
    expect(args).toContain('-dn')
  })

  it('puts the moov atom first so playback can start immediately', () => {
    expect(valueOf(argsFor('.mkv', 'h264', 'aac'), '-movflags')).toBe('+faststart')
  })

  it('emits machine-readable progress on stdout', () => {
    const args = argsFor('.mkv', 'h264', 'aac')
    expect(valueOf(args, '-progress')).toBe('pipe:1')
    expect(args).toContain('-nostats')
  })

  it('writes an MP4 regardless of the source container', () => {
    expect(valueOf(argsFor('.avi', 'mpeg4', 'mp3'), '-f')).toBe('mp4')
  })

  it('puts the input before the stream maps', () => {
    const args = argsFor('.mkv', 'h264', 'aac')
    expect(args.indexOf('-i')).toBeLessThan(args.indexOf('-map'))
  })
})

describe('targetBitrate', () => {
  it('scales with pixel count', () => {
    expect(targetBitrate(640, 480)).toBe('2M')
    expect(targetBitrate(1280, 720)).toBe('5M')
    expect(targetBitrate(1920, 1080)).toBe('10M')
    expect(targetBitrate(3840, 2160)).toBe('30M')
  })

  it('assumes 1080p when dimensions are unknown', () => {
    expect(targetBitrate(null, null)).toBe('10M')
  })
})
