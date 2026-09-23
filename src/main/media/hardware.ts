/**
 * Detects whether this ffmpeg build has a hardware H.264 encoder.
 *
 * Probed once and cached: `ffmpeg -encoders` costs a process spawn, and the answer
 * cannot change while the app is running.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ffmpegPath } from '../ffmpeg'

const run = promisify(execFile)

let cached: boolean | undefined

export async function hasHardwareEncoder(): Promise<boolean> {
  if (cached !== undefined) return cached

  const binary = ffmpegPath()
  if (!binary) {
    cached = false
    return cached
  }

  try {
    const { stdout } = await run(binary, ['-hide_banner', '-encoders'], {
      maxBuffer: 4 * 1024 * 1024,
      timeout: 15_000,
    })
    cached = stdout.includes('h264_videotoolbox')
  } catch {
    // If we can't tell, assume not — libx264 is slower but always works.
    cached = false
  }

  return cached
}

/** Test seam. */
export function resetHardwareCache(): void {
  cached = undefined
}
