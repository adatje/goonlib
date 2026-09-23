import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

// classifyImage reaches the providers, which read the key through the settings
// module and so pull in Electron. Only the key matters here.
vi.mock('../src/main/db/settings', () => ({ apiKey: () => null }))

const { classifyImage } = await import('../src/main/ai/client')

let dir: string
let thumb: string
/** Data URIs the fake server saw, in order. */
const seen: string[] = []
let server: import('node:http').Server
let baseUrl: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goonlib-payload-'))
  thumb = join(dir, '1.webp')

  // A real WebP thumbnail, the same format the thumbnail stage writes.
  await writeFile(
    thumb,
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#4488cc' } })
      .webp()
      .toBuffer(),
  )

  const { createServer } = await import('node:http')
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const parsed = JSON.parse(body)
      const part = parsed.messages[1].content.find((p: { type: string }) => p.type === 'image_url')
      seen.push(part.image_url.url)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: '{"labels":[]}' } }] }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address() as import('node:net').AddressInfo
  baseUrl = `http://127.0.0.1:${addr.port}/v1`
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

describe('image payload per provider', () => {
  it('transcodes the WebP thumbnail to JPEG for a local server', async () => {
    // LM Studio and everything else on llama.cpp's vision stack decode JPEG and
    // PNG only; a WebP comes back as "'url' field must be a base64 encoded image".
    await classifyImage(thumb, {
      enabled: true, provider: 'openai', baseUrl, model: 'm',
      categories: [], autoSort: false, minConfidence: 0.6,
      concurrency: 1, includeVideos: false, captions: false,
    })

    const url = seen.at(-1) ?? ''
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true)

    // And the bytes really are a decodable JPEG, not a relabelled WebP.
    const meta = await sharp(Buffer.from(url.split(',')[1] ?? '', 'base64')).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(64)
    expect(meta.height).toBe(48)
  })
})
