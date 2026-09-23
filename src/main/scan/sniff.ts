/**
 * Identifies media from file contents when the name doesn't say.
 *
 * Files saved by a browser often arrive with no extension at all — your library
 * had eleven — and skipping them purely on the name means real media never gets
 * indexed. Reading the first few bytes settles it definitively.
 *
 * Only consulted for files the extension tables couldn't classify, so the common
 * path stays a cheap string comparison and this never costs a read.
 */

import { open } from 'node:fs/promises'
import type { MediaKind } from '@shared/types'

/** Enough for every signature below, including the ISO-BMFF brand at offset 8. */
const HEADER_BYTES = 32

export interface Sniffed {
  kind: MediaKind
  /** The extension the content implies, used for the playback plan. */
  ext: string
}

/**
 * Classifies a header. Exported separately from the file reading so the whole
 * signature table can be tested against byte arrays.
 */
export function sniffHeader(header: Uint8Array): Sniffed | null {
  if (header.length < 12) return null

  const ascii = (start: number, length: number): string =>
    String.fromCharCode(...header.subarray(start, start + length))

  const starts = (...bytes: number[]): boolean => bytes.every((b, i) => header[i] === b)

  // --- images ---
  if (starts(0xff, 0xd8, 0xff)) return { kind: 'image', ext: '.jpg' }
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { kind: 'image', ext: '.png' }
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return { kind: 'image', ext: '.gif' }
  if (starts(0x42, 0x4d)) return { kind: 'image', ext: '.bmp' }

  // RIFF containers carry their real type at offset 8.
  if (ascii(0, 4) === 'RIFF') {
    const form = ascii(8, 4)
    if (form === 'WEBP') return { kind: 'image', ext: '.webp' }
    if (form === 'AVI ') return { kind: 'video', ext: '.avi' }
    return null
  }

  // --- ISO base media (mp4/mov/heic/avif), whose brand lives after 'ftyp' ---
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4)

    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'mif1') {
      return { kind: 'image', ext: '.heic' }
    }
    if (brand === 'avif' || brand === 'avis') return { kind: 'image', ext: '.avif' }
    if (brand === 'qt  ') return { kind: 'video', ext: '.mov' }

    // isom, mp42, dash, M4V, and friends are all MP4 as far as playback cares.
    return { kind: 'video', ext: '.mp4' }
  }

  // --- video ---
  // Matroska and WebM share the EBML magic; the doctype appears shortly after,
  // so scan the header rather than testing a fixed offset.
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) {
    const text = ascii(0, header.length)
    return text.includes('webm')
      ? { kind: 'video', ext: '.webm' }
      : { kind: 'video', ext: '.mkv' }
  }

  if (starts(0x46, 0x4c, 0x56, 0x01)) return { kind: 'video', ext: '.flv' }
  if (starts(0x30, 0x26, 0xb2, 0x75)) return { kind: 'video', ext: '.wmv' }
  if (starts(0x00, 0x00, 0x01, 0xba) || starts(0x00, 0x00, 0x01, 0xb3)) {
    return { kind: 'video', ext: '.mpg' }
  }
  if (ascii(0, 4) === 'OggS') return { kind: 'video', ext: '.ogv' }

  return null
}

/** Reads a file's header and classifies it, or null if it isn't media we handle. */
export async function sniffFile(absPath: string): Promise<Sniffed | null> {
  let handle
  try {
    handle = await open(absPath, 'r')
  } catch {
    return null
  }

  try {
    const buffer = Buffer.alloc(HEADER_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0)
    return sniffHeader(buffer.subarray(0, bytesRead))
  } catch {
    return null
  } finally {
    await handle.close().catch(() => undefined)
  }
}
