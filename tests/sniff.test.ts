import { describe, expect, it } from 'vitest'
import { sniffHeader } from '../src/main/scan/sniff'
import { worthSniffing } from '../src/main/scan/walker'

/** Builds a header from a mix of byte values and ASCII fragments. */
function header(...parts: Array<number | string>): Uint8Array {
  const bytes: number[] = []
  for (const part of parts) {
    if (typeof part === 'number') bytes.push(part)
    else for (const char of part) bytes.push(char.charCodeAt(0))
  }
  // Pad to the length the sniffer reads.
  while (bytes.length < 32) bytes.push(0)
  return Uint8Array.from(bytes)
}

describe('sniffHeader — images', () => {
  it('identifies JPEG', () => {
    expect(sniffHeader(header(0xff, 0xd8, 0xff, 0xe0))).toEqual({ kind: 'image', ext: '.jpg' })
  })

  it('identifies PNG', () => {
    expect(sniffHeader(header(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({
      kind: 'image',
      ext: '.png',
    })
  })

  it('identifies both GIF versions', () => {
    expect(sniffHeader(header('GIF89a'))?.ext).toBe('.gif')
    expect(sniffHeader(header('GIF87a'))?.ext).toBe('.gif')
  })

  it('identifies WebP by its RIFF form, not just the RIFF magic', () => {
    expect(sniffHeader(header('RIFF', 0, 0, 0, 0, 'WEBP'))).toEqual({
      kind: 'image',
      ext: '.webp',
    })
  })

  it('identifies HEIC and AVIF by ISO brand', () => {
    expect(sniffHeader(header(0, 0, 0, 0x20, 'ftyp', 'heic'))?.ext).toBe('.heic')
    expect(sniffHeader(header(0, 0, 0, 0x20, 'ftyp', 'avif'))?.ext).toBe('.avif')
  })
})

describe('sniffHeader — video', () => {
  it('identifies MP4 from a generic ISO brand', () => {
    expect(sniffHeader(header(0, 0, 0, 0x20, 'ftyp', 'isom'))).toEqual({
      kind: 'video',
      ext: '.mp4',
    })
    expect(sniffHeader(header(0, 0, 0, 0x20, 'ftyp', 'mp42'))?.ext).toBe('.mp4')
  })

  it('distinguishes QuickTime from MP4', () => {
    expect(sniffHeader(header(0, 0, 0, 0x20, 'ftyp', 'qt  '))?.ext).toBe('.mov')
  })

  it('distinguishes WebM from Matroska, which share the EBML magic', () => {
    // Both start 1A 45 DF A3; only the doctype further in tells them apart, and
    // getting this wrong would misclassify the playback tier.
    expect(sniffHeader(header(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 'webm'))?.ext).toBe('.webm')
    expect(sniffHeader(header(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 'matroska'))?.ext).toBe(
      '.mkv',
    )
  })

  it('identifies AVI by its RIFF form', () => {
    expect(sniffHeader(header('RIFF', 0, 0, 0, 0, 'AVI '))).toEqual({ kind: 'video', ext: '.avi' })
  })

  it('identifies FLV, WMV, and MPEG program streams', () => {
    expect(sniffHeader(header(0x46, 0x4c, 0x56, 0x01))?.ext).toBe('.flv')
    expect(sniffHeader(header(0x30, 0x26, 0xb2, 0x75))?.ext).toBe('.wmv')
    expect(sniffHeader(header(0x00, 0x00, 0x01, 0xba))?.ext).toBe('.mpg')
  })
})

describe('sniffHeader — non-media', () => {
  it('returns null for HTML, which is what a saved page directory is full of', () => {
    expect(sniffHeader(header('<!DOCTYPE html>'))).toBeNull()
  })

  it('returns null for an unknown RIFF form rather than guessing', () => {
    expect(sniffHeader(header('RIFF', 0, 0, 0, 0, 'WAVE'))).toBeNull()
  })

  it('returns null for a header too short to identify', () => {
    expect(sniffHeader(Uint8Array.from([0xff, 0xd8]))).toBeNull()
  })

  it('returns null for an empty file', () => {
    expect(sniffHeader(new Uint8Array(0))).toBeNull()
  })
})

describe('worthSniffing', () => {
  it('opens files with no extension, the case this exists for', () => {
    expect(worthSniffing('4789804')).toBe(true)
    expect(worthSniffing('d35e5c47-8e8d-4bcf-86e8-b285e231bf95')).toBe(true)
  })

  it('skips the web scaffolding that dominates a saved-page folder', () => {
    // Opening every one of these would make the walk needlessly slow for nothing.
    for (const name of ['app.js', 'style.css', 'index.html', 'data.json', 'font.woff2']) {
      expect(worthSniffing(name), name).toBe(false)
    }
  })

  it('still opens an unfamiliar extension, which might be media', () => {
    expect(worthSniffing('clip.bin')).toBe(true)
    expect(worthSniffing('video.dat')).toBe(true)
  })
})
