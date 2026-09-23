import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveWithinRoot } from '../src/main/protocol/confine'

let base: string
let root: string
let outside: string

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'goonlib-confine-'))
  root = join(base, 'library')
  outside = join(base, 'private')

  await mkdir(join(root, 'clips'), { recursive: true })
  await mkdir(outside, { recursive: true })

  await writeFile(join(root, 'clips', 'a.mp4'), 'inside')
  await writeFile(join(outside, 'secrets.txt'), 'outside')

  // A symlink planted inside the library that points out of it — the attack this
  // whole module exists to stop.
  await symlink(join(outside, 'secrets.txt'), join(root, 'escape.txt'))
  await symlink(outside, join(root, 'escape-dir'))
})

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('resolveWithinRoot', () => {
  it('resolves a genuine file inside the root', async () => {
    const resolved = await resolveWithinRoot(root, 'clips/a.mp4')
    expect(resolved).not.toBeNull()
    expect(resolved?.endsWith('/library/clips/a.mp4')).toBe(true)
  })

  it('refuses a symlink pointing outside the root', async () => {
    expect(await resolveWithinRoot(root, 'escape.txt')).toBeNull()
  })

  it('refuses a path routed through a symlinked directory', async () => {
    expect(await resolveWithinRoot(root, 'escape-dir/secrets.txt')).toBeNull()
  })

  it('refuses traversal with ..', async () => {
    expect(await resolveWithinRoot(root, '../private/secrets.txt')).toBeNull()
    expect(await resolveWithinRoot(root, 'clips/../../private/secrets.txt')).toBeNull()
  })

  it('refuses an absolute path', async () => {
    expect(await resolveWithinRoot(root, join(outside, 'secrets.txt'))).toBeNull()
    expect(await resolveWithinRoot(root, '/etc/passwd')).toBeNull()
  })

  it('refuses the root itself', async () => {
    expect(await resolveWithinRoot(root, '.')).toBeNull()
    expect(await resolveWithinRoot(root, '')).toBeNull()
  })

  it('returns null for a file that does not exist', async () => {
    expect(await resolveWithinRoot(root, 'clips/ghost.mp4')).toBeNull()
  })

  it('returns null when the root itself is gone', async () => {
    expect(await resolveWithinRoot(join(base, 'no-such-root'), 'a.mp4')).toBeNull()
  })
})
