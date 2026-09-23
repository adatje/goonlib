import { describe, expect, it } from 'vitest'
import { containingRoot, relPathFor, uniqueName } from '../src/main/relocate'

const roots = [
  { id: 1, path: '/Volumes/Media/WTMYWTSC' },
  { id: 2, path: '/Volumes/Media/Tax Returns 2017' },
]

describe('containingRoot', () => {
  it('finds the root a destination sits in', () => {
    const landing = containingRoot(roots, '/Volumes/Media/WTMYWTSC/cum/oral')
    expect(landing?.root.id).toBe(1)
    expect(landing?.relDir).toBe('cum/oral')
  })

  it('reports the root itself as an empty relative directory', () => {
    expect(containingRoot(roots, '/Volumes/Media/WTMYWTSC')?.relDir).toBe('')
  })

  it('returns null for somewhere outside every root', () => {
    expect(containingRoot(roots, '/Users/ada/Desktop')).toBeNull()
  })

  it('is not fooled by a sibling whose name starts the same', () => {
    // '/Volumes/Media/WTMYWTSC-old' must not be read as inside '/…/WTMYWTSC'.
    expect(containingRoot(roots, '/Volumes/Media/WTMYWTSC-old/x')).toBeNull()
  })

  it('does not treat a parent directory as containing', () => {
    expect(containingRoot(roots, '/Volumes/Media')).toBeNull()
  })

  it('picks the most specific root when they nest', () => {
    // The outer root would give a rel_path the inner root's scan would claim
    // as a second row for the same file.
    const nested = [
      { id: 1, path: '/Volumes/Media' },
      { id: 2, path: '/Volumes/Media/WTMYWTSC' },
    ]

    const landing = containingRoot(nested, '/Volumes/Media/WTMYWTSC/cum')
    expect(landing?.root.id).toBe(2)
    expect(landing?.relDir).toBe('cum')
  })
})

describe('uniqueName', () => {
  it('leaves a free name alone', () => {
    expect(uniqueName(new Set(), 'clip.webm')).toBe('clip.webm')
  })

  it('suffixes a taken name', () => {
    expect(uniqueName(new Set(['clip.webm']), 'clip.webm')).toBe('clip (2).webm')
  })

  it('keeps counting past the first suffix', () => {
    const taken = new Set(['clip.webm', 'clip (2).webm', 'clip (3).webm'])
    expect(uniqueName(taken, 'clip.webm')).toBe('clip (4).webm')
  })

  it('matches case-insensitively, as the filesystem does', () => {
    // Treating these as different names hands back one that overwrites on move.
    expect(uniqueName(new Set(['clip.webm']), 'CLIP.webm')).toBe('CLIP (2).webm')
  })

  it('keeps the extension on the end', () => {
    expect(uniqueName(new Set(['a.tar.gz']), 'a.tar.gz')).toBe('a.tar (2).gz')
  })

  it('treats a leading dot as part of the name', () => {
    expect(uniqueName(new Set(['.hidden']), '.hidden')).toBe('.hidden (2)')
  })

  it('handles a name with no extension', () => {
    expect(uniqueName(new Set(['README']), 'README')).toBe('README (2)')
  })
})

describe('relPathFor', () => {
  it('is just the filename at the root', () => {
    expect(relPathFor('', 'clip.webm')).toBe('clip.webm')
  })

  it('joins a subdirectory', () => {
    expect(relPathFor('cum/oral', 'clip.webm')).toBe('cum/oral/clip.webm')
  })
})
