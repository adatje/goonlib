/**
 * Telling a binary built for this CPU from one that is not.
 *
 * ffprobe-static shipped an Intel ffprobe labelled arm64, and on an Apple
 * Silicon Mac without Rosetta it failed to spawn with nothing in the error to
 * say why. Headers are built by hand here, so the check is tested against each
 * format without depending on whichever binaries happen to be installed.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('ffmpeg-static', () => ({ default: null }))
vi.mock('@ffprobe-installer/ffprobe', () => ({ default: { path: '' } }))

const { matchesArch } = await import('../src/main/ffmpeg')

const workspace = await mkdtemp(join(tmpdir(), 'goonlib-arch-'))

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true })
})

async function binary(name: string, header: Buffer): Promise<string> {
  const path = join(workspace, name)
  await writeFile(path, Buffer.concat([header, Buffer.alloc(64)]))
  return path
}

function thinMachO(cpu: number): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32LE(0xfeedfacf, 0)
  header.writeInt32LE(cpu, 4)
  return header
}

function fatMachO(cpus: number[]): Buffer {
  const header = Buffer.alloc(8 + cpus.length * 20)
  header.writeUInt32BE(0xcafebabe, 0)
  header.writeUInt32BE(cpus.length, 4)
  cpus.forEach((cpu, i) => header.writeInt32BE(cpu, 8 + i * 20))
  return header
}

function elf(machine: number): Buffer {
  const header = Buffer.alloc(20)
  header.writeUInt32BE(0x7f454c46, 0)
  header[5] = 1 // little-endian
  header.writeUInt16LE(machine, 18)
  return header
}

const X64 = 0x01000007
const ARM64 = 0x0100000c

describe('binary architecture', () => {
  it('turns down an Intel Mach-O on arm64, the case that broke ffprobe', async () => {
    const path = await binary('intel', thinMachO(X64))
    expect(matchesArch(path, 'arm64')).toBe(false)
    expect(matchesArch(path, 'x64')).toBe(true)
  })

  it('accepts a universal binary that contains this CPU', async () => {
    const path = await binary('universal', fatMachO([X64, ARM64]))
    expect(matchesArch(path, 'arm64')).toBe(true)
    expect(matchesArch(await binary('intel-only-fat', fatMachO([X64])), 'arm64')).toBe(false)
  })

  it('reads the machine from an ELF header', async () => {
    const path = await binary('linux-x64', elf(0x3e))
    expect(matchesArch(path, 'x64')).toBe(true)
    expect(matchesArch(path, 'arm64')).toBe(false)
  })

  it('gives a format it does not know the benefit of the doubt', async () => {
    const path = await binary('windows', Buffer.from('MZ\x90\x00\x03\x00\x00\x00'))
    expect(matchesArch(path, 'x64')).toBe(true)
  })

  it('says no to a file it cannot read', () => {
    expect(matchesArch(join(workspace, 'missing'), 'arm64')).toBe(false)
  })
})
