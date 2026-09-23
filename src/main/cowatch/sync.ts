/**
 * The co-watching sync engine.
 *
 * Pure on purpose: no sockets, no Electron, no clock of its own. Every decision
 * here is a function of the state it is handed and the timestamp it is handed,
 * which is what makes drift correction and the ready gate testable without
 * booting an app or a network.
 *
 * The host owns exactly one SyncState. The host's own player and every guest
 * send intents into it and render what comes back — so there is a single
 * implementation of "where should this video be right now", and everyone runs
 * the same one.
 */

import { isRunning as running, projectPosition } from '@shared/drift'

export {
  correct,
  DRIFT_IGNORE_MS,
  DRIFT_SEEK_MS,
  NUDGE_RATE,
  projectPosition,
} from '@shared/drift'
export type { Correction } from '@shared/drift'

/** How long the gate waits for a straggler before starting without them. */
export const READY_TIMEOUT_MS = 20_000

export interface SyncState {
  mediaId: number | null
  /** What the room intends. Not the same as whether video is moving — see isPlaying. */
  paused: boolean
  positionMs: number
  /** Host clock at the moment positionMs was true. */
  updatedAt: number
  /** Who last changed this, so the UI can say "Ada paused" rather than jumping. */
  actor: string
  /** peerId -> can this peer actually play the current item yet. */
  ready: Record<string, boolean>
  /**
   * True while playback is held for a peer that cannot play yet. Distinct from
   * `paused`: pausing is a decision someone made, waiting is a condition the
   * room is in, and conflating them means the gate opening looks like a ghost
   * pressing play.
   */
  waiting: boolean
  /** Host clock after which we stop waiting and start without the straggler. */
  waitUntil: number
}

export type SyncEvent =
  | { type: 'open'; mediaId: number; positionMs?: number; autoplay: boolean; actor: string }
  | { type: 'play'; actor: string }
  | { type: 'pause'; positionMs: number; actor: string }
  | { type: 'seek'; positionMs: number; actor: string }
  | { type: 'close'; actor: string }
  | { type: 'ready'; peer: string; mediaId: number; ready: boolean }
  | { type: 'peer-join'; peer: string }
  | { type: 'peer-leave'; peer: string }
  /** Lets the gate time out without anyone having to send anything. */
  | { type: 'tick' }

export function initialState(now: number): SyncState {
  return {
    mediaId: null,
    paused: true,
    positionMs: 0,
    updatedAt: now,
    actor: 'host',
    ready: {},
    waiting: false,
    waitUntil: 0,
  }
}

/** Whether the video should actually be moving. Both conditions must hold. */
export function isPlaying(state: SyncState): boolean {
  return state.mediaId !== null && running(state)
}

/** Where the playhead should be at `now`, projected from the last known position. */
export function positionAt(state: SyncState, now: number): number {
  return state.mediaId === null ? state.positionMs : projectPosition(state, now)
}

/** Everyone we are waiting on who still cannot play. */
export function stragglers(state: SyncState): string[] {
  return Object.keys(state.ready).filter((peer) => !state.ready[peer])
}

export function reduce(state: SyncState, event: SyncEvent, now: number): SyncState {
  switch (event.type) {
    case 'open': {
      // A new item resets every readiness claim: peers may need to remux or
      // transcode before they can play this one, and last item's answer says
      // nothing about this one.
      const ready: Record<string, boolean> = {}
      for (const peer of Object.keys(state.ready)) ready[peer] = false

      return {
        mediaId: event.mediaId,
        paused: !event.autoplay,
        positionMs: Math.max(0, event.positionMs ?? 0),
        updatedAt: now,
        actor: event.actor,
        ready,
        waiting: Object.keys(ready).length > 0,
        waitUntil: now + READY_TIMEOUT_MS,
      }
    }

    case 'play':
      if (state.mediaId === null) return state
      return {
        ...state,
        // Re-anchor to the current projected position, or the playhead jumps
        // back to wherever it was when the room last paused.
        positionMs: positionAt(state, now),
        paused: false,
        updatedAt: now,
        actor: event.actor,
      }

    case 'pause':
      if (state.mediaId === null) return state
      return {
        ...state,
        positionMs: Math.max(0, event.positionMs),
        paused: true,
        updatedAt: now,
        actor: event.actor,
      }

    case 'seek':
      if (state.mediaId === null) return state
      // Seeking says nothing about whether the room is playing, so `paused` is
      // deliberately untouched — scrubbing a paused video leaves it paused.
      return {
        ...state,
        positionMs: Math.max(0, event.positionMs),
        updatedAt: now,
        actor: event.actor,
      }

    case 'close':
      return {
        ...state,
        mediaId: null,
        paused: true,
        positionMs: 0,
        updatedAt: now,
        actor: event.actor,
        ready: resetAll(state.ready),
        waiting: false,
        waitUntil: 0,
      }

    case 'ready': {
      // A claim about a different item is stale — it arrived after the room
      // already moved on, and honouring it would open the gate early.
      if (event.mediaId !== state.mediaId) return state
      if (state.ready[event.peer] === event.ready) return state

      const ready = { ...state.ready, [event.peer]: event.ready }
      return gate({ ...state, ready }, state.waiting && !allReady(ready), now)
    }

    case 'peer-join': {
      if (state.ready[event.peer] !== undefined) return state
      // Someone arriving mid-session catches up on their own. Re-opening the
      // gate would pause the room every time a guest reconnects.
      return { ...state, ready: { ...state.ready, [event.peer]: false } }
    }

    case 'peer-leave': {
      if (state.ready[event.peer] === undefined) return state
      const ready = { ...state.ready }
      delete ready[event.peer]
      // The peer we were holding for may have been the one who left.
      return gate({ ...state, ready }, state.waiting && !allReady(ready), now)
    }

    case 'tick':
      if (!state.waiting || now < state.waitUntil) return state
      // Start without them. They will be corrected into place when they catch up.
      return gate(state, false, now)

    default:
      return state
  }
}

/**
 * Applies a change to the gate, re-anchoring the clock when it opens.
 *
 * Time spent waiting is not time spent playing. Without this the room credits
 * the entire wait to the playhead, so the moment the slowest peer becomes ready
 * everyone lurches forward by however long they took.
 */
function gate(state: SyncState, waiting: boolean, now: number): SyncState {
  if (state.waiting === waiting) return { ...state, waiting }
  return { ...state, waiting, positionMs: positionAt(state, now), updatedAt: now }
}

function allReady(ready: Record<string, boolean>): boolean {
  return Object.values(ready).every(Boolean)
}

function resetAll(ready: Record<string, boolean>): Record<string, boolean> {
  const next: Record<string, boolean> = {}
  for (const peer of Object.keys(ready)) next[peer] = false
  return next
}

/**
 * Best estimate of the offset between a guest's clock and the host's, from a
 * round trip whose midpoint we assume is when the host read its own clock.
 * Same idea as NTP, minus everything that makes NTP hard.
 */
export function clockOffset(sentAt: number, hostTime: number, receivedAt: number): number {
  return hostTime - (sentAt + (receivedAt - sentAt) / 2)
}

/** The median of several offset samples, which throws out the one bad round trip. */
export function medianOffset(samples: number[]): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}
