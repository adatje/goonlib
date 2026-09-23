/**
 * The media:// protocol handler.
 *
 * URLs carry opaque row ids, never filesystem paths:
 *   media://file/8121     the original file, range-streamed
 *   media://thumb/8121    the cached still thumbnail
 *   media://sprite/8121   the cached hover-scrub sprite sheet
 *
 * The handler re-resolves the path from the database and proves it still lives
 * inside a registered root before streaming a single byte.
 */

import { protocol } from 'electron'
import { spritePathFor, thumbPathFor } from '../cache'
import { getMediaLocation } from '../db/queries'
import { playablePathFor } from '../media/prepare'
import { resolveWithinRoot } from './confine'
import { badRequest, contentTypeFor, notFound, serveFile } from './serve'

export const MEDIA_SCHEME = 'media'

/**
 * Must run before `app.whenReady()` — Electron only accepts privileged scheme
 * registration during startup.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        // `stream: true` is what makes range-based seeking work at all.
        stream: true,
        corsEnabled: true,
        bypassCSP: false,
      },
    },
  ])
}

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, handleMediaRequest)
}

export async function handleMediaRequest(request: Request): Promise<Response> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return badRequest('Malformed media URL')
  }

  const id = parseId(url.pathname)
  if (id === null) return badRequest('Media URL must be media://<resource>/<id>')

  switch (url.hostname) {
    case 'file':
      return serveOriginal(id, request)
    case 'play':
      return servePlayable(id, request)
    case 'thumb':
      return serveFile(thumbPathFor(id), request, 'image/webp', IMMUTABLE)
    case 'sprite':
      return serveFile(spritePathFor(id), request, 'image/webp', IMMUTABLE)
    default:
      return notFound(`Unknown media resource "${url.hostname}"`)
  }
}

/**
 * The rendition a media element should load: the original when it's directly
 * playable, otherwise the prepared copy. The renderer always calls
 * `playback.prepare` first, so a miss here means the preparation was evicted or
 * never finished.
 */
async function servePlayable(id: number, request: Request): Promise<Response> {
  const path = await playablePathFor(id)
  if (!path) {
    return notFound(`Media ${id} has not been prepared for playback yet`)
  }

  return serveFile(path, request, contentTypeFor(path))
}

// Derived artifacts are content-addressed by media id and regenerated under a new
// id if the source changes, so they can be cached indefinitely.
const IMMUTABLE = 'public, max-age=31536000, immutable'

function parseId(pathname: string): number | null {
  const text = decodeURIComponent(pathname).replace(/^\/+/, '')
  if (!/^\d{1,15}$/.test(text)) return null
  const id = Number(text)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

async function serveOriginal(id: number, request: Request): Promise<Response> {
  const location = getMediaLocation(id)
  if (!location) return notFound(`No media with id ${id}`)

  const absPath = await resolveWithinRoot(location.rootPath, location.relPath)
  if (!absPath) return notFound(`Media ${id} is missing or outside its library root`)

  // M3 branches here on location.playbackTier to remux or transcode. Streaming the
  // file as-is is already correct for the native tier and for every image.
  return serveFile(absPath, request, contentTypeFor(absPath))
}
