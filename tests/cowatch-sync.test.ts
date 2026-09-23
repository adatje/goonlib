import { describe, expect, it } from 'vitest'
import {
  clockOffset,
  correct,
  DRIFT_IGNORE_MS,
  initialState,
  isPlaying,
  medianOffset,
  positionAt,
  READY_TIMEOUT_MS,
  reduce,
  stragglers,
} from '../src/main/cowatch/sync'
import type { SyncEvent, SyncState } from '../src/main/cowatch/sync'

const T0 = 1_000_000

/** Applies a run of events, advancing the clock by `step` between each. */
function run(state: SyncState, events: SyncEvent[], start = T0, step = 0): SyncState {
  let now = start
  let next = state
  for (const event of events) {
    next = reduce(next, event, now)
    now += step
  }
  return next
}

describe('playhead projection', () => {
  it('advances with the wall clock while playing', () => {
    const state = run(initialState(T0), [
      { type: 'open', mediaId: 7, autoplay: true, actor: 'host' },
    ])

    expect(positionAt(state, T0 + 5_000)).toBe(5_000)
  })

  it('holds still while paused, however long it sits there', () => {
    const state = run(initialState(T0), [
      { type: 'open', mediaId: 7, autoplay: true, actor: 'host' },
      { type: 'pause', positionMs: 4_000, actor: 'ada' },
    ])

    expect(positionAt(state, T0 + 60_000)).toBe(4_000)
  })

  it('resumes from where it was paused, not from where it was anchored', () => {
    // The bug this guards: re-anchoring on play is what stops the playhead
    // snapping back to the pre-pause position the moment someone resumes.
    let state = reduce(initialState(T0), { type: 'open', mediaId: 7, autoplay: true, actor: 'host' }, T0)
    state = reduce(state, { type: 'pause', positionMs: 4_000, actor: 'ada' }, T0 + 4_000)
    state = reduce(state, { type: 'play', actor: 'sam' }, T0 + 90_000)

    expect(positionAt(state, T0 + 92_000)).toBe(6_000)
  })

  it('leaves the paused/playing decision alone when someone scrubs', () => {
    const state = run(initialState(T0), [
      { type: 'open', mediaId: 7, autoplay: false, actor: 'host' },
      { type: 'seek', positionMs: 30_000, actor: 'ada' },
    ])

    expect(state.paused).toBe(true)
    expect(positionAt(state, T0 + 10_000)).toBe(30_000)
  })
})

