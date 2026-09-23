import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Exercises the download half of the scraper against a stand-in for 4chan.
 *
 * The parsing is covered in `fourchan.test.ts`; what this adds is the part that
 * touches the disk — where the files land, what they are named, and that a
 * second run doesn't re-fetch what is already there.
 */

/** Files the stub serves, keyed by CDN path. */
const SERVED = new Map<string, Buffer>([
  ['/wg/111.jpg', Buffer.from('first image bytes')],
  ['/wg/222.png', Buffer.from('second image bytes')],
  ['/wg/333.webm', Buffer.from('a video')],
  ['/wg/444.jpg', Buffer.from('same name as the first')],
])

let downloadDir: string
let server: Server
let origin: string
/** CDN paths the stub was actually asked for. */
const requested: string[] = []

// The scraper reads the Downloads location and the app version from Electron.
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'downloads') throw new Error(`unexpected path request: ${name}`)
      return downloadDir
    },
    getVersion: () => '0.0.0-test',
  },
}))

beforeAll(async () => {
  downloadDir = await mkdtemp(join(tmpdir(), 'goonlib-scrape-'))

  server = createServer((req, res) => {
    const path = req.url ?? ''

    if (path === '/wg/thread/8123456.json') {
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          posts: [
            { no: 1, sub: 'Wallpapers: best &amp; worst', tim: 111, ext: '.jpg', filename: 'sunset', fsize: 17 },
            { no: 2, tim: 222, ext: '.png', filename: 'city', fsize: 18 },
            { no: 3, tim: 333, ext: '.webm', filename: 'clip', fsize: 7 },
            // Same uploader filename as post 1 — must not overwrite it.
            { no: 4, tim: 444, ext: '.jpg', filename: 'sunset', fsize: 22 },
            // Formats the library does not index.
            { no: 5, tim: 555, ext: '.swf', filename: 'flash', fsize: 10 },
            // No attachment at all.
            { no: 6 },
          ],
        }),
      )
      return
    }

    const body = SERVED.get(path)
    if (!body) {
      res.statusCode = 404
      res.end('missing')
      return
    }

    requested.push(path)
    res.setHeader('content-length', String(body.length))
    res.end(body)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/**
 * Points the scraper's hosts at the stub.
 *
 * The module builds its URLs from constants, so the test rewrites them on the
 * fetch instead — which also proves the scraper only ever asks for the paths
 * `fourchan.ts` produced.
 */
function redirectToStub(): void {
  const real = globalThis.fetch
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
      .replace('https://a.4cdn.org', origin)
      .replace('https://i.4cdn.org', origin)
    return real(url, init)
  })
}

describe('scraper', () => {
  it('downloads a thread into a folder named after its subject', async () => {
    redirectToStub()
    const { Scraper } = await import('../src/main/scrape/scraper')

    const scraper = new Scraper()
    const folder = await scraper.start('https://boards.4chan.org/wg/thread/8123456')

    // The subject's HTML entity is decoded and the colon — illegal on macOS —
    // is replaced, so the folder is named from the thread rather than its number.
    expect(folder).toBe(join(downloadDir, 'Wallpapers best & worst'))

    const files = (await readdir(folder as string)).sort()
    expect(files).toEqual(['city.png', 'clip.webm', 'sunset-444.jpg', 'sunset.jpg'])

    // Two posts shared the filename `sunset`; neither may clobber the other.
    expect(await readFile(join(folder as string, 'sunset.jpg'), 'utf8')).toBe('first image bytes')
    expect(await readFile(join(folder as string, 'sunset-444.jpg'), 'utf8')).toBe(
      'same name as the first',
    )

    const status = scraper.status()
    expect(status.phase).toBe('done')
    expect(status.downloaded).toBe(4)
    // The .swf, counted but never requested.
    expect(status.skipped).toBe(1)
    expect(status.failed).toBe(0)
    expect(requested).not.toContain('/wg/555.swf')
  })

  it('leaves no .part files behind', async () => {
    const folder = join(downloadDir, 'Wallpapers best & worst')
    const files = await readdir(folder)
    expect(files.filter((name) => name.endsWith('.part'))).toEqual([])
  })

  it('re-running a thread only fetches what is missing', async () => {
    redirectToStub()
    const { Scraper } = await import('../src/main/scrape/scraper')

    const folder = join(downloadDir, 'Wallpapers best & worst')
    // Simulate the thread gaining nothing, but one file having been deleted.
    await writeFile(join(folder, 'placeholder'), 'x')
    requested.length = 0

    const scraper = new Scraper()
    await scraper.start('https://boards.4chan.org/wg/thread/8123456')

    // Everything was already on disk at the right size, so nothing was re-fetched.
    expect(requested).toEqual([])
    expect(scraper.status().downloaded).toBe(0)
    expect(scraper.status().skipped).toBeGreaterThanOrEqual(4)
  })

  it('refuses a link that is not a 4chan thread', async () => {
    redirectToStub()
    const { Scraper } = await import('../src/main/scrape/scraper')

    await expect(new Scraper().start('https://example.com/g/thread/1')).rejects.toThrow(
      /not a 4chan thread/,
    )
  })
})
