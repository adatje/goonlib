/**
 * Stage 5 of the scan: hashes for duplicate detection.
 *
 * Two hashes per item:
 *
 *  - `contentHash` is a straight SHA-256 of the whole file, streamed. It answers
 *    "byte-for-byte identical" with no false positives. An earlier plan used a
 *    size + head/tail "quick hash" to avoid reading large files, but SHA-256 runs
 *    at gigabytes per second on this hardware, and a scheme that can report two
 *    different files as duplicates is a bad trade when the UI offers to delete
 *    things.
 *
 *  - `phash` is perceptual, computed from the thumbnail we already generated, and
 *    catches re-encodes and rescales that a content hash cannot.
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import sharp from 'sharp'
import { HASH_SIZE, perceptualHash } from './phash'

export interface HashResult {
  contentHash: string
  phash: string | null
}

/** Streams the file through SHA-256 without holding it in memory. */
export async function hashFileContents(absPath: string, signal?: AbortSignal): Promise<string> {
  const digest = createHash('sha256')
  await pipeline(createReadStream(absPath), digest, { signal })
  return digest.digest('hex')
}

/**
 * Perceptual hash of an already-generated thumbnail.
 *
 * Hashing the thumbnail rather than the source is deliberate: it's a fixed-size
 * decode of a small file instead of re-decoding a video, and both files having
 * been through the same thumbnail pipeline removes a source of variation.
 */
export async function hashThumbnail(thumbPath: string): Promise<string | null> {
  const pixels = await sharp(thumbPath)
    .greyscale()
    // `fill` on purpose: aspect ratio is not what we're comparing, and letterbox
    // padding would dominate the low frequencies the hash is built from.
    .resize(HASH_SIZE, HASH_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer()

  return perceptualHash(pixels)
}

/**
 * Both hashes for one item. A missing or unreadable thumbnail yields a null
 * perceptual hash rather than failing the whole stage — the content hash is the
 * more important of the two.
 */
export async function hashItem(
  absPath: string,
  thumbPath: string | null,
  signal?: AbortSignal,
): Promise<HashResult> {
  const contentHash = await hashFileContents(absPath, signal)

  let phash: string | null = null
  if (thumbPath) {
    try {
      phash = await hashThumbnail(thumbPath)
    } catch {
      phash = null
    }
  }

  return { contentHash, phash }
}
