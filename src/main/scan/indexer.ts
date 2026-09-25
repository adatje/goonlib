/**
 * Orchestrates the scan.
 *
 * Runs as a sequence of stages — walk, probe, thumbnail — where each stage records
 * its outcome on the row itself. Nothing is ever marked "in flight" in the
 * database, so killing the app mid-scan simply leaves that work pending and the
 * next run picks up exactly where it left off.
 *
 * There are no worker threads here on purpose: the expensive work is either a
 * child process (ffprobe/ffmpeg) or sharp, whose libvips calls run on their own
 * native thread pool. Both already release the event loop, so adding worker
 * threads would buy nothing but complexity.
 */

import { EventEmitter } from 'node:events'
import { cpus } from 'node:os'
import type { MediaKind, ScanPhase, ScanProgress } from '@shared/types'
import { classifyItem } from '../ai/classify'
import { discardDerived, spritePathFor, thumbPathFor } from '../cache'
import {
  applyHashResult,
  applyProbeResult,
  applySpriteResult,
  claimPending,
  countPending,
  deleteMedia,
  missingMediaIds,
  setStageState,
  upsertMediaBatch,
} from '../db/media'
import type { PendingItem, StageColumn, UpsertEntry } from '../db/media'
import { listRoots } from '../db/queries'
import { aiReady, aiSettings } from '../db/settings'
import { resolveWithinRoot } from '../protocol/confine'
import { hashItem } from './hash'
import { probeFile } from './probe'
import { generateSprite } from './sprites'
import { generateThumbnail } from './thumbs'
import { walk } from './walker'

/** Rows buffered before each transaction during the walk. */
const UPSERT_BATCH = 500

/** How often progress is pushed to the renderer, at most. */
const PROGRESS_INTERVAL_MS = 200

/**
 * Consecutive classification failures before the stage stops trying.
 *
 * Everything that can be misconfigured about the classifier — a text-only
 * model, a wrong model id, a server that went away — fails identically on every
 * item, so without this the stage grinds through the entire backlog failing.
 * High enough to ride out a few flaky requests, low enough that a real
 * misconfiguration costs seconds instead of hours.
 */
const FAILURES_BEFORE_GIVING_UP = 10

function concurrency(): number {
  // Leave a core for the UI and the main process itself.
  return Math.max(1, cpus().length - 1)
}

function emptyProgress(): ScanProgress {
  return {
    phase: 'idle',
    currentRoot: null,
    discovered: 0,
    probed: 0,
    thumbed: 0,
    previewed: 0,
    hashed: 0,
    classified: 0,
    pendingProbe: 0,
    pendingThumb: 0,
    pendingSprite: 0,
    pendingHash: 0,
    pendingClassify: 0,
    errors: 0,
    message: null,
  }
}

/** Stands in for "every enabled root" inside the queue, where `undefined` can't. */
const ALL_ROOTS = Symbol('all-roots')

export class Indexer extends EventEmitter {
  private controller: AbortController | null = null
  private progress: ScanProgress = emptyProgress()
  private lastEmit = 0
  /** Scans asked for while one was already running. See `start`. */
  private queued = new Set<number | typeof ALL_ROOTS>()
  /** Whether this run may classify. False for the scan that runs at launch. */
  private classifying = true

  get running(): boolean {
    return this.controller !== null
  }

  status(): ScanProgress {
    return { ...this.progress }
  }

  cancel(): void {
    this.controller?.abort()
  }

