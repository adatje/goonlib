/**
 * Finds what a video should be played against: its funscript if it has one,
 * or a curve worked out from its audio if not.
 *
 * A funscript is found the way every player finds one — a file with the same
 * name next to the video, ending `.funscript` instead. Multi-axis companions
 * (`clip.twist.funscript` and friends) are left alone: nothing here drives a
 * second axis, and picking one up by accident would play a twist as a stroke.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, posix } from 'node:path'
import type { ToyScript } from '@shared/toy'
import { parseFunscript } from '@shared/toy'
import { ensureParent, envelopePathFor } from '../cache'
import { getMedia } from '../db/media'
import { getMediaLocation } from '../db/queries'
import { runFfmpegCapture } from '../media/ffmpeg-run'
import { resolveWithinRoot } from '../protocol/confine'
import { ENVELOPE_STEP_MS, ENVELOPE_VERSION, envelope } from './envelope'

/**
 * Samples per second pulled out of the soundtrack.
 *
 * Loudness needs nothing like 44.1 kHz — it is an average over a tenth of a
 * second. 4 kHz keeps everything up to 2 kHz, enough that a busy top end
 * counts towards how loud the mix is, and an hour of audio is under thirty
 * megabytes to hold while it is measured, instead of three hundred.
 */
const ENVELOPE_RATE = 4000

export interface FoundScript {
  /** The file's name, for saying which script is playing. */
  name: string
  script: ToyScript
}

/** The sibling funscript for an item, or null when it has none. */
export async function funscriptFor(mediaId: number): Promise<FoundScript | null> {
  const location = getMediaLocation(mediaId)
  if (!location || location.kind !== 'video') return null

  const video = await resolveWithinRoot(location.rootPath, location.relPath)
  if (!video) return null

  const folder = dirname(video)
  const wanted = `${basename(video, extname(video))}.funscript`.toLowerCase()

  let entries: string[]
  try {
    entries = await readdir(folder)
  } catch {
    return null
  }

  // Compared case-insensitively: a script downloaded as `Clip.Funscript` next
  // to `clip.mp4` is plainly meant for it, whatever the filesystem thinks.
  const name = entries.find((entry) => entry.toLowerCase() === wanted)
  if (!name) return null

  // Confined like the video itself, so a symlink named like a script cannot be
  // used to read something outside the library.
  const relDir = posix.dirname(location.relPath.split('\\').join('/'))
  const path = await resolveWithinRoot(
    location.rootPath,
    relDir === '.' ? name : `${relDir}/${name}`,
  )
  if (!path) return null

  const actions = parseFunscript(await readFile(path, 'utf8'))
  return { name, script: { kind: 'strokes', actions } }
}

/**
 * A strength curve from the item's soundtrack, or null when it has none worth
 * following — no audio stream at all, or nothing louder than silence.
 *
 * Worked out once per file and cached; the second viewing starts instantly.
 */
export async function audioScriptFor(
  mediaId: number,
  signal?: AbortSignal,
): Promise<ToyScript | null> {
  const item = getMedia(mediaId)
  const location = getMediaLocation(mediaId)
  if (!item || !location || location.kind !== 'video') return null

  const cached = envelopePathFor(mediaId, item.mtime, ENVELOPE_VERSION)
  try {
    const levels = JSON.parse(await readFile(cached, 'utf8')) as unknown
    if (Array.isArray(levels)) return asScript(levels.map(Number))
  } catch {
    // Not worked out yet, or unreadable — either way, work it out.
  }

  const video = await resolveWithinRoot(location.rootPath, location.relPath)
  if (!video) return null

  let raw: Buffer
  try {
    raw = await runFfmpegCapture(
      [
        '-v', 'error',
        '-nostdin',
        '-i', video,
        // The `?` makes a silent video an empty result rather than an error.
        '-map', '0:a:0?',
        '-vn',
        '-ac', '1',
        '-ar', String(ENVELOPE_RATE),
        '-f', 's16le',
        'pipe:1',
      ],
      { signal },
    )
  } catch (err) {
    if (signal?.aborted) throw err
    // No audio stream produces no output, which the runner reports as a
    // failure. For this purpose it is simply a video with nothing to follow.
    console.log('[toy] no audio to follow for', mediaId, (err as Error).message)
    return null
  }

  // Copied into an aligned buffer: a Node Buffer can start at any byte of its
  // pool, and an Int16Array cannot.
  const aligned = new Int16Array(Math.floor(raw.length / 2))
  Buffer.from(aligned.buffer).set(raw.subarray(0, aligned.length * 2))
  const levels = envelope(aligned, ENVELOPE_RATE, ENVELOPE_STEP_MS)

  try {
    ensureParent(cached)
    await writeFile(cached, JSON.stringify(levels))
  } catch (err) {
    // Only a cache; the curve is still good for this viewing.
    console.error('[toy] could not cache envelope for', mediaId, err)
  }

  return asScript(levels)
}

function asScript(levels: number[]): ToyScript | null {
  if (!levels.some((level) => level > 0)) return null
  return { kind: 'levels', stepMs: ENVELOPE_STEP_MS, levels }
}
