/**
 * Turns a video's soundtrack into a strength curve.
 *
 * Pure, and fed raw samples rather than a file, so the shaping — which is the
 * whole feel of audio-reactive mode — can be tested against made-up sound.
 *
 * Two things are measured for every step, because loudness alone is not what
 * a beat feels like:
 *
 *  - Loudness, in decibels, placed within the track's own range and squared.
 *    A dense mix — bass with treble running over it — is loud all the time,
 *    and measured as a plain share of its peak it sat at mid strength
 *    throughout. Placing it within its own range, and squaring that, lets the
 *    steady body of a mix fall away and keeps full strength for its loud parts.
 *
 *  - Punch: how far the bass has jumped above where it has been for the last
 *    second and a half. A kick is felt as a hit even when hi-hats and synths
 *    keep the overall level flat, and this is what finds it.
 *
 * Both are then smoothed, quickly on the way up and slowly on the way down,
 * so the curve rides the music rather than flickering with it. A step is a
 * tenth of a second, and without that smoothing every little wobble between
 * one step and the next arrived at the toy as a separate jolt.
 */

/** One level per this many milliseconds. Matches the rate the toy is driven at. */
export const ENVELOPE_STEP_MS = 100

/**
 * Bumped whenever the shaping changes, so curves cached by an older version
 * are worked out again rather than played as they were.
 */
export const ENVELOPE_VERSION = 3

/** Below this, a step is silence, whatever the rest of the track is like. */
const SILENCE_DB = -70

/**
 * The narrowest range loudness is spread over. A track that barely varies —
 * a steady tone, heavy mastering — would otherwise have every tiny wobble
 * blown up into the full range of the toy.
 */
const MIN_RANGE_DB = 6

/**
 * Loudness is raised to this power, so the middle of the range stays gentle
 * while the loud parts keep the top of it.
 */
const LOUDNESS_CURVE = 2

/** The bass band, for punch: kicks and bass lines, not voices or cymbals. */
const BASS_HZ = 150

/** How far back punch looks to decide what "normal" is for the bass. */
const PUNCH_WINDOW_MS = 1_500

/** A jump this far above the bass's recent average is a full-strength hit. */
const PUNCH_FULL_DB = 9

/**
 * How much of the range loudness alone may claim. Holding it back leaves room
 * for a hit to stand above the music rather than both pinning at full.
 */
const LOUD_GAIN = 0.8

/** How much punch adds on top of loudness. */
const PUNCH_WEIGHT = 0.5

/**
 * How quickly each part follows the music, as the time it takes to cover most
 * of a change. Rises are near enough immediate, so a hit lands on the beat;
 * falls are slow, so the gap after it eases off instead of dropping out. A
 * hit's own tail is shorter than the music's, or every beat would smear into
 * the next.
 */
const LOUD_ATTACK_MS = 25
const LOUD_RELEASE_MS = 320
const PUNCH_ATTACK_MS = 20
const PUNCH_RELEASE_MS = 200

/**
 * The most the whole curve may be lifted at the end, so a track whose loudest
 * moments still fall short of the top is brought up to it. Without this a
 * track with no hits in it — talking, a tonal drone — would never reach full
 * strength, because loudness alone is held under LOUD_GAIN.
 */
const MAX_MAKEUP = 1.6

/** Once the track really is silent, the level drops away rather than lingering. */
const SILENCE_RELEASE_MS = 150

/**
 * Below this the level is eased down to nothing rather than cut there, so a
 * quiet passage fades out instead of snapping off.
 */
const GATE = 0.12

/** Under this there is nothing a toy can make felt, so it is sent as off. */
const MUTE = 0.02

/**
 * Levels from 0 to 1, one per `stepMs`, for mono signed 16-bit samples.
 * A soundtrack with nothing in it comes back as all zeroes.
 */
