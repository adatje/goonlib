import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { walk } from '../src/main/scan/walker'
import type { WalkEntry } from '../src/main/scan/walker'

let base: string
let root: string

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'goonlib-walk-'))
  root = join(base, 'library')

  await mkdir(join(root, 'clips', 'nested'), { recursive: true })
  await mkdir(join(root, '.hidden'), { recursive: true })
  await mkdir(join(base, 'elsewhere'), { recursive: true })

  await writeFile(join(root, 'a.mp4'), 'x'.repeat(10))
  await writeFile(join(root, 'b.JPG'), 'x'.repeat(20))
  await writeFile(join(root, 'notes.txt'), 'ignore me')
  await writeFile(join(root, '.DS_Store'), 'ignore me')
  await writeFile(join(root, 'clips', 'c.mkv'), 'x'.repeat(30))
  await writeFile(join(root, 'clips', 'nested', 'd.webm'), 'x'.repeat(40))
  await writeFile(join(root, '.hidden', 'e.mp4'), 'should not be indexed')
  await writeFile(join(base, 'elsewhere', 'outside.mp4'), 'should not be indexed')

  // Symlinks, both of which the walker must refuse.
  await symlink(join(base, 'elsewhere'), join(root, 'linked-dir'))
  await symlink(join(base, 'elsewhere', 'outside.mp4'), join(root, 'linked.mp4'))
})

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

async function collect(dir = root): Promise<WalkEntry[]> {
  const found: WalkEntry[] = []
  for await (const entry of walk(dir)) found.push(entry)
  return found.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

describe('walk', () => {
  it('finds media at every depth', async () => {
    const paths = (await collect()).map((e) => e.relPath)
    expect(paths).toEqual(['a.mp4', 'b.JPG', 'clips/c.mkv', 'clips/nested/d.webm'])
  })

  it('classifies images and videos', async () => {
    const byPath = new Map((await collect()).map((e) => [e.relPath, e]))
    expect(byPath.get('a.mp4')?.kind).toBe('video')
    expect(byPath.get('b.JPG')?.kind).toBe('image')
  })

  it('lower-cases extensions so case never splits the index', async () => {
    const byPath = new Map((await collect()).map((e) => [e.relPath, e]))
    expect(byPath.get('b.JPG')?.ext).toBe('.jpg')
    expect(byPath.get('b.JPG')?.name).toBe('b.JPG')
  })

  it('reports size and mtime', async () => {
    const byPath = new Map((await collect()).map((e) => [e.relPath, e]))
    expect(byPath.get('a.mp4')?.size).toBe(10)
    expect(byPath.get('clips/nested/d.webm')?.size).toBe(40)
    expect(byPath.get('a.mp4')?.mtime).toBeGreaterThan(0)
  })

  it('ignores non-media files', async () => {
    const paths = (await collect()).map((e) => e.relPath)
    expect(paths).not.toContain('notes.txt')
  })

  it('ignores dotfiles and dot-directories', async () => {
    const paths = (await collect()).map((e) => e.relPath)
    expect(paths).not.toContain('.DS_Store')
    expect(paths.some((p) => p.startsWith('.hidden'))).toBe(false)
  })

  it('refuses symlinks, so nothing outside the root is ever indexed', async () => {
    const paths = (await collect()).map((e) => e.relPath)
    expect(paths).not.toContain('linked.mp4')
    expect(paths.some((p) => p.startsWith('linked-dir'))).toBe(false)
  })

  it('stops promptly when aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const found: WalkEntry[] = []
    for await (const entry of walk(root, { signal: controller.signal })) found.push(entry)

    expect(found).toHaveLength(0)
  })

  it('reports an unreadable root instead of throwing', async () => {
    const errors: string[] = []
    const found = []
    for await (const entry of walk(join(base, 'does-not-exist'), {
      onError: (path) => errors.push(path),
    })) {
      found.push(entry)
    }

    expect(found).toHaveLength(0)
    expect(errors).toHaveLength(1)
  })

  it('walks a tree with more files than one stat batch', async () => {
    const big = join(base, 'big')
    await mkdir(big, { recursive: true })
    await Promise.all(
      Array.from({ length: 150 }, (_, i) => writeFile(join(big, `f${i}.mp4`), 'x')),
    )

    expect(await collect(big)).toHaveLength(150)
  })
})
