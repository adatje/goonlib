/**
 * EXIF read from real files: a photo that has it, and one that does not.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readExif } from '../src/main/media/exif'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goonlib-exif-'))
  const blank = (): ReturnType<typeof sharp> => sharp({ create: { width: 8, height: 8, channels: 3, background: '#f0f' } })
  await blank()
    .withExif({ IFD0: { Make: 'Canon', Model: 'EOS R5', Software: 'GoonTest' } })
    .jpeg()
    .toFile(join(dir, 'camera.jpg'))
  await blank().png().toFile(join(dir, 'plain.png'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('reading EXIF', () => {
  it('finds the camera in a photo that records it', async () => {
    const exif = await readExif(join(dir, 'camera.jpg'), '.jpg')
    expect(exif).toMatchObject({ make: 'Canon', model: 'EOS R5', software: 'GoonTest', location: null })
  })

  it('says nothing for a file without it', async () => {
    expect(await readExif(join(dir, 'plain.png'), '.png')).toBeNull()
  })

  it('does not try files that cannot have it', async () => {
    expect(await readExif(join(dir, 'camera.jpg'), '.gif')).toBeNull()
  })
})
