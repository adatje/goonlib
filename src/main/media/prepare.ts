/**
 * Prepares a video for playback, producing a file Chromium can actually decode.
 *
 * Remuxes and transcodes are written to the cache and then served as ordinary
 * files, rather than streamed live as fragmented MP4. That's the important call
 * here: a live fMP4 stream cannot answer range requests, so seeking in it either
 * stalls or silently does nothing. Materialising costs disk, which cache eviction
 * reclaims; the alternative costs the feature.
 */

import { EventEmitter } from 'node:events'
import { access, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { PreparedMedia } from '@shared/types'
import { ensureParent, preparedPathFor, transcodeDir } from '../cache'
import { cacheCap } from '../db/settings'
import { evictCache, touchPrepared } from './evict'
import { getMedia } from '../db/media'
import { resolveWithinRoot } from '../protocol/confine'
import { listRoots } from '../db/queries'
import { planPlayback } from './capability'
import { buildPrepareArgs } from './encoder'
import { runFfmpeg } from './ffmpeg-run'
import { hasHardwareEncoder } from './hardware'

export interface PrepareProgress {
  id: number
  percent: number
  message: string
}

class Preparer extends EventEmitter {
  /** Work already running, so two plays of the same file share one encode. */
  private inFlight = new Map<number, Promise<PreparedMedia>>()
  private cancels = new Map<number, AbortController>()

  async prepare(id: number): Promise<PreparedMedia> {
    const existing = this.inFlight.get(id)
    if (existing) return existing

    const task = this.run(id).finally(() => {
      this.inFlight.delete(id)
      this.cancels.delete(id)
    })

    this.inFlight.set(id, task)
    return task
  }

  cancel(id: number): void {
    this.cancels.get(id)?.abort()
  }

  private async run(id: number): Promise<PreparedMedia> {
    const item = getMedia(id)
    if (!item) throw new Error(`No media with id ${id}`)

    // Images and already-playable video need nothing done to them.
    if (item.kind === 'image' || item.playbackTier === 'native') {
      return { id, url: `media://play/${id}?m=${item.mtime}`, tier: item.playbackTier, reason: 'Plays directly' }
    }

    const plan = planPlayback(item.ext, item.vcodec, item.acodec)
    const output = preparedPathFor(id, item.mtime)

    if (await exists(output)) {
      return { id, url: `media://play/${id}?m=${item.mtime}`, tier: item.playbackTier, reason: plan.reason }
    }

    const root = listRoots().find((r) => r.id === item.rootId)
    if (!root) throw new Error('The folder this item belongs to is no longer in the library')

    const input = await resolveWithinRoot(root.path, item.relPath)
    if (!input) throw new Error('This file is missing or is no longer inside its library folder')

    const controller = new AbortController()
    this.cancels.set(id, controller)

    ensureParent(output)

    // Encode to a temporary name and rename on success. A crash mid-encode must
    // never leave a truncated file sitting where a valid preparation should be —
    // it would look cached and play as a broken stub forever.
    const partial = `${output}.part`

    this.emit('progress', { id, percent: 0, message: plan.reason } satisfies PrepareProgress)

    try {
      await runFfmpeg(
        buildPrepareArgs({
          input,
          output: partial,
          plan,
          hardware: await hasHardwareEncoder(),
          width: item.width,
          height: item.height,
        }),
        {
          signal: controller.signal,
          onProgress: (outTimeUs) => {
            if (!item.durationMs || item.durationMs <= 0) return
            const percent = Math.min(99, Math.round((outTimeUs / 1000 / item.durationMs) * 100))
            this.emit('progress', { id, percent, message: plan.reason } satisfies PrepareProgress)
          },
        },
      )

      await rename(partial, output)
      this.emit('progress', { id, percent: 100, message: 'Ready' } satisfies PrepareProgress)

      // Reclaim space after writing, not before: evicting first could delete the
      // very file another player is about to ask for.
      void evictCache(transcodeDir(), cacheCap()).catch(() => undefined)
    } catch (err) {
      await rm(partial, { force: true }).catch(() => undefined)
      throw err
    }

    return { id, url: `media://play/${id}?m=${item.mtime}`, tier: item.playbackTier, reason: plan.reason }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

export const preparer = new Preparer()

/**
 * Resolves the file that should actually be streamed for an item: the original
 * when it's directly playable, otherwise its prepared copy.
 */
export async function playablePathFor(id: number): Promise<string | null> {
  const item = getMedia(id)
  if (!item) return null

  if (item.kind === 'image' || item.playbackTier === 'native') {
    const root = listRoots().find((r) => r.id === item.rootId)
    if (!root) return null
    return resolveWithinRoot(root.path, item.relPath)
  }

  const prepared = preparedPathFor(id, item.mtime)
  if (!(await exists(prepared))) return null

  // Serving counts as use, which is what keeps a file the user actually watches
  // from being evicted ahead of one they prepared and abandoned.
  void touchPrepared(prepared)
  return prepared
}
