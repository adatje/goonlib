import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cacheSize, evictCache, touchPrepared } from '../src/main/media/evict'

let dir: string

/** Writes a sharded cache entry of `size` bytes with a fixed mtime. */
async function entry(name: string, size: number, ageMinutes: number): Promise<string> {
  const shard = join(dir, name.slice(0, 2))
  await mkdir(shard, { recursive: true })

  const path = join(shard, name)
  await writeFile(path, Buffer.alloc(size, 1))

  const when = new Date(Date.now() - ageMinutes * 60_000)
  await utimes(path, when, when)

  return path
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goonlib-evict-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('cacheSize', () => {
  it('totals entries across shards', async () => {
    await entry('aa-1.mp4', 1000, 1)
    await entry('bb-2.mp4', 2000, 1)
    expect(await cacheSize(dir)).toBe(3000)
  })

  it('reports zero for a directory that does not exist yet', async () => {
    expect(await cacheSize(join(dir, 'nope'))).toBe(0)
  })
})

describe('evictCache', () => {
  it('does nothing when already under the cap', async () => {
    await entry('aa-1.mp4', 1000, 1)
    const result = await evictCache(dir, 5000)

    expect(result.removed).toBe(0)
    expect(result.remaining).toBe(1000)
  })

  it('evicts oldest first until the cap is met', async () => {
    const oldest = await entry('aa-1.mp4', 1000, 60)
    const middle = await entry('bb-2.mp4', 1000, 30)
    const newest = await entry('cc-3.mp4', 1000, 1)

    const result = await evictCache(dir, 1500)

    expect(result.removed).toBe(2)
    expect(result.remaining).toBeLessThanOrEqual(1500)

    // The two least recently used are gone; the freshest survives.
    await expect(stat(oldest)).rejects.toThrow()
    await expect(stat(middle)).rejects.toThrow()
    expect((await stat(newest)).size).toBe(1000)
  })

  it('stops as soon as it is under the cap rather than clearing everything', async () => {
    await entry('aa-1.mp4', 1000, 60)
    await entry('bb-2.mp4', 1000, 30)
    await entry('cc-3.mp4', 1000, 1)

    const result = await evictCache(dir, 2500)
    expect(result.removed).toBe(1)
    expect(result.remaining).toBe(2000)
  })

  it('can empty the cache when the cap is smaller than any single entry', async () => {
    await entry('aa-1.mp4', 1000, 5)
    const result = await evictCache(dir, 0)

    expect(result.removed).toBe(1)
    expect(result.remaining).toBe(0)
  })

  it('handles a missing directory without throwing', async () => {
    const result = await evictCache(join(dir, 'nope'), 100)
    expect(result).toEqual({ removed: 0, freed: 0, remaining: 0 })
  })
})

describe('touchPrepared', () => {
  it('makes a file the most recent, protecting it from the next eviction', async () => {
    const old = await entry('aa-1.mp4', 1000, 60)
    await entry('bb-2.mp4', 1000, 30)

    // Playing the older file should save it and cost the other one instead.
    await touchPrepared(old)
    await evictCache(dir, 1500)

    expect((await stat(old)).size).toBe(1000)
    await expect(stat(join(dir, 'bb', 'bb-2.mp4'))).rejects.toThrow()
  })

  it('ignores a file that no longer exists', async () => {
    await expect(touchPrepared(join(dir, 'gone.mp4'))).resolves.toBeUndefined()
  })
})
