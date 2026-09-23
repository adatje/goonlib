/**
 * Decides what the toy does, moment to moment, from everything that wants a say.
 *
 * Four things can want the toy running: the video's script, a pattern left on
 * in the panel, a guest's buzz, and the soundtrack (which arrives here as a
 * script like any other). They are not queued or taken in turns — the
 * strongest one wins at every instant, under one ceiling the user set, and
 * nothing at all gets through while the toy is stopped.
 *
 * No clock and no device here either: the caller says what time it is and
 * does the sending, so every rule below is testable as plain arithmetic.
 */

import type { ToyManual, ToyPrefs } from '@shared/types'
import type { PatternShape, StrokeAction, ToyScript } from '@shared/toy'
import { actionIndexAt, clamp01, isPattern, levelAt, patternLevel, shapeLevel } from '@shared/toy'

/**
 * The player's last report, and when it arrived.
 *
 * Reports come a few times a second at most; between them the position is
 * projected forward from this, the same way a co-watching guest projects the
 * room's position between messages.
 */
export interface Anchor {
  mediaId: number | null
  playing: boolean
  positionMs: number
  rate: number
  /** Clock reading when the report arrived. */
  at: number
}

export function positionNow(anchor: Anchor, now: number): number {
  if (!anchor.playing) return anchor.positionMs
  return anchor.positionMs + Math.max(0, now - anchor.at) * anchor.rate
}

/** A pattern from the panel, with the moment it was started so it can be timed. */
export interface RunningManual extends ToyManual {
  startedAt: number
  /** The drawn shape, for a saved pattern or one being previewed. */
  shape?: PatternShape
}

export interface MixInput {
  armed: boolean
  prefs: ToyPrefs
  anchor: Anchor | null
  /** The script for the video in `anchor`, once loaded. */
  script: ToyScript | null
  manual: RunningManual | null
  /** Already limited to the host's guest ceiling. */
  guestLevel: number
  /**
   * A level being tried out from the settings, which is exactly what it says:
   * it is not scaled by Intensity, because Intensity is usually the very thing
   * being set. Null when nothing is being previewed.
   */
  preview?: number | null
}

/** How strongly every vibrating motor should run at `now`, from 0 to 1. */
export function mix(input: MixInput, now: number): number {
  if (!input.armed) return 0

  // A preview is the whole output while it lasts: you are feeling one number,
  // not a mix, and it is the number on the slider under your finger.
  if (input.preview !== null && input.preview !== undefined) return clamp01(input.preview)

  // A video that is playing has the toy: its script, or the curve from its
  // sound, is what you came for. A pattern of yours waits rather than running
  // over the top of it, and takes over again the moment the video stops. A
  // guest's buzz is deliberate and is never held back.
  const script = scriptLevel(input, now)
  const manual = playing(input) ? 0 : manualLevel(input.manual, now)

  // Intensity scales rather than clips, so a pattern keeps its shape when turned down.
  const level = Math.max(script, manual, clamp01(input.guestLevel))
  return clamp01(level) * clamp01(input.prefs.maxIntensity)
}

/** Whether a video with something to follow is playing right now. */
function playing(input: MixInput): boolean {
  return input.prefs.followVideo && input.script !== null && input.anchor?.playing === true
}

function scriptLevel(input: MixInput, now: number): number {
  const { anchor, script, prefs } = input
  if (!prefs.followVideo || !script || !anchor || !anchor.playing) return 0
  return levelAt(script, positionNow(anchor, now) + prefs.leadMs, prefs.vibrateFrom)
}

function manualLevel(manual: RunningManual | null, now: number): number {
  if (!manual) return 0
  const elapsed = now - manual.startedAt
  if (manual.shape) return shapeLevel(manual.shape, manual.intensity, elapsed)
  return isPattern(manual.pattern) ? patternLevel(manual.pattern, manual.intensity, elapsed) : 0
}

/** A move for a stroker: go to `position` (0 bottom, 1 top) over `durationMs`. */
export interface Stroke {
  position: number
  durationMs: number
}

/**
 * Walks a stroker through a funscript.
 *
 * A stroker is told where to be and how long to take getting there, once per
 * action — not twenty times a second — so this remembers which action it last
 * sent and only speaks up when the next one comes due. A seek or a pause
 * resets it, so the stroker picks up from wherever the video now is.
 */
export class StrokeFollower {
  private sentIndex = -1

  reset(): void {
    this.sentIndex = -1
  }

  /**
   * The move to send at `positionMs`, or null if the current one is still
   * under way. Commands are aimed at the *next* action, which is where the
   * video is heading, not the one it just passed.
   */
  next(actions: StrokeAction[], positionMs: number): Stroke | null {
    const target = actionIndexAt(actions, positionMs) + 1
    if (target >= actions.length || target === this.sentIndex) return null
    this.sentIndex = target

    const action = actions[target]!
    return {
      position: action.pos / 100,
      // A floor, because a move with no time to happen in is one the device
      // either refuses or slams through.
      durationMs: Math.max(50, Math.round(action.at - positionMs)),
    }
  }
}
