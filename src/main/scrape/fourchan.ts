/**
 * Reading a 4chan thread through its public JSON API.
 *
 * Everything here is parsing and naming — no network, no filesystem — so the
 * two things most likely to go wrong can be tested directly: which URLs are
 * accepted, and what a thread's subject turns into on disk.
 *
 * The API is the documented read-only one (a.4cdn.org). Its terms ask for at
 * most one request a second, which is why the scraper makes exactly one call
 * per thread and pulls the media from the CDN afterwards.
 */

import { isMediaFile } from '../scan/extensions'

/** Hosts a thread URL may name. Anything else is refused. */
const THREAD_HOSTS = new Set(['boards.4chan.org', 'boards.4channel.org'])

const API_HOST = 'https://a.4cdn.org'
const CDN_HOST = 'https://i.4cdn.org'

/** Board slugs are short and lowercase alphanumeric — `g`, `wg`, `3`, `vt`. */
const BOARD = /^[a-z0-9]{1,10}$/

/** Longest folder name we will create, before the uniqueness suffix. */
const MAX_TITLE = 80

export interface ThreadRef {
  board: string
  threadNo: number
}

export interface ThreadFile {
  postNo: number
  /** Server-assigned id, unique within the board. Also the CDN filename. */
  tim: number
  /** Lower-cased, dot-prefixed. */
  ext: string
  /** The uploader's original filename, without extension. Untrusted. */
  originalName: string
  sizeBytes: number
  url: string
}

export interface Thread {
  ref: ThreadRef
  /** Already sanitised — safe to use as a single path segment. */
  folderName: string
  files: ThreadFile[]
  /** Attachments skipped because the library does not index that format. */
  skippedFormats: number
}

/**
 * The shape we read out of the API response. Every field is optional because
 * only some posts carry an attachment, and none of it is trustworthy.
 */
interface ApiPost {
  no?: unknown
  sub?: unknown
  tim?: unknown
  ext?: unknown
  filename?: unknown
  fsize?: unknown
}

/**
 * Pulls the board and thread number out of a thread URL.
 *
 * Returns null for anything that isn't a 4chan thread — including other hosts.
 * That refusal is the point: without it, this would be a general "fetch any URL
 * the user pasted" primitive living in the main process.
 */
export function parseThreadUrl(input: string): ThreadRef | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!THREAD_HOSTS.has(url.hostname.toLowerCase())) return null

  // /{board}/thread/{no} — optionally followed by a title slug.
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 3) return null

  const [board, marker, rawNo] = parts
  if (!board || !BOARD.test(board) || marker !== 'thread') return null

  const threadNo = Number(rawNo)
  if (!Number.isSafeInteger(threadNo) || threadNo <= 0) return null

  return { board, threadNo }
}

/** Where the thread's JSON lives. */
export function threadApiUrl(ref: ThreadRef): string {
  return `${API_HOST}/${ref.board}/thread/${ref.threadNo}.json`
}

/**
 * Turns an API response into the files worth downloading.
 *
 * Anything the library wouldn't index anyway is dropped here rather than
 * downloaded and ignored — on 4chan that is mainly `.swf` and `.pdf`.
 */
export function readThread(ref: ThreadRef, body: unknown): Thread {
  const posts = Array.isArray((body as { posts?: unknown })?.posts)
    ? ((body as { posts: ApiPost[] }).posts ?? [])
    : []

  const files: ThreadFile[] = []
  let skippedFormats = 0

  for (const post of posts) {
    // An outage page, an API change, or a stray null in the array must not take
    // the whole scrape down.
    if (!post || typeof post !== 'object') continue

    const tim = numberOf(post.tim)
    const ext = typeof post.ext === 'string' ? post.ext.toLowerCase() : null

    // No `tim`/`ext` pair means the post has no attachment at all.
    if (tim === null || !ext) continue

    const originalName = typeof post.filename === 'string' ? post.filename : String(tim)

    if (!isMediaFile(`x${ext}`)) {
      skippedFormats += 1
      continue
    }

    files.push({
      postNo: numberOf(post.no) ?? tim,
      tim,
      ext,
      originalName,
      sizeBytes: numberOf(post.fsize) ?? 0,
      // Built from the server's own numeric id, never from the uploader's
      // filename — so nothing user-controlled reaches the request path.
      url: `${CDN_HOST}/${ref.board}/${tim}${ext}`,
    })
  }

  return {
    ref,
    folderName: folderNameFor(ref, posts[0]?.sub),
    files,
    skippedFormats,
  }
}

/**
 * The folder a thread's files go into: its subject, or the thread number when
 * it has none — which is most threads on most boards.
 *
 * The board is included in the fallback so two threads that happen to share a
 * number across boards can't land in the same folder.
 */
export function folderNameFor(ref: ThreadRef, subject: unknown): string {
  const cleaned = typeof subject === 'string' ? sanitiseSegment(decodeEntities(subject)) : ''
  return cleaned || `${ref.board}-${ref.threadNo}`
}

/**
 * Makes a string safe to use as one path segment.
 *
 * This is a security boundary, not tidiness: the subject and the filenames come
 * from whoever made the post, and a name containing `..` or a separator would
 * otherwise write outside the download folder.
 */
export function sanitiseSegment(value: string): string {
  const collapsed = value
    // Path separators, and the characters Windows and macOS reject in names.
    .replace(/[/\\:*?"<>|]/g, ' ')
    // Control characters, including the NUL that can truncate a path in C APIs.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')

  // Trimmed twice: once to clean the edges, and again after the length cap,
  // because slicing can expose a fresh trailing dot or space.
  return trimEdges(trimEdges(collapsed).slice(0, MAX_TITLE))
}

/**
 * Removes leading and trailing runs of dots and spaces together.
 *
 * They have to go in one pass rather than dots-then-spaces: `../../x` becomes
 * `.. .. x` once separators are blanked, and stripping only the first dot run
 * leaves a space that a later trim removes — re-exposing a leading dot and
 * quietly producing a hidden folder.
 */
function trimEdges(value: string): string {
  return value.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
}

/**
 * 4chan HTML-escapes subjects, so a thread called `Bob's "stuff" & co` arrives
 * as `Bob&#039;s &quot;stuff&quot; &amp; co`. Left alone those entities end up
 * in the folder name literally.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => safeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => safeCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Ampersand last, so `&amp;lt;` decodes to the text `&lt;` rather than `<`.
    .replace(/&amp;/g, '&')
}

function safeCodePoint(code: number): string {
  if (!Number.isInteger(code) || code < 32 || code > 0x10ffff) return ' '
  try {
    return String.fromCodePoint(code)
  } catch {
    return ' '
  }
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}
