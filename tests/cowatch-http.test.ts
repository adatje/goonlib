import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addressOf, json, readJson, respondWith } from '../src/main/cowatch/http'
import { toRequest } from '../src/main/cowatch/protocol'
import { serveFile } from '../src/main/protocol/serve'

/** 1024 predictable bytes, so we can assert exactly which slice came back. */
const BODY = Buffer.from(Array.from({ length: 1024 }, (_, i) => i % 256))

let dir: string
let file: string
let server: Server
let origin: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goonlib-cowatch-http-'))
  file = join(dir, 'clip.mp4')
  await writeFile(file, BODY)

  // The real path a guest's <video> takes: node request in, Fetch Response out
  // of the shared range code, piped back into the node response.
  server = createServer((req, res) => {
    void (async () => {
      if (req.url === '/echo') {
        await respondWith(res, json({ got: await readJson(req) }))
        return
      }
      await respondWith(res, await serveFile(file, toRequest(req), 'video/mp4'))
    })()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(dir, { recursive: true, force: true })
})

describe('streaming to a guest', () => {
  it('serves the whole file and advertises range support', async () => {
    const res = await fetch(origin + '/')

    expect(res.status).toBe(200)
    // Without this header a <video> element will not attempt to seek at all.
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(Buffer.from(await res.arrayBuffer()).equals(BODY)).toBe(true)
  })

  it('answers a bounded range with exactly those bytes', async () => {
    const res = await fetch(origin + '/', { headers: { Range: 'bytes=200-299' } })

    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 200-299/1024')
    expect(res.headers.get('content-length')).toBe('100')

    const body = Buffer.from(await res.arrayBuffer())
    expect(body.equals(BODY.subarray(200, 300))).toBe(true)
  })

  it('answers the open-ended request a media element opens with', async () => {
    const res = await fetch(origin + '/', { headers: { Range: 'bytes=0-' } })

    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 0-1023/1024')
  })

  it('answers a suffix range, which is how seeking to the end starts', async () => {
    const res = await fetch(origin + '/', { headers: { Range: 'bytes=-100' } })

    expect(res.status).toBe(206)
    expect(Buffer.from(await res.arrayBuffer()).equals(BODY.subarray(924))).toBe(true)
  })

  it('refuses a range past the end rather than serving nothing', async () => {
    const res = await fetch(origin + '/', { headers: { Range: 'bytes=5000-6000' } })

    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */1024')
  })

  it('answers HEAD without a body', async () => {
    const res = await fetch(origin + '/', { method: 'HEAD' })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('1024')
    expect((await res.arrayBuffer()).byteLength).toBe(0)
  })
})

describe('reading what a guest sends', () => {
  async function echo(body: string): Promise<unknown> {
    const res = await fetch(origin + '/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    const payload = (await res.json()) as { got: unknown }
    return payload.got
  }

  it('parses an ordinary object', async () => {
    expect(await echo(JSON.stringify({ kind: 'play' }))).toEqual({ kind: 'play' })
  })

  it('treats malformed json as absent rather than throwing', async () => {
    expect(await echo('{oh no')).toBeNull()
  })

  it('refuses a top-level array, so callers can index safely', async () => {
    expect(await echo('[1,2,3]')).toBeNull()
  })

  it('refuses a body far past the cap instead of buffering it', async () => {
    // A guest is a stranger with a socket; "read it all, then check" is how a
    // memory exhaustion bug gets written.
    expect(await echo(JSON.stringify({ text: 'x'.repeat(200_000) }))).toBeNull()
  })
})

describe('addresses', () => {
  it('unwraps the dual-stack form node reports for IPv4', () => {
    expect(addressOf({ socket: { remoteAddress: '::ffff:192.168.1.9' } } as never)).toBe(
      '192.168.1.9',
    )
  })

  it('leaves a real IPv6 address alone', () => {
    expect(addressOf({ socket: { remoteAddress: '2001:db8::1' } } as never)).toBe('2001:db8::1')
  })

  it('does not fall over when the socket has no address', () => {
    expect(addressOf({ socket: {} } as never)).toBe('unknown')
  })
})
