/**
 * Downloads a 4chan thread's media into ~/Downloads and hands the folder to the
 * library as a source.
 *
 * Two rules shape the whole file. Everything it writes must land inside the
 * download folder — every name in the API response was typed by a stranger — and
 * it must be re-runnable, because the natural way to use this is to scrape a
 * live thread again later for the posts that have since appeared.
 */

import { EventEmitter } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app } from 'electron'
import type { ScrapeProgress } from '@shared/types'
import { extensionOf, isMediaFile } from '../scan/extensions'
import { parseThreadUrl, readThread, sanitiseSegment, threadApiUrl } from './fourchan'
import type { Thread, ThreadFile } from './fourchan'

/** Simultaneous downloads. Enough to saturate a link, few enough to be polite. */
const CONCURRENCY = 3

/** Ceiling on one file. 4chan's own limit is far below this. */
const MAX_FILE_BYTES = 128 * 1024 * 1024

const API_TIMEOUT_MS = 20_000
const FILE_TIMEOUT_MS = 120_000

/** Identifies the client honestly rather than impersonating a browser. */
const USER_AGENT = `GoonLib/${app.getVersion?.() ?? '0'} (personal media library)`

function emptyProgress(): ScrapeProgress {
  return {
    phase: 'idle',
    url: null,
    title: null,
    folder: null,
    total: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    bytes: 0,
    message: null,
  }
}

export class Scraper extends EventEmitter {
  private controller: AbortController | null = null
  private progress: ScrapeProgress = emptyProgress()

  get running(): boolean {
    return this.controller !== null
  }

  status(): ScrapeProgress {
    return { ...this.progress }
  }

  cancel(): void {
    this.controller?.abort()
  }

  /**
   * Starts a scrape. Resolves with the folder once every file has been tried, so
   * the caller can add it as a library source; rejects only if the thread itself
   * could not be read. Individual file failures are counted, not thrown.
   */
  async start(url: string): Promise<string | null> {
    if (this.running) throw new Error('A download is already running')

    const ref = parseThreadUrl(url)
    if (!ref) {
      throw new Error('That is not a 4chan thread link - expected boards.4chan.org/…/thread/…')
    }

    const controller = new AbortController()
    this.controller = controller
    this.progress = { ...emptyProgress(), phase: 'fetching', url }
    this.emitProgress()

    try {
      const thread = await this.fetchThread(url, controller.signal)
      const folder = await this.prepareFolder(thread)

      this.progress.title = thread.folderName
      this.progress.folder = folder
      this.progress.total = thread.files.length
      this.progress.skipped = thread.skippedFormats
      this.setPhase('downloading')

      await this.download(thread, folder, controller.signal)

      this.setPhase(controller.signal.aborted ? 'cancelled' : 'done')
      return folder
    } catch (err) {
      this.progress.message = err instanceof Error ? err.message : String(err)
      this.setPhase(controller.signal.aborted ? 'cancelled' : 'error')
      if (controller.signal.aborted) return null
      throw err
    } finally {
      this.controller = null
      this.emitProgress()
    }
  }

  private async fetchThread(url: string, signal: AbortSignal): Promise<Thread> {
    const ref = parseThreadUrl(url)
    if (!ref) throw new Error('That is not a 4chan thread link')

    const response = await request(threadApiUrl(ref), signal, API_TIMEOUT_MS)

    if (response.status === 404) {
      throw new Error('That thread is gone - 4chan threads are deleted after they fall off the board')
    }
    if (!response.ok) {
      throw new Error(`4chan returned ${response.status} for that thread`)
    }

    const thread = readThread(ref, await response.json())
    if (thread.files.length === 0) {
      throw new Error('That thread has no images or videos to download')
    }

    return thread
  }

  /**
   * Creates the destination and proves it is inside the download folder.
   *
   * `folderName` is already sanitised, so this is the second of two checks
   * rather than the only one — but it is the one that would still hold if the
   * sanitiser were ever weakened.
   */
  private async prepareFolder(thread: Thread): Promise<string> {
    const downloads = app.getPath('downloads')
    const folder = resolve(downloads, thread.folderName)

    if (folder !== downloads && !folder.startsWith(downloads + sep)) {
      throw new Error('Refusing to write outside the Downloads folder')
    }

    await mkdir(folder, { recursive: true })
    return folder
  }

