import { describe, expect, it } from 'vitest'
import { classifyPlayback, planPlayback } from '../src/main/media/capability'

describe('planPlayback — native tier', () => {
  it('plays ordinary MP4/H.264+AAC directly', () => {
    expect(classifyPlayback('.mp4', 'h264', 'aac')).toBe('native')
  })

  it('plays WebM/VP9+Opus directly', () => {
    expect(classifyPlayback('.webm', 'vp9', 'opus')).toBe('native')
  })

  it('plays MP4/AV1 directly', () => {
    expect(classifyPlayback('.mp4', 'av1', 'opus')).toBe('native')
  })

  it('treats .mov with H.264+AAC as native, since Chromium shares the mp4 demuxer', () => {
    expect(classifyPlayback('.mov', 'h264', 'aac')).toBe('native')
  })

  it('plays a silent MP4 directly', () => {
    expect(classifyPlayback('.mp4', 'h264', null)).toBe('native')
  })

  it('plays Ogg/Theora directly', () => {
    expect(classifyPlayback('.ogv', 'theora', 'vorbis')).toBe('native')
  })
})

describe('planPlayback — remux tier', () => {
  it('remuxes MKV/H.264+AAC rather than transcoding it', () => {
    // The single most important case in the whole matrix. MKV is ubiquitous and
    // the streams inside are usually already fine, so this must never be a
    // transcode — that would turn an instant open into a multi-minute wait.
    const plan = planPlayback('.mkv', 'h264', 'aac')
    expect(plan.tier).toBe('remux')
    expect(plan.copyVideo).toBe(true)
    expect(plan.copyAudio).toBe(true)
  })

  it('remuxes MKV/VP9', () => {
    expect(classifyPlayback('.mkv', 'vp9', 'opus')).toBe('remux')
  })

  it('remuxes an MPEG transport stream carrying H.264', () => {
    expect(classifyPlayback('.ts', 'h264', 'aac')).toBe('remux')
  })

  it('remuxes FLV/H.264', () => {
    expect(classifyPlayback('.flv', 'h264', 'aac')).toBe('remux')
  })

  it('remuxes AVI that happens to hold H.264', () => {
    expect(classifyPlayback('.avi', 'h264', 'mp3')).toBe('remux')
  })

  it('re-encodes only the audio when the video is fine but the audio is not', () => {
    // MKV + H.264 + DTS: copy the expensive stream, re-encode the cheap one.
    const plan = planPlayback('.mkv', 'h264', 'dts')
    expect(plan.tier).toBe('remux')
    expect(plan.copyVideo).toBe(true)
    expect(plan.copyAudio).toBe(false)
  })

  it('remuxes an MP4 whose audio codec the container cannot legally carry', () => {
    const plan = planPlayback('.mp4', 'h264', 'vorbis')
    expect(plan.tier).toBe('remux')
    expect(plan.copyVideo).toBe(true)
  })

  it('remuxes VP8 in an MP4, which is decodable but not a valid pairing', () => {
    expect(classifyPlayback('.mp4', 'vp8', 'aac')).toBe('remux')
  })
})

describe('planPlayback — transcode tier', () => {
  it('transcodes HEVC even inside an MP4', () => {
    const plan = planPlayback('.mp4', 'hevc', 'aac')
    expect(plan.tier).toBe('transcode')
    expect(plan.copyVideo).toBe(false)
    // The audio is already fine, so don't degrade it for no reason.
    expect(plan.copyAudio).toBe(true)
  })

  it('transcodes VC-1', () => {
    expect(classifyPlayback('.wmv', 'vc1', 'wmav2')).toBe('transcode')
  })

  it('transcodes WMV3', () => {
    expect(classifyPlayback('.wmv', 'wmv3', 'wmav2')).toBe('transcode')
  })

  it('transcodes MPEG-4 part 2, the classic DivX-era AVI', () => {
    expect(classifyPlayback('.avi', 'mpeg4', 'mp3')).toBe('transcode')
  })

  it('transcodes ProRes', () => {
    expect(classifyPlayback('.mov', 'prores', 'pcm_s16le')).toBe('transcode')
  })

  it('transcodes MPEG-2', () => {
    expect(classifyPlayback('.mpg', 'mpeg2video', 'mp2')).toBe('transcode')
  })

  it('reports a file with no video stream rather than pretending it is playable', () => {
    const plan = planPlayback('.mp4', null, 'aac')
    expect(plan.tier).toBe('transcode')
    expect(plan.reason).toMatch(/no video stream/i)
  })
})

describe('planPlayback — reasons', () => {
  it('names the offending codec so the UI can explain the wait', () => {
    expect(planPlayback('.mp4', 'hevc', 'aac').reason).toContain('HEVC')
    expect(planPlayback('.avi', 'mpeg4', 'mp3').reason).toContain('MPEG-4 part 2')
  })

  it('names the container when that is what needs fixing', () => {
    expect(planPlayback('.mkv', 'h264', 'aac').reason).toContain('MKV')
  })

  it('says a native file plays directly', () => {
    expect(planPlayback('.mp4', 'h264', 'aac').reason).toMatch(/directly/i)
  })
})

describe('planPlayback — input handling', () => {
  it('is case-insensitive about codec names', () => {
    expect(classifyPlayback('.mp4', 'H264', 'AAC')).toBe('native')
  })

  it('treats empty and undefined codecs as absent', () => {
    expect(classifyPlayback('.mp4', 'h264', '')).toBe('native')
    expect(classifyPlayback('.mp4', 'h264', undefined)).toBe('native')
  })

  it('transcodes an unrecognised video codec rather than assuming it works', () => {
    expect(classifyPlayback('.mp4', 'some_new_codec', 'aac')).toBe('transcode')
  })
})
