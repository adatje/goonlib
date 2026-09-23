/**
 * Buzzes sent by co-watching guests, played one after another.
 *
 * Ported from vibe-signal, where the same problem came from strangers replying
 * to a post: everyone gets a cooldown of their own, so one eager guest cannot
 * hold the toy, and the queue has a ceiling in seconds, so a room cannot stack
 * up ten minutes of buzzing that plays on long after the moment has passed.
 *
 * Holds no timers. Callers pass the clock in, which is what lets this be tested
 * without waiting for any of it.
 */

import type { BuzzRequest, ToyPattern } from '@shared/toy'
import { patternLevel, shapeLevel } from '@shared/toy'

/** What became of a buzz. Said back to the guest, so it has to be plain. */
export type BuzzOutcome = 'ok' | 'off' | 'cooling' | 'full'

export interface QueuedBuzz extends BuzzRequest {
  /** The guest's peer id, which their cooldown is kept against. */
  from: string
  /** Who to say it was, as the host sees them. */
  name: string
}

interface Playing {
  buzz: QueuedBuzz
  startedAt: number
}

/** Pause after a guest's own buzz ends before they can send another. */
export const COOLDOWN_BUFFER_MS = 3_000

/** Everything waiting, added up, may not be longer than this. */
export const MAX_QUEUED_MS = 30_000

export class BuzzQueue {
  private readonly waiting: QueuedBuzz[] = []
  private playing: Playing | null = null
  private readonly cooldownUntil = new Map<string, number>()

  enqueue(buzz: QueuedBuzz, now: number): BuzzOutcome {
    // Settles the timeline first, so a buzz arriving after a quiet spell
    // starts now rather than in the long-gone slot after the last one.
    this.current(now)
    if (now < (this.cooldownUntil.get(buzz.from) ?? 0)) return 'cooling'
    if (this.queuedMs(now) + buzz.durationMs > MAX_QUEUED_MS) return 'full'

    this.waiting.push(buzz)
    this.cooldownUntil.set(buzz.from, now + buzz.durationMs + COOLDOWN_BUFFER_MS)
    return 'ok'
  }

  /**
   * The buzz that should be playing at `now`, moving on to the next one as
   * each ends. Advancing happens here rather than on a timer so a buzz that
   * ended while nothing asked is simply skipped past, not played late.
   */
  current(now: number): Playing | null {
    while (true) {
      if (this.playing && now < this.playing.startedAt + this.playing.buzz.durationMs) {
        return this.playing
      }

      const next = this.waiting.shift()
      if (!next) {
        this.playing = null
        return null
      }

      // Queued buzzes run back to back on one timeline, each starting exactly
      // where the one before it ended — however late the caller looked. One
      // whose whole slot has already gone by is passed over on the next turn
      // of this loop, never played late.
      const startedAt = this.playing
        ? this.playing.startedAt + this.playing.buzz.durationMs
        : now
      this.playing = { buzz: next, startedAt }
    }
  }

  /** How strongly the guests want the toy running at `now`. */
  levelAt(now: number): number {
    const playing = this.current(now)
    if (!playing) return 0
    const { buzz, startedAt } = playing
    // A saved pattern loops for as long as the buzz lasts; a built-in one is
    // stretched to fit it, which is what "build over five seconds" means.
    if (buzz.shape) return shapeLevel(buzz.shape, buzz.intensity, now - startedAt)
    if (buzz.pattern.startsWith('custom:')) return 0
    return patternLevel(buzz.pattern as ToyPattern, buzz.intensity, now - startedAt, buzz.durationMs)
  }

  /** Milliseconds of buzzing still to come, including what is playing now. */
  queuedMs(now: number): number {
    const playing = this.current(now)
    const remaining = playing ? playing.startedAt + playing.buzz.durationMs - now : 0
    return remaining + this.waiting.reduce((sum, buzz) => sum + buzz.durationMs, 0)
  }

  get waitingCount(): number {
    return this.waiting.length
  }

  /**
   * Drops everything, cooldowns included. Used by Stop, and when the session
   * ends — a guest who comes back to a new session starts with a clean slate.
   */
  clear(): void {
    this.waiting.length = 0
    this.playing = null
    this.cooldownUntil.clear()
  }
}
