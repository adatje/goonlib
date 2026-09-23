/**
 * Locates the ffmpeg/ffprobe binaries.
 *
 * Order of preference: the binaries bundled with the app, then whatever is on the
 * user's PATH, then nothing. Bundled wins so a packaged build behaves identically
 * on a machine with no ffmpeg installed.
 */

import { execFileSync } from 'node:child_process'
import { accessSync, closeSync, constants, openSync, readSync } from 'node:fs'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import ffmpegStatic from 'ffmpeg-static'
import { ffmpegInstallHint } from '@shared/platform'
import { PLATFORM } from './platform'

/**
 * electron-builder keeps native binaries out of the asar archive, so paths that
 * resolve inside `app.asar` at runtime must be redirected to `app.asar.unpacked`.
 */
function unpacked(path: string): string {
  return path.includes('app.asar') ? path.replace('app.asar', 'app.asar.unpacked') : path
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** CPU type codes from the Mach-O header, keyed by Node's name for the arch. */
const MACHO_CPU: Record<string, number> = { x64: 0x01000007, arm64: 0x0100000c }

/** ELF `e_machine` values, keyed the same way. */
const ELF_MACHINE: Record<string, number> = { x64: 0x3e, arm64: 0xb7, ia32: 0x03, arm: 0x28 }

/**
 * Whether a binary was built for the CPU this process is running on.
 *
 * Being executable is not enough. ffprobe-static shipped an Intel ffprobe in
 * its arm64 folder, and on an Apple Silicon Mac without Rosetta that binary
 * passes every permission check and then fails to spawn with EBADARCH — which
 * surfaced as every probe and every preparation failing, with an error that
 * said nothing about why. Reading the header lets a wrong-architecture binary
 * be passed over for one on PATH instead.
 *
 * Only a header this recognises can rule a binary out; anything else (a
 * Windows .exe, a format not listed) is given the benefit of the doubt.
 */
export function matchesArch(path: string, arch: string = process.arch): boolean {
  const header = Buffer.alloc(64)
  let read = 0
  try {
    const fd = openSync(path, 'r')
    try {
      read = readSync(fd, header, 0, header.length, 0)
    } finally {
      closeSync(fd)
    }
  } catch {
    return false
  }
  if (read < 8) return false

  // Thin 64-bit Mach-O, little-endian: magic, then the CPU type.
  if (header.readUInt32LE(0) === 0xfeedfacf) {
    const wanted = MACHO_CPU[arch]
    return wanted === undefined || header.readInt32LE(4) === wanted
  }

  // Universal Mach-O: big-endian, a count, then 20-byte entries naming a CPU each.
  if (header.readUInt32BE(0) === 0xcafebabe) {
    const wanted = MACHO_CPU[arch]
    if (wanted === undefined) return true
    const count = header.readUInt32BE(4)
    for (let i = 0; i < count && 8 + i * 20 + 4 <= read; i += 1) {
      if (header.readInt32BE(8 + i * 20) === wanted) return true
    }
    return false
  }

  // ELF: e_machine is a 16-bit field at offset 18, in the file's own byte order.
  if (header.readUInt32BE(0) === 0x7f454c46 && read >= 20) {
    const wanted = ELF_MACHINE[arch]
    const machine = header[5] === 2 ? header.readUInt16BE(18) : header.readUInt16LE(18)
    return wanted === undefined || machine === wanted
  }

  return true
}

function bundled(raw: string | null | undefined): string | null {
  if (!raw) return null
  const path = unpacked(raw)
  if (!isExecutable(path)) return null
  if (!matchesArch(path)) {
    console.warn(`[ffmpeg] ignoring ${path}: it is not built for ${process.arch}`)
    return null
  }
  return path
}

/** Windows answers "where"; everything else answers "which". */
function onSystemPath(binary: string): string | null {
  const [command, args] =
    process.platform === 'win32'
      ? ['where', [binary]]
      : ['/usr/bin/env', ['which', binary]]

  try {
    const found = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      // `where` lists every match, one per line; the first is the one that wins.
      .split(/\r?\n/)[0]
      ?.trim()
    return found && isExecutable(found) ? found : null
  } catch {
    return null
  }
}

function resolver(raw: string | null | undefined, binary: string): () => string | null {
  let cached: string | null | undefined
  return () => {
    if (cached === undefined) cached = bundled(raw) ?? onSystemPath(binary)
    return cached
  }
}

export const ffmpegPath = resolver(ffmpegStatic, 'ffmpeg')
export const ffprobePath = resolver(ffprobeInstaller.path, 'ffprobe')

function required(path: string | null, binary: string): string {
  if (!path) {
    throw new Error(
      `${binary} could not be found - it is neither bundled with this build nor on your PATH. ` +
        `Install it (${ffmpegInstallHint(PLATFORM)}) and restart GoonLib.`,
    )
  }
  return path
}

/** Throws with an actionable message rather than letting a spawn fail cryptically. */
export function requireFfmpeg(): string {
  return required(ffmpegPath(), 'ffmpeg')
}

export function requireFfprobe(): string {
  return required(ffprobePath(), 'ffprobe')
}