export function envelope(
  samples: Int16Array,
  sampleRate: number,
  stepMs: number = ENVELOPE_STEP_MS,
): number[] {
  const window = Math.max(1, Math.round((sampleRate * stepMs) / 1000))
  const steps = Math.ceil(samples.length / window)
  const fullDb: number[] = new Array<number>(steps).fill(SILENCE_DB)
  const bassDb: number[] = new Array<number>(steps).fill(SILENCE_DB)

  // One-pole low-pass: crude, but a bass drum does not need a better filter
  // to be told apart from a hi-hat.
  const alpha = 1 - Math.exp((-2 * Math.PI * BASS_HZ) / sampleRate)
  let low = 0

  for (let step = 0; step < steps; step += 1) {
    const start = step * window
    const end = Math.min(samples.length, start + window)
    let full = 0
    let bass = 0
    for (let i = start; i < end; i += 1) {
      const sample = samples[i]! / 32768
      low += alpha * (sample - low)
      full += sample * sample
      bass += low * low
    }
    const count = Math.max(1, end - start)
    fullDb[step] = decibels(full / count)
    bassDb[step] = decibels(bass / count)
  }

  const audible = fullDb.filter((db) => db > SILENCE_DB)
  if (audible.length === 0) return fullDb.map(() => 0)

  const top = percentile(audible, 0.98)
  const floor = Math.min(percentile(audible, 0.1), top - MIN_RANGE_DB)
  const history = Math.max(1, Math.round(PUNCH_WINDOW_MS / stepMs))

  // What the music is doing, before any smoothing: how loud it is within its
  // own range, and how hard the bass just jumped.
  const loud: number[] = new Array<number>(steps).fill(0)
  const punch: number[] = new Array<number>(steps).fill(0)
  let bassSum = 0

  for (let step = 0; step < steps; step += 1) {
    if (fullDb[step]! > SILENCE_DB) {
      const place = Math.min(1, Math.max(0, (fullDb[step]! - floor) / (top - floor)))
      loud[step] = place ** LOUDNESS_CURVE

      // Compared with the steps before this one only, so a hit is measured
      // against what led up to it and not against itself.
      const seen = Math.min(step, history)
      const recent = seen > 0 ? bassSum / seen : bassDb[step]!
      const jump = Math.max(0, bassDb[step]! - recent)
      punch[step] = Math.min(1, jump / PUNCH_FULL_DB)
    }

    bassSum += bassDb[step]!
    if (step >= history) bassSum -= bassDb[step - history]!
  }

  const loudness = follow(loud, stepMs, LOUD_ATTACK_MS, LOUD_RELEASE_MS)
  const hits = follow(punch, stepMs, PUNCH_ATTACK_MS, PUNCH_RELEASE_MS)

  const shaped: number[] = new Array<number>(steps).fill(0)
  let held = 0

  for (let step = 0; step < steps; step += 1) {
    const wanted = Math.min(1, LOUD_GAIN * loudness[step]! + PUNCH_WEIGHT * hits[step]!)
    // Silence is left behind quickly; music is followed as smoothed above.
    held = fullDb[step]! > SILENCE_DB ? wanted : ease(held, 0, stepMs, SILENCE_RELEASE_MS)
    shaped[step] = held
  }

  // Lift the whole curve so this track's own loudest moments reach the top.
  const loudest = percentile(shaped.filter((level) => level > 0), 0.98)
  const makeup = loudest > 0 ? Math.min(MAX_MAKEUP, 1 / loudest) : 1

  return shaped.map((level) => round(soften(Math.min(1, level * makeup))))
}

/**
 * A value that chases another: fast one way, slow the other. The same shape
 * as a compressor's attack and release, and what keeps the curve smooth
 * without blunting the moment a hit lands.
 */
function follow(values: number[], stepMs: number, attackMs: number, releaseMs: number): number[] {
  const out: number[] = new Array<number>(values.length).fill(0)
  let held = 0
  for (let i = 0; i < values.length; i += 1) {
    const target = values[i]!
    held = ease(held, target, stepMs, target > held ? attackMs : releaseMs)
    out[i] = held
  }
  return out
}

/** One step of that chase, as a share of the distance left to cover. */
function ease(from: number, to: number, stepMs: number, timeMs: number): number {
  const rate = 1 - Math.exp(-stepMs / Math.max(1, timeMs))
  return from + rate * (to - from)
}

/**
 * The bottom of the range, rounded off: levels near nothing are eased to
 * nothing rather than cut there, and what no toy could render is sent as off.
 */
function soften(level: number): number {
  if (level < MUTE) return 0
  if (level >= GATE) return level
  return (level / GATE) ** 2 * GATE
}

function decibels(power: number): number {
  return power > 0 ? Math.max(SILENCE_DB, 10 * Math.log10(power)) : SILENCE_DB
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!
}

/** Two decimals is finer than any toy can tell apart, and a third the size on disk. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}
