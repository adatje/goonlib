/**
 * HTTP Range header parsing for the media:// protocol.
 *
 * This is the highest-risk piece of the whole app. If range requests aren't
 * honoured correctly, video *appears* to work — it plays from the start — and then
 * seeking silently stalls or throws the element into an error state. So the logic
 * lives here, pure and dependency-free, with its own tests.
 *
 * Reference: RFC 9110 §14.
 */

export type RangeResult =
  /** No (or unusable) Range header — respond 200 with the whole body. */
  | { kind: 'full' }
  /** A satisfiable range — respond 206 with Content-Range. Both bounds inclusive. */
  | { kind: 'partial'; start: number; end: number }
  /** Syntactically valid but out of bounds — respond 416. */
  | { kind: 'unsatisfiable' }

const BYTES_UNIT = /^bytes=(.+)$/i

/**
 * Parses a Range header against a known resource size.
 *
 * Deliberate simplifications, both allowed by the spec:
 *  - A malformed header is ignored rather than rejected (`full`), which is what a
 *    server is permitted to do and is friendlier than a 400.
 *  - Multi-range requests serve only the first range. Media elements effectively
 *    never send these, and a real multipart/byteranges response would be a lot of
 *    machinery for no benefit.
 */
export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (!header) return { kind: 'full' }

  const unit = BYTES_UNIT.exec(header.trim())
  if (!unit?.[1]) return { kind: 'full' }

  const first = unit[1].split(',')[0]?.trim()
  if (!first) return { kind: 'full' }

  const dash = first.indexOf('-')
  if (dash === -1) return { kind: 'full' }

  const startText = first.slice(0, dash).trim()
  const endText = first.slice(dash + 1).trim()

  // A zero-length resource can satisfy no range at all.
  if (size <= 0) return { kind: 'unsatisfiable' }

  if (startText === '') {
    // Suffix form: "bytes=-500" means the *last* 500 bytes.
    if (endText === '' || !isNonNegativeInt(endText)) return { kind: 'full' }
    const suffixLength = Number(endText)
    if (suffixLength === 0) return { kind: 'unsatisfiable' }
    const start = Math.max(0, size - suffixLength)
    return { kind: 'partial', start, end: size - 1 }
  }

  if (!isNonNegativeInt(startText)) return { kind: 'full' }
  const start = Number(startText)

  // A start at or past EOF is unsatisfiable; note that this is distinct from the
  // common "bytes=0-" open-ended request, which is satisfiable and very frequent.
  if (start >= size) return { kind: 'unsatisfiable' }

  if (endText === '') return { kind: 'partial', start, end: size - 1 }

  if (!isNonNegativeInt(endText)) return { kind: 'full' }
  const requestedEnd = Number(endText)
  if (requestedEnd < start) return { kind: 'unsatisfiable' }

  // An end past EOF is clamped rather than rejected — browsers routinely ask for
  // more than exists when probing the tail of a file.
  return { kind: 'partial', start, end: Math.min(requestedEnd, size - 1) }
}

function isNonNegativeInt(text: string): boolean {
  // Guard against "+5", "1e3", " 5", and absurdly long digit strings.
  if (!/^\d{1,15}$/.test(text)) return false
  return Number.isSafeInteger(Number(text))
}

/** The `Content-Range` value for a 206, e.g. `bytes 200-1023/1024`. */
export function contentRange(start: number, end: number, size: number): string {
  return `bytes ${start}-${end}/${size}`
}

/** The `Content-Range` value for a 416, e.g. `bytes * /1024` (without the space). */
export function unsatisfiedContentRange(size: number): string {
  return `bytes */${size}`
}