  /**
   * Stops for good, and waits until it really has.
   *
   * `cancel` only asks: the queued restarts stay, so a scan begins again the
   * moment this one unwinds, and the stage that is aborting may still be part
   * way through writing a row. Resetting the classifier needs neither to
   * happen - it deletes what the classifier filed, and a run still going would
   * put some of it straight back, which reads as a reset that will not take.
   */
  async stop(timeoutMs = 5_000): Promise<void> {
    this.queued.clear()
    this.controller?.abort()

    const until = Date.now() + timeoutMs
    while (this.running && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  /**
   * Starts a scan. Returns immediately; watch the `progress` event for updates.
   *
   * A request that arrives while a scan is already running is queued rather than
   * dropped. It has to be: `run` reads the root list once when it starts, so a
   * folder added mid-scan would never be walked — and the classify stage can
   * keep a scan running for hours, which made "add a folder and it appears"
   * quietly stop being true for the whole of that window.
   */
  start(rootId?: number, options?: { classify?: boolean }): void {
    if (this.running) {
      this.queued.add(rootId ?? ALL_ROOTS)
      return
    }

    // A scan the user did not ask for does not classify. The classifier is
    // usually a model served on this machine, and at launch there is no reason
    // to think it is up yet - a catch-up scan that ran into a cold LM Studio
    // burned through the backlog marking everything failed.
    this.classifying = options?.classify !== false

    const controller = new AbortController()
    this.controller = controller
    this.progress = { ...emptyProgress(), phase: 'walking' }
    this.emitProgress(true)

    void this.run(controller.signal, rootId)
      .then(() => {
        this.setPhase(controller.signal.aborted ? 'cancelled' : 'done')
      })
      .catch((err: unknown) => {
        this.progress.message = err instanceof Error ? err.message : String(err)
        this.setPhase('error')
      })
      .finally(() => {
        this.controller = null
        this.emitProgress(true)
        // A cancelled scan drops the queue: the user asked for the work to stop,
        // and immediately starting another pass is the opposite of that.
        if (controller.signal.aborted) this.queued.clear()
        else this.runQueued()
      })
  }

  /**
   * Runs whatever was requested while the last scan was busy.
   *
   * Several queued roots collapse into one full scan rather than a chain of
   * single-root passes. A scan is incremental — unchanged files keep their
   * thumbnails and hashes — so the extra roots cost a directory walk each, which
   * is far cheaper than the bookkeeping to sequence them.
   */
  private runQueued(): void {
    if (this.queued.size === 0) return

    const requests = [...this.queued]
    this.queued.clear()

    const single =
      requests.length === 1 && requests[0] !== ALL_ROOTS ? (requests[0] as number) : undefined

    // Deferred a tick so the 'done' progress for the finished scan is delivered
    // before the next one resets it to 'walking'.
    setTimeout(() => this.start(single), 0)
  }

  private async run(signal: AbortSignal, rootId?: number): Promise<void> {
    const roots = listRoots().filter((r) => r.enabled && (rootId === undefined || r.id === rootId))

    for (const root of roots) {
      if (signal.aborted) return

      this.progress.currentRoot = root.path
      this.setPhase('walking')

      // Every row touched this pass is stamped with the same timestamp, so
      // anything left with an older stamp afterwards is provably gone.
      const seenAt = Date.now()
      let buffer: UpsertEntry[] = []

      for await (const entry of walk(root.path, {
        signal,
        onError: () => {
          this.progress.errors += 1
        },
      })) {
        buffer.push(entry)
        this.progress.discovered += 1

        if (buffer.length >= UPSERT_BATCH) {
          upsertMediaBatch(root.id, buffer, seenAt)
          buffer = []
          this.emitProgress()
        }
      }

      if (buffer.length > 0) upsertMediaBatch(root.id, buffer, seenAt)

      // Only reconcile if the walk actually finished; a cancelled one would
      // otherwise treat everything it hadn't reached yet as deleted.
      if (!signal.aborted) await this.reconcile(root, seenAt)

      this.emitProgress(true)
    }

    this.progress.currentRoot = null

    this.setPhase('probing')
    await this.drain('probe_state', signal, async (item, absPath) => {
      const result = await probeFile(absPath, item.ext, signal)
      applyProbeResult(item.id, result)
      this.progress.probed += 1
    })

    this.setPhase('thumbnailing')
    await this.drain('thumb_state', signal, async (item, absPath) => {
      await generateThumbnail(
        { id: item.id, absPath, kind: item.kind, durationMs: item.durationMs },
        signal,
      )
      setStageState(item.id, 'thumb_state', 'done')
      this.progress.thumbed += 1
    })

    this.setPhase('previewing')
    await this.drain('sprite_state', signal, async (item, absPath) => {
      // Images have nothing to scrub through.
      if (item.kind !== 'video') {
        applySpriteResult(item.id, null)
        return
      }

      const layout = await generateSprite(
        { absPath, durationMs: item.durationMs },
        spritePathFor(item.id),
        signal,
      )
      applySpriteResult(item.id, layout)
      this.progress.previewed += 1
    })

    this.setPhase('hashing')
    await this.drain('hash_state', signal, async (item, absPath) => {
      const result = await hashItem(absPath, thumbPathFor(item.id), signal)
      applyHashResult(item.id, result)
      this.progress.hashed += 1
    })

    await this.classify(signal)
  }

  /**
   * Forgets the files this pass didn't find.
   *
   * The library is a view of what is actually reachable, so anything the walk
   * didn't see stops being part of it — including a whole root that is offline.
   * Reconnecting the drive and rescanning brings the files back; what does not
   * come back is anything derived from them, since tags, captions, and
   * collection membership go with the row.
   *
   * The one thing that never triggers this is a cancelled scan, which is checked
   * by the caller: a walk that was interrupted hasn't finished looking, and
   * treating "didn't reach it" as "isn't there" would be a bug rather than a
   * policy.
   */
  private async reconcile(root: { id: number }, seenAt: number): Promise<void> {
    const gone = missingMediaIds(root.id, seenAt)
    if (gone.length === 0) return

    deleteMedia(gone)
    // These rows were the only thing referencing their thumbnails and sprites.
    await discardDerived(gone)
  }

  /**
   * The AI stage. Deliberately last: it depends on the thumbnails the earlier
   * stages produced, and it is the only stage that can be left permanently
   * undone without the library being worse off.
   *
   * Settings are read once per scan rather than per item, so switching the
   * feature off mid-scan takes effect at the next scan rather than tearing down
   * work already in flight.
   */
  private async classify(signal: AbortSignal): Promise<void> {
    if (!this.classifying) return

    const settings = aiSettings()

    // Items are left *pending* rather than skipped when the feature is off, so
    // turning it on later gives the next scan a full backlog to work through
    // instead of a library that looks classified but isn't.
    if (!settings.enabled) return

    if (!aiReady(settings)) {
      this.progress.message =
        settings.provider === 'anthropic'
          ? 'Classification is on but no API key is set'
          : 'Classification is on but no server address is set'
      return
    }

    // Videos are classified from their poster frame, which is a much weaker
    // signal than a still — so it stays opt-in.
    const kind: MediaKind | undefined = settings.includeVideos ? undefined : 'image'

    // Everything that can be misconfigured here fails the same way on every
    // item: a text-only model, a wrong model id, a server that stopped. Left
    // alone the stage would work through the whole backlog one failure at a
    // time — hours against a local server, real money against a hosted one. So
    // it gives up early, on its own signal, which leaves the rest of the scan
    // reported as completed rather than cancelled.
    const breaker = new AbortController()
    const stageSignal = AbortSignal.any([signal, breaker.signal])
    let consecutiveFailures = 0

    this.setPhase('classifying')
    await this.drain(
      'classify_state',
      stageSignal,
      async (item) => {
        let result
        try {
          result = await classifyItem(item.id, settings, stageSignal)
        } catch (err) {
          consecutiveFailures += 1
          if (consecutiveFailures >= FAILURES_BEFORE_GIVING_UP && !breaker.signal.aborted) {
            this.progress.message = `Classification failed ${consecutiveFailures} times in a row and was stopped - check the model and server in Settings. Last error: ${describe(err)}`
            breaker.abort()
          }
          // Rethrown so drain records the item as errored and counts it, exactly
          // as it would any other stage failure.
          throw err
        }

        consecutiveFailures = 0
        setStageState(item.id, 'classify_state', result.state)
        if (result.refusal) {
          console.warn(`[scan] classification declined for ${item.relPath}: ${result.refusal}`)
        }
        this.progress.classified += 1
      },
      { kind, limit: settings.concurrency, resolvePath: false },
    )
  }

  /**
   * Works a stage until nothing is pending, in batches, with a bounded pool.
   *
   * `options.resolvePath` is on for every stage that reads the original file.
   * The classify stage reads the generated thumbnail instead, so it turns the
   * check off — an item whose source has since moved still has a perfectly good
   * thumbnail to classify.
   */
  private async drain(
    stage: StageColumn,
    signal: AbortSignal,
    work: (item: PendingItem, absPath: string) => Promise<void>,
    options: { kind?: MediaKind; limit?: number; resolvePath?: boolean } = {},
  ): Promise<void> {
    const limit = options.limit ?? concurrency()
    const resolvePath = options.resolvePath !== false
    // Guards against a row that somehow survives processing still marked pending,
    // which would otherwise spin this loop forever.
    const attempted = new Set<number>()

    for (;;) {
      if (signal.aborted) return

      const batch = claimPending(stage, limit * 4, options.kind).filter(
        (item) => !attempted.has(item.id),
      )
      if (batch.length === 0) return

      for (const item of batch) attempted.add(item.id)

      this.refreshPendingCounts()
      this.emitProgress()

      await pool(batch, limit, async (item) => {
        if (signal.aborted) return

        try {
          let absPath = ''
          if (resolvePath) {
            const resolved = await resolveWithinRoot(item.rootPath, item.relPath)
            if (!resolved) {
              // Gone or replaced by a symlink since the walk. Not an error worth
              // surfacing — the next scan will mark it missing.
              setStageState(item.id, stage, 'skipped')
              return
            }
            absPath = resolved
          }
          await work(item, absPath)
        } catch (err) {
          if (signal.aborted) return
          setStageState(item.id, stage, 'error')
          this.progress.errors += 1
          this.progress.message = err instanceof Error ? err.message : String(err)
          // Log it too. Recording the message on progress alone means a stage that
          // fails for every single item looks identical to one that succeeded,
          // which is exactly how a broken ffmpeg invocation went unnoticed.
          console.error(`[scan] ${stage} failed for ${item.relPath}:`, this.progress.message)
        }

        this.emitProgress()
      })
    }
  }

  private setPhase(phase: ScanPhase): void {
    this.progress.phase = phase
    if (
      phase === 'probing' ||
      phase === 'thumbnailing' ||
      phase === 'previewing' ||
      phase === 'hashing' ||
      phase === 'classifying'
    ) {
      this.refreshPendingCounts()
    }
    this.emitProgress(true)
  }

  private refreshPendingCounts(): void {
    this.progress.pendingProbe = countPending('probe_state')
    this.progress.pendingThumb = countPending('thumb_state')
    this.progress.pendingSprite = countPending('sprite_state')
    this.progress.pendingHash = countPending('hash_state')

    // Counted with the same kind filter the classify stage claims with, or the
    // remaining count would never reach zero when videos are excluded.
    const settings = aiSettings()
    this.progress.pendingClassify = settings.enabled
      ? countPending('classify_state', settings.includeVideos ? undefined : 'image')
      : 0
  }

  /** Throttled so a fast scan doesn't flood the IPC channel. */
  private emitProgress(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastEmit < PROGRESS_INTERVAL_MS) return
    this.lastEmit = now
    this.emit('progress', this.status())
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++
      const item = items[index]
      if (item === undefined) return
      await fn(item)
    }
  })

  await Promise.all(workers)
}

export const indexer = new Indexer()