  private async download(thread: Thread, folder: string, signal: AbortSignal): Promise<void> {
    const taken = new Set<string>()
    let next = 0

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, thread.files.length) },
      async () => {
        for (;;) {
          if (signal.aborted) return

          const file = thread.files[next++]
          if (!file) return

          try {
            const saved = await this.saveFile(file, folder, taken, signal)
            if (saved) this.progress.downloaded += 1
            else this.progress.skipped += 1
          } catch (err) {
            if (signal.aborted) return
            this.progress.failed += 1
            this.progress.message = err instanceof Error ? err.message : String(err)
            console.error(`[scrape] ${file.url} failed:`, this.progress.message)
          }

          this.emitProgress()
        }
      },
    )

    await Promise.all(workers)
  }

  /** Returns false when the file was already on disk. */
  private async saveFile(
    file: ThreadFile,
    folder: string,
    taken: Set<string>,
    signal: AbortSignal,
  ): Promise<boolean> {
    const target = this.destinationFor(file, folder, taken)

    // Re-running against a live thread should fetch only what is new, so an
    // existing file of the right size is left alone.
    try {
      const existing = await stat(target)
      if (existing.size > 0 && (file.sizeBytes === 0 || existing.size === file.sizeBytes)) {
        return false
      }
    } catch {
      // Not there yet, which is the normal case.
    }

    const response = await request(file.url, signal, FILE_TIMEOUT_MS)
    if (!response.ok) throw new Error(`${file.url} returned ${response.status}`)
    if (!response.body) throw new Error(`${file.url} returned an empty response`)

    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > MAX_FILE_BYTES) {
      throw new Error(`${file.originalName}${file.ext} is larger than the ${MAX_FILE_BYTES} byte cap`)
    }

    // Written to a temporary name and moved into place, so an interrupted
    // download can't leave a half-file that the next run mistakes for complete
    // and the scanner mistakes for real media.
    const partial = `${target}.part`

    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial), { signal })
      const written = await stat(partial)

      if (written.size > MAX_FILE_BYTES) throw new Error('File exceeded the size cap mid-download')
      if (written.size === 0) throw new Error('File was empty')

      await rename(partial, target)
      this.progress.bytes += written.size
      return true
    } catch (err) {
      await rm(partial, { force: true }).catch(() => undefined)
      throw err
    }
  }

  /**
   * Where one file lands.
   *
   * The uploader's own filename is kept because it is what makes the library
   * searchable afterwards — but sanitised, and with the server's numeric id
   * appended when two posts in the thread share a name.
   */
  private destinationFor(file: ThreadFile, folder: string, taken: Set<string>): string {
    const base = sanitiseSegment(file.originalName) || String(file.tim)
    let name = `${base}${file.ext}`

    // The extension has to survive sanitising too — a name is only allowed here
    // if the library would index it.
    if (!isMediaFile(name) || extensionOf(name) !== file.ext) name = `${file.tim}${file.ext}`

    if (taken.has(name.toLowerCase())) name = `${base}-${file.tim}${file.ext}`
    taken.add(name.toLowerCase())

    return join(folder, name)
  }

  private setPhase(phase: ScrapeProgress['phase']): void {
    this.progress.phase = phase
    this.emitProgress()
  }

  private emitProgress(): void {
    this.emit('progress', this.status())
  }
}

/** One fetch, with the caller's cancel and a deadline both applied. */
async function request(url: string, signal: AbortSignal, timeoutMs: number): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs)

  try {
    return await fetch(url, {
      signal: AbortSignal.any([signal, timeout]),
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      // The thread JSON and the CDN are both public; sending credentials or
      // following a redirect off-host would be the app's problem, not theirs.
      redirect: 'follow',
    })
  } catch (err) {
    if (signal.aborted) throw err
    if (timeout.aborted) throw new Error(`${url} timed out after ${timeoutMs / 1000}s`)
    throw new Error(`Could not reach ${url}: ${describe(err)}`)
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.cause instanceof Error ? err.cause.message : err.message
  return String(err)
}

export const scraper = new Scraper()
