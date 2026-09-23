import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { contentTypeFor, serveFile } from '../src/main/protocol/serve'

/** 1024 bytes of predictable content, so we can assert on exactly which slice came back. */
const BODY = Buffer.from(Array.from({ length: 1024 }, (_, i) => i % 256))

let dir: string
let file: string
let empty: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goonlib-serve-'))
  file = join(dir, 'clip.mp4')
  empty = join(dir, 'empty.mp4')
  await writeFile(file, BODY)
  await writeFile(empty, Buffer.alloc(0))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

function request(range?: string, method = 'GET'): Request {
  return new Request('media://file/1', {
    method,
    headers: range ? { Range: range } : undefined,
  })
}

describe('serveFile', () => {
  it('serves the whole file with 200 and advertises range support', async () => {
    const res = await serveFile(file, request(), 'video/mp4')

    expect(res.status).toBe(200)
    // Without this header a <video> element will not attempt to seek at all.
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(res.headers.get('Content-Length')).toBe('1024')
    expect(res.headers.get('Content-Range')).toBeNull()
    expect(Buffer.from(await res.arrayBuffer()).equals(BODY)).toBe(true)
  })

  it('answers a bounded range with 206 and the exact bytes', async () => {
    const res = await serveFile(file, request('bytes=200-299'), 'video/mp4')

    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 200-299/1024')
    expect(res.headers.get('Content-Length')).toBe('100')

    const body = Buffer.from(await res.arrayBuffer())
    expect(body.length).toBe(100)
    expect(body.equals(BODY.subarray(200, 300))).toBe(true)
  })

  it('answers the open-ended first request a media element makes', async () => {
    const res = await serveFile(file, request('bytes=0-'), 'video/mp4')

    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 0-1023/1024')
    expect(Buffer.from(await res.arrayBuffer()).equals(BODY)).toBe(true)
  })

  it('answers a tail request, which is how Chromium finds a trailing moov atom', async () => {
    const res = await serveFile(file, request('bytes=-64'), 'video/mp4')

    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 960-1023/1024')

    const body = Buffer.from(await res.arrayBuffer())
    expect(body.equals(BODY.subarray(960))).toBe(true)
  })

  it('returns the final byte, the off-by-one seeking to the very end depends on', async () => {
    const res = await serveFile(file, request('bytes=1023-'), 'video/mp4')

    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 1023-1023/1024')

    const body = Buffer.from(await res.arrayBuffer())
    expect(body.length).toBe(1)
    expect(body[0]).toBe(BODY[1023])
  })

  it('returns 416 with Content-Range for a range past EOF', async () => {
    const res = await serveFile(file, request('bytes=5000-6000'), 'video/mp4')

    expect(res.status).toBe(416)
    expect(res.headers.get('Content-Range')).toBe('bytes */1024')
  })

  it('answers HEAD with headers but no body', async () => {
    const res = await serveFile(file, request('bytes=0-99', 'HEAD'), 'video/mp4')

    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Length')).toBe('100')
    expect((await res.arrayBuffer()).byteLength).toBe(0)
  })

  it('serves an empty file as an empty 200 rather than a 416', async () => {
    const res = await serveFile(empty, request(), 'video/mp4')

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Length')).toBe('0')
  })

  it('404s a file that does not exist', async () => {
    const res = await serveFile(join(dir, 'nope.mp4'), request(), 'video/mp4')
    expect(res.status).toBe(404)
  })

  it('404s a directory', async () => {
    const res = await serveFile(dir, request(), 'video/mp4')
    expect(res.status).toBe(404)
  })

  it('passes the content type through and sets the cache policy', async () => {
    const res = await serveFile(file, request(), 'image/webp', 'public, max-age=31536000, immutable')
    expect(res.headers.get('Content-Type')).toBe('image/webp')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
  })
})

describe('contentTypeFor', () => {
  it('maps the formats the library actually indexes', () => {
    expect(contentTypeFor('/a/b.mp4')).toBe('video/mp4')
    expect(contentTypeFor('/a/b.MKV')).toBe('video/x-matroska')
    expect(contentTypeFor('/a/b.webm')).toBe('video/webm')
    expect(contentTypeFor('/a/b.jpeg')).toBe('image/jpeg')
    expect(contentTypeFor('/a/b.avif')).toBe('image/avif')
    expect(contentTypeFor('/a/b.heic')).toBe('image/heic')
  })

  it('falls back to octet-stream for anything unrecognised', () => {
    expect(contentTypeFor('/a/b.xyz')).toBe('application/octet-stream')
    expect(contentTypeFor('/a/b')).toBe('application/octet-stream')
  })
})
