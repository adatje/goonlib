/**
 * Glue between the Fetch-style helpers the app already has and node:http.
 *
 * `protocol/serve.ts` returns a `Response` and gets Range, 206 and 416 right —
 * that code is the reason video seeking works at all. Rather than write a
 * second range implementation for the session server and discover next year
 * that only one of them was correct, this adapter pipes a `Response` into a
 * `ServerResponse` and both doors share the one.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

/** Ceiling on a request body. Nothing a guest sends is more than a chat line. */
export const MAX_BODY_BYTES = 64 * 1024

export async function respondWith(res: ServerResponse, response: Response): Promise<void> {
  // Set-Cookie is the one header that legitimately repeats, and folding it into
  // a single comma-joined value silently breaks the cookie.
  const setCookies = response.headers.getSetCookie?.() ?? []
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() === 'set-cookie') continue
    res.setHeader(key, value)
  }
  if (setCookies.length > 0) res.setHeader('Set-Cookie', setCookies)

  res.statusCode = response.status

  if (!response.body) {
    res.end()
    return
  }

  const stream = Readable.fromWeb(response.body as never)

  // A guest closing the tab mid-video aborts the socket; that must tear down the
  // file read rather than leaving a descriptor bound to nobody.
  res.on('close', () => {
    if (!res.writableFinished) stream.destroy()
  })

  try {
    for await (const chunk of stream) {
      if (!res.write(chunk)) {
        await new Promise<void>((resolve) => res.once('drain', resolve))
      }
    }
    res.end()
  } catch {
    // Broken pipes are the normal way a video request ends when someone seeks.
    res.destroy()
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Nothing the session serves should ever be cached by an intermediary,
      // least of all by whatever tunnel is in the path.
      'Cache-Control': 'no-store',
    },
  })
}

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/**
 * Reads a request body, refusing anything oversized rather than buffering it.
 *
 * The limit is enforced as bytes arrive, not after — a guest is a stranger with
 * a socket, and "read it all then check the length" is how you get a memory
 * exhaustion bug.
 */
export async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let total = 0

  for await (const chunk of req) {
    const buffer = chunk as Buffer
    total += buffer.length
    if (total > MAX_BODY_BYTES) return null
    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}

/** Parses a JSON body, treating anything malformed as absent rather than throwing. */
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const body = await readBody(req)
  if (body === null) return null

  try {
    const parsed: unknown = JSON.parse(body)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * The client's address as a plain string for display.
 *
 * Deliberately ignores X-Forwarded-For: behind a tunnel every request has one,
 * it is attacker-controlled, and showing a spoofed address on the approval
 * prompt would undermine the one decision that prompt exists to support.
 */
export function addressOf(req: IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? 'unknown'
  // Node reports IPv4 over a dual-stack socket in this form; the prefix is noise.
  return remote.startsWith('::ffff:') ? remote.slice(7) : remote
}
