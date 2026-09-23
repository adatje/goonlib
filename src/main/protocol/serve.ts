/**
 * File streaming for the media:// protocol.
 *
 * Split out from the protocol registration so it carries no `electron` import and
 * can be exercised directly by tests — this is the code path that makes video
 * seeking work, and it needs to be verifiable without booting an app window.
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { contentRange, parseRange, unsatisfiedContentRange } from './range'

/**
 * Streams a file with full Range support.
 *
 * A `Range` request gets a 206 with `Content-Range`; an out-of-bounds one gets a
 * 416. Every response advertises `Accept-Ranges: bytes`, because a media element
 * that doesn't see it will refuse to seek at all.
 */
export async function serveFile(
  absPath: string,
  request: Request,
  contentType: string,
  cacheControl = 'no-cache',
): Promise<Response> {
  let size: number
  try {
    const stats = await stat(absPath)
    if (!stats.isFile()) return notFound('Not a regular file')
    size = stats.size
  } catch {
    return notFound('File could not be read')
  }

  const baseHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
  }

  // An empty file has nothing to range over. Answer plainly rather than 416-ing a
  // request that never asked for a range.
  if (size === 0) {
    return new Response(null, { status: 200, headers: { ...baseHeaders, 'Content-Length': '0' } })
  }

  const range = parseRange(request.headers.get('range'), size)

  if (range.kind === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, 'Content-Range': unsatisfiedContentRange(size) },
    })
  }

  const start = range.kind === 'partial' ? range.start : 0
  const end = range.kind === 'partial' ? range.end : size - 1
  const status = range.kind === 'partial' ? 206 : 200

  const headers = new Headers({ ...baseHeaders, 'Content-Length': String(end - start + 1) })
  if (range.kind === 'partial') headers.set('Content-Range', contentRange(start, end, size))

  if (request.method === 'HEAD') return new Response(null, { status, headers })

  // createReadStream's `end` is inclusive, matching the Range semantics exactly.
  const stream = createReadStream(absPath, { start, end })

  if (process.env['GOONLIB_TRACE_MEDIA']) {
    const label = `${request.method} ${request.url.slice(0, 60)} range=${request.headers.get('range') ?? '-'}`
    console.log(`[media] ${label} -> ${status} bytes ${start}-${end}/${size}`)
    stream.on('error', (err) => console.log(`[media] ${label} stream error:`, err.message))
    stream.on('close', () => console.log(`[media] ${label} stream closed`))
  }

  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers })
}

const CONTENT_TYPES: Record<string, string> = {
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.jxl': 'image/jxl',
  // Video
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ogv': 'video/ogg',
}

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

export function notFound(message: string): Response {
  return new Response(message, { status: 404, headers: { 'Content-Type': 'text/plain' } })
}

export function badRequest(message: string): Response {
  return new Response(message, { status: 400, headers: { 'Content-Type': 'text/plain' } })
}
