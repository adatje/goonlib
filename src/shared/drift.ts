/**
 * Where a co-watching player should be, and what to do about being wrong.
 *
 * Lives in shared because all three participants need the identical answer: the
 * host process that owns the room, the host's own React player, and the browser
 * client served to a guest. Three implementations of this would be three
 * subtly different ideas of "in sync", which is indistinguishable from a bug.
 */

/** Below this, a correction would be more noticeable than the drift. */
export const DRIFT_IGNORE_MS = 250

/** Above this, nudging the rate would take too long — jump instead. */
export const DRIFT_SEEK_MS = 2_000

/** How hard a nudge pulls. 5% is inaudible on speech and music alike. */
export const NUDGE_RATE = 0.05

/** The parts of a room's playback state that determine where the playhead goes. */
export interface Projectable {
  paused: boolean
  waiting: boolean
  positionMs: number
  /** The clock reading at which positionMs was true. */
  updatedAt: number
}

/** Whether the video should actually be moving. Both conditions must hold. */
export function isRunning(playback: Projectable): boolean {
  return !playback.paused && !playback.waiting
}

/**
 * Where the playhead should be at `now`, projected forward from the last known
 * position. A paused or gated room reports a stable position however long it
 * sits there.
 */
export function projectPosition(playback: Projectable, now: number): number {
  if (!isRunning(playback)) return playback.positionMs
  return playback.positionMs + Math.max(0, now - playback.updatedAt)
}

/**
 * What a client should do about the gap between where it is and where the room
 * says it should be.
 *
 * Three bands, because the cure can be worse than the disease: a sub-quarter-
 * second gap is not worth touching, a moderate one is smoothed away by playing
 * slightly fast or slow, and only a real gulf justifies a seek — which always
 * shows as a visible stutter.
 */
export type Correction =
  | { kind: 'none' }
  | { kind: 'nudge'; rate: number }
  | { kind: 'seek'; positionMs: number }

export function correct(targetMs: number, actualMs: number): Correction {
  const drift = targetMs - actualMs

  if (Math.abs(drift) < DRIFT_IGNORE_MS) return { kind: 'none' }
  if (Math.abs(drift) > DRIFT_SEEK_MS) return { kind: 'seek', positionMs: targetMs }

  // Behind the room: play faster to catch up. Ahead: play slower to be caught.
  return { kind: 'nudge', rate: drift > 0 ? 1 + NUDGE_RATE : 1 - NUDGE_RATE }
}
