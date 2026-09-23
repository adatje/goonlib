/**
 * Which file extensions the library indexes, and what kind of media each is.
 */

import { extname } from 'node:path'
import type { MediaKind } from '@shared/types'

/**
 * Images Chromium renders directly from a URL.
 */
const NATIVE_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg'])

/**
 * Images we index but have to decode ourselves before the renderer can show them.
 * Chromium has no decoder for any of these.
 */
const CONVERTED_IMAGE_EXTS = new Set(['.heic', '.heif', '.tif', '.tiff', '.jxl'])

const VIDEO_EXTS = new Set([
  '.mp4',
  '.m4v',
  '.mov',
  '.webm',
  '.mkv',
  '.avi',
  '.wmv',
  '.flv',
  '.ts',
  '.m2ts',
  '.mts',
  '.mpg',
  '.mpeg',
  '.ogv',
  '.3gp',
  '.divx',
])

/** Normalised (lower-cased, dot-prefixed) extension for a filename. */
export function extensionOf(filename: string): string {
  return extname(filename).toLowerCase()
}

export function kindForExtension(ext: string): MediaKind | null {
  if (NATIVE_IMAGE_EXTS.has(ext) || CONVERTED_IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  return null
}

/** True when the file is something the library should index at all. */
export function isMediaFile(filename: string): boolean {
  return kindForExtension(extensionOf(filename)) !== null
}

/**
 * True when the renderer cannot display this image format directly and we must
 * decode it to WebP first.
 */
export function imageNeedsConversion(ext: string): boolean {
  return CONVERTED_IMAGE_EXTS.has(ext)
}

/** Exposed for the settings screen and for tests that assert coverage. */
export const indexedExtensions = {
  image: [...NATIVE_IMAGE_EXTS, ...CONVERTED_IMAGE_EXTS].sort(),
  video: [...VIDEO_EXTS].sort(),
}
