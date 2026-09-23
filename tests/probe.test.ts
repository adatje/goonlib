import { describe, expect, it } from 'vitest'
import { parseProbeOutput } from '../src/main/scan/probe'

function output(value: unknown): string {
  return JSON.stringify(value)
}

describe('parseProbeOutput — video', () => {
  const h264 = output({
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001' },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
    format: { duration: '212.545000' },
  })

  it('reads dimensions, codecs, duration, and frame rate', () => {
    const result = parseProbeOutput(h264, '.mp4')

    expect(result.width).toBe(1920)
    expect(result.height).toBe(1080)
    expect(result.vcodec).toBe('h264')
    expect(result.acodec).toBe('aac')
    expect(result.durationMs).toBe(212_545)
    expect(result.fps).toBeCloseTo(29.97, 2)
  })

  it('assigns a playback tier from the codecs and container', () => {
    expect(parseProbeOutput(h264, '.mp4').playbackTier).toBe('native')
    expect(parseProbeOutput(h264, '.mkv').playbackTier).toBe('remux')
  })

  it('swaps dimensions for portrait video stored with a rotation flag', () => {
    // How every phone stores a portrait clip. Without this the grid reserves a
    // landscape slot for a portrait video.
    const rotated = output({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          side_data_list: [{ rotation: -90 }],
        },
      ],
      format: { duration: '10.0' },
    })

    const result = parseProbeOutput(rotated, '.mov')
    expect(result.width).toBe(1080)
    expect(result.height).toBe(1920)
  })

  it('honours the legacy rotate tag as well as side data', () => {
    const rotated = output({
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, tags: { rotate: '270' } },
      ],
    })

    expect(parseProbeOutput(rotated, '.mov').width).toBe(1080)
  })

  it('leaves dimensions alone for a 180 degree rotation', () => {
    const rotated = output({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          side_data_list: [{ rotation: 180 }],
        },
      ],
    })

    expect(parseProbeOutput(rotated, '.mp4').width).toBe(1920)
  })

  it('ignores cover art posing as a video stream', () => {
    // An MKV with embedded artwork lists the artwork first. Taking it would give
    // the file the poster's dimensions and call it an image codec.
    const withArt = output({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'mjpeg',
          width: 600,
          height: 600,
          disposition: { attached_pic: 1 },
        },
        { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
        { codec_type: 'audio', codec_name: 'ac3' },
      ],
      format: { duration: '60.0' },
    })

    const result = parseProbeOutput(withArt, '.mkv')
    expect(result.vcodec).toBe('h264')
    expect(result.width).toBe(1280)
  })

  it('handles a silent video', () => {
    const silent = output({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 640, height: 480 }],
      format: { duration: '5.0' },
    })

    const result = parseProbeOutput(silent, '.mp4')
    expect(result.acodec).toBeNull()
    expect(result.playbackTier).toBe('native')
  })
})

describe('parseProbeOutput — images', () => {
  it('reads dimensions and assigns no playback tier', () => {
    const image = output({
      streams: [{ codec_type: 'video', codec_name: 'mjpeg', width: 4032, height: 3024 }],
      format: { duration: 'N/A' },
    })

    const result = parseProbeOutput(image, '.jpg')
    expect(result.width).toBe(4032)
    expect(result.height).toBe(3024)
    expect(result.playbackTier).toBeNull()
    expect(result.durationMs).toBeNull()
  })

  it('discards the nominal duration ffprobe invents for a still', () => {
    // A single-frame JPEG comes back as 0.04s — one frame at 25fps. Keeping it
    // would let stills sort in among real clips when sorting by duration.
    const still = output({
      streams: [{ codec_type: 'video', codec_name: 'mjpeg', width: 1200, height: 800 }],
      format: { duration: '0.040000' },
    })

    expect(parseProbeOutput(still, '.jpg').durationMs).toBeNull()
  })

  it('keeps the duration of an animated GIF, which is real', () => {
    const gif = output({
      streams: [{ codec_type: 'video', codec_name: 'gif', width: 200, height: 200 }],
      format: { duration: '3.000000' },
    })

    expect(parseProbeOutput(gif, '.gif').durationMs).toBe(3000)
  })
})

describe('parseProbeOutput — degenerate input', () => {
  it('returns empty metadata for unparseable output rather than throwing', () => {
    const result = parseProbeOutput('not json at all', '.mp4')
    expect(result.width).toBeNull()
    expect(result.vcodec).toBeNull()
  })

  it('handles output with no streams', () => {
    const result = parseProbeOutput(output({ streams: [], format: {} }), '.mp4')
    expect(result.vcodec).toBeNull()
    // No video stream means it cannot be played as-is.
    expect(result.playbackTier).toBe('transcode')
  })

  it('rejects a zero or unknown frame rate', () => {
    const zero = output({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 10, height: 10, avg_frame_rate: '0/0' }],
    })
    expect(parseProbeOutput(zero, '.mp4').fps).toBeNull()
  })

  it('falls back to r_frame_rate when avg_frame_rate is unknown', () => {
    const fallback = output({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 10,
          height: 10,
          avg_frame_rate: '0/0',
          r_frame_rate: '25/1',
        },
      ],
    })
    expect(parseProbeOutput(fallback, '.mp4').fps).toBe(25)
  })

  it('rejects non-positive durations and dimensions', () => {
    const bad = output({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 0, height: 0 }],
      format: { duration: '0' },
    })

    const result = parseProbeOutput(bad, '.mp4')
    expect(result.width).toBeNull()
    expect(result.durationMs).toBeNull()
  })
})