describe('the ready gate', () => {
  it('holds playback until every peer can play', () => {
    let state = reduce(initialState(T0), { type: 'peer-join', peer: 'sam' }, T0)
    state = reduce(state, { type: 'open', mediaId: 7, autoplay: true, actor: 'host' }, T0)

    // Autoplay was asked for, but Sam is still transcoding — nothing moves.
    expect(state.paused).toBe(false)
    expect(state.waiting).toBe(true)
    expect(isPlaying(state)).toBe(false)
    expect(positionAt(state, T0 + 5_000)).toBe(0)
    expect(stragglers(state)).toEqual(['sam'])

    state = reduce(state, { type: 'ready', peer: 'sam', mediaId: 7, ready: true }, T0 + 8_000)

    expect(isPlaying(state)).toBe(true)
    expect(stragglers(state)).toEqual([])
  })

  it('does not credit the wait to the playhead when the gate opens', () => {
    // The regression this guards: holding for a peer who takes eight seconds to
    // finish transcoding must not advance the video eight seconds. Everyone
    // would lurch forward the instant the slowest machine caught up.
    let state = reduce(initialState(T0), { type: 'peer-join', peer: 'sam' }, T0)
    state = reduce(state, { type: 'open', mediaId: 7, autoplay: true, actor: 'host' }, T0)
    state = reduce(state, { type: 'ready', peer: 'sam', mediaId: 7, ready: true }, T0 + 8_000)

    expect(positionAt(state, T0 + 8_000)).toBe(0)
    expect(positionAt(state, T0 + 13_000)).toBe(5_000)
  })

  it('does not credit the wait to the playhead when the gate times out', () => {
    let state = reduce(initialState(T0), { type: 'peer-join', peer: 'sam' }, T0)
    state = reduce(state, { type: 'open', mediaId: 7, autoplay: true, actor: 'host' }, T0)
    state = reduce(state, { type: 'tick' }, T0 + READY_TIMEOUT_MS)

    expect(positionAt(state, T0 + READY_TIMEOUT_MS + 3_000)).toBe(3_000)
  })

  it('does not credit the wait to the playhead when the straggler leaves', () => {
    let state = reduce(initialState(T0), { type: 'peer-join', peer: 'sam' }, T0)
    state = reduce(state, { type: 'open', mediaId: 7, autoplay: true, actor: 'host' }, T0)
    state = reduce(state, { type: 'peer-leave', peer: 'sam' }, T0 + 6_000)

    expect(positionAt(state, T0 + 6_000)).toBe(0)
    expect(positionAt(state, T0 + 10_000)).toBe(4_000)
  })

  it('starts without a straggler once the wait times out', () => {
    let state = reduce(initialState(T0), { type: 'peer-join', peer: 'sam' }, T0)
    state = reduce(state, { type: 'open', mediaId: 7, autoplay: true, actor: 'host' }, T0)

    state = reduce(state, { type: 'tick' }, T0 + READY_TIMEOUT_MS - 1)
    expect(isPlaying(state)).toBe(false)

    state = reduce(state, { type: 'tick' }, T0 + READY_TIMEOUT_MS)
    expect(isPlaying(state)).toBe(true)
  })

  it('ignores a readiness claim about an item the room has left', () => {
    let state = reduce(initialState(T0), { type: 'peer-join', peer: 'sam' }, T0)
    state = reduce(state, { type: 'open', mediaId: 7, autoplay: true, actor: 'host' }, T0)
    state = reduce(state, { type: 'open', mediaId: 9, autoplay: true, actor: 'host' }, T0 + 1_000)

    // Sam's "ready" for item 7 lands late. Honouring it would open the gate on
    // item 9, which Sam has not even started fetching.
    state = reduce(state, { type: 'ready', peer: 'sam', mediaId: 7, ready: true }, T0 + 1_100)

    expect(state.waiting).toBe(true)
    expect(isPlaying(state)).toBe(false)
  })

  it('opens the gate when the peer being waited on disconnects', () => {
    let state = reduce(initialState(T0), { type: 'peer-join', peer: 'sam' }, T0)
    state = reduce(state, { type: 'open', mediaId: 7, autoplay: true, actor: 'host' }, T0)
    expect(isPlaying(state)).toBe(false)

    state = reduce(state, { type: 'peer-leave', peer: 'sam' }, T0 + 3_000)

    expect(isPlaying(state)).toBe(true)
  })

  it('does not pause the room when someone new arrives mid-item', () => {
    let state = reduce(initialState(T0), { type: 'open', mediaId: 7, autoplay: true, actor: 'host' }, T0)
    expect(isPlaying(state)).toBe(true)

    state = reduce(state, { type: 'peer-join', peer: 'late' }, T0 + 30_000)

    // The newcomer catches up on their own rather than interrupting everyone.
    expect(isPlaying(state)).toBe(true)
    expect(positionAt(state, T0 + 30_000)).toBe(30_000)
  })

  it('re-gates on the next item, because readiness does not carry over', () => {
    let state = reduce(initialState(T0), { type: 'peer-join', peer: 'sam' }, T0)
    state = reduce(state, { type: 'open', mediaId: 7, autoplay: true, actor: 'host' }, T0)
    state = reduce(state, { type: 'ready', peer: 'sam', mediaId: 7, ready: true }, T0 + 1_000)
    expect(isPlaying(state)).toBe(true)

    state = reduce(state, { type: 'open', mediaId: 8, autoplay: true, actor: 'host' }, T0 + 2_000)

    expect(state.waiting).toBe(true)
    expect(state.ready['sam']).toBe(false)
  })
})

describe('drift correction', () => {
  it('leaves a gap smaller than a quarter second alone', () => {
    expect(correct(10_000, 10_000 - (DRIFT_IGNORE_MS - 1))).toEqual({ kind: 'none' })
  })

  it('plays faster when behind the room and slower when ahead', () => {
    expect(correct(10_000, 9_000)).toEqual({ kind: 'nudge', rate: 1.05 })
    expect(correct(10_000, 11_000)).toEqual({ kind: 'nudge', rate: 0.95 })
  })

  it('jumps rather than nudging when the gap is a real gulf', () => {
    expect(correct(60_000, 10_000)).toEqual({ kind: 'seek', positionMs: 60_000 })
  })
})

describe('clock offset', () => {
  it('recovers the offset from a symmetric round trip', () => {
    // Guest sends at 1000, host's clock reads 5100 when it answers, reply lands
    // at 1200. Midpoint is 1100, so the host is 4000ms ahead.
    expect(clockOffset(1_000, 5_100, 1_200)).toBe(4_000)
  })

  it('takes the median so one bad round trip cannot skew the estimate', () => {
    expect(medianOffset([100, 104, 5_000, 102, 98])).toBe(102)
  })

  it('reports no offset when it has no samples', () => {
    expect(medianOffset([])).toBe(0)
  })
})
