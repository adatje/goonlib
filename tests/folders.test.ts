import { describe, expect, it } from 'vitest'
import { escapeLike } from '../src/main/db/folders'

describe('escapeLike', () => {
  it('leaves ordinary folder names alone', () => {
    expect(escapeLike('holiday photos')).toBe('holiday photos')
    expect(escapeLike('clips/2024/')).toBe('clips/2024/')
  })

  it('escapes the single-character wildcard', () => {
    // Without this, a folder named `a_b` also matches `axb`, `a-b`, and so on —
    // silently pulling in sibling folders.
    expect(escapeLike('a_b')).toBe('a\\_b')
  })

  it('escapes the multi-character wildcard', () => {
    expect(escapeLike('100%_done')).toBe('100\\%\\_done')
  })

  it('escapes the escape character itself', () => {
    expect(escapeLike('back\\slash')).toBe('back\\\\slash')
  })

  it('handles a name that is nothing but wildcards', () => {
    expect(escapeLike('%%%')).toBe('\\%\\%\\%')
  })

  it('is a no-op on the empty prefix used for a root', () => {
    expect(escapeLike('')).toBe('')
  })
})
