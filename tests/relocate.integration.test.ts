/**
 * The move, against a real filesystem.
 *
 * This is the one piece of the app that relocates a user's own files, so the
 * promise worth proving on disk rather than in a mock is the negative one:
 * nothing is ever overwritten, and a refused move leaves both files untouched.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { moveFile, uniqueName } from '../src/main/relocate'

let dir: string
let from: string
let to: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goonlib-move-'))
  from = join(dir, 'source')
  to = join(dir, 'destination')
  await mkdir(from)
  await mkdir(to)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('moveFile', () => {
  it('moves the file and leaves nothing behind', async () => {
    await writeFile(join(from, 'clip.webm'), 'original')

    await moveFile(join(from, 'clip.webm'), join(to, 'clip.webm'))

    expect(await readdir(from)).toEqual([])
    expect(await readFile(join(to, 'clip.webm'), 'utf8')).toBe('original')
  })

  it('refuses to overwrite, leaving both files as they were', async () => {
    await writeFile(join(from, 'clip.webm'), 'incoming')
    await writeFile(join(to, 'clip.webm'), 'do not lose me')

    await expect(moveFile(join(from, 'clip.webm'), join(to, 'clip.webm'))).rejects.toThrow(
      /already exists/,
    )

    // The point of the whole exercise: the file that was already there is
    // untouched, and the one that failed to move is still where it started.
    expect(await readFile(join(to, 'clip.webm'), 'utf8')).toBe('do not lose me')
    expect(await readFile(join(from, 'clip.webm'), 'utf8')).toBe('incoming')
  })

  it('fails rather than inventing a directory that is not there', async () => {
    await writeFile(join(from, 'clip.webm'), 'x')

    await expect(
      moveFile(join(from, 'clip.webm'), join(dir, 'nope', 'clip.webm')),
    ).rejects.toThrow()

    expect(await readFile(join(from, 'clip.webm'), 'utf8')).toBe('x')
  })

  it('lands a whole batch of same-named files alongside each other', async () => {
    // What the handler actually does: keep a listing of the destination, and
    // feed it back through uniqueName as each file arrives.
    const sources = ['a', 'b', 'c']
    for (const [i, body] of sources.entries()) {
      await mkdir(join(from, String(i)))
      await writeFile(join(from, String(i), 'clip.webm'), body)
    }
    await writeFile(join(to, 'clip.webm'), 'already here')

    const taken = new Set(await readdir(to))
    for (const [i] of sources.entries()) {
      const name = uniqueName(taken, 'clip.webm')
      await moveFile(join(from, String(i), 'clip.webm'), join(to, name))
      taken.add(name)
    }

    expect((await readdir(to)).sort()).toEqual([
      'clip (2).webm',
      'clip (3).webm',
      'clip (4).webm',
      'clip.webm',
    ])
    // Nothing clobbered the file that was there first.
    expect(await readFile(join(to, 'clip.webm'), 'utf8')).toBe('already here')
  })
})
