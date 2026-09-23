import { describe, expect, it } from 'vitest'
import { contentRange, parseRange, unsatisfiedContentRange } from '../src/main/protocol/range'

const SIZE = 1024

describe('parseRange', () => {
  it('treats a missing header as a request for the whole body', () => {
    expect(parseRange(null, SIZE)).toEqual({ kind: 'full' })
    expect(parseRange(undefined, SIZE)).toEqual({ kind: 'full' })
    expect(parseRange('', SIZE)).toEqual({ kind: 'full' })
  })

  it('handles the open-ended request media elements open with', () => {
    // This is the very first request a <video> makes. Getting it wrong means
    // nothing plays at all.
    expect(parseRange('bytes=0-', SIZE)).toEqual({ kind: 'partial', start: 0, end: 1023 })
  })

  it('handles a bounded range', () => {
    expect(parseRange('bytes=200-499', SIZE)).toEqual({ kind: 'partial', start: 200, end: 499 })
  })

  it('handles a single-byte range', () => {
    expect(parseRange('bytes=5-5', SIZE)).toEqual({ kind: 'partial', start: 5, end: 5 })
  })

  it('handles a suffix range as the final N bytes', () => {
    // Chromium asks for the tail to find the moov atom in a non-faststart MP4.
    expect(parseRange('bytes=-500', SIZE)).toEqual({ kind: 'partial', start: 524, end: 1023 })
  })

  it('clamps a suffix range longer than the file', () => {
    expect(parseRange('bytes=-5000', SIZE)).toEqual({ kind: 'partial', start: 0, end: 1023 })
  })

  it('clamps an end past EOF rather than rejecting it', () => {
    expect(parseRange('bytes=1000-9999', SIZE)).toEqual({ kind: 'partial', start: 1000, end: 1023 })
  })

  it('accepts the final byte', () => {
    expect(parseRange('bytes=1023-', SIZE)).toEqual({ kind: 'partial', start: 1023, end: 1023 })
  })

  it('rejects a start at or past EOF as unsatisfiable', () => {
    expect(parseRange('bytes=1024-', SIZE)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=2000-3000', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  it('rejects an inverted range', () => {
    expect(parseRange('bytes=500-200', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  it('rejects a zero-length suffix', () => {
    expect(parseRange('bytes=-0', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  it('cannot satisfy any range against an empty file', () => {
    expect(parseRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' })
  })

  it('is case-insensitive about the unit and tolerant of whitespace', () => {
    expect(parseRange('BYTES=0-99', SIZE)).toEqual({ kind: 'partial', start: 0, end: 99 })
    expect(parseRange('  bytes= 10 - 20 ', SIZE)).toEqual({ kind: 'partial', start: 10, end: 20 })
  })

  it('serves the first range of a multi-range request', () => {
    expect(parseRange('bytes=0-99,200-299', SIZE)).toEqual({ kind: 'partial', start: 0, end: 99 })
  })

  it('falls back to the full body on syntactic junk', () => {
    for (const header of ['items=0-99', 'bytes=abc', 'bytes=', 'bytes=1e3-', 'bytes=+5-10', 'bytes']) {
      expect(parseRange(header, SIZE), header).toEqual({ kind: 'full' })
    }
  })

  it('refuses digit strings long enough to lose integer precision', () => {
    expect(parseRange('bytes=99999999999999999999-', SIZE)).toEqual({ kind: 'full' })
  })
})

describe('content range headers', () => {
  it('formats a satisfied range', () => {
    expect(contentRange(200, 499, SIZE)).toBe('bytes 200-499/1024')
  })

  it('formats an unsatisfied range', () => {
    expect(unsatisfiedContentRange(SIZE)).toBe('bytes */1024')
  })
})
