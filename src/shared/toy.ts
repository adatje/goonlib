/**
 * What the toy should be doing at a given moment, as pure functions of time.
 *
 * Lives in shared, and has no clock and no device of its own, so the whole
 * question of "how hard, right now" can be answered — and tested — without a
 * toy, an engine, or a video. The main process owns the clock and the device;
 * this file only ever turns a position into a level.
 */

/** One point of a funscript: at `at` ms, the stroke is at `pos` (0 bottom, 100 top). */
export interface StrokeAction {
  at: number
  pos: number
}

/**
 * Something a video can be played against.
 *
 * `strokes` is a funscript, which describes motion; a vibrator has to have that
 * translated into strength. `levels` is already strength, sampled at a fixed
 * step — which is what listening to a video's audio produces.
 */
export type ToyScript =
  | { kind: 'strokes'; actions: StrokeAction[] }
  | { kind: 'levels'; stepMs: number; levels: number[] }

/** How a stroke script drives something that can only vibrate. */
export type VibrateFrom = 'speed' | 'position'

/**
 * Stroke speed, in positions per second, that counts as flat out.
 *
 * A full 0–100 stroke in a quarter of a second is about as fast as scripts
 * get while still being a stroke rather than a flicker, so that is full power.
 * Anything faster is clipped rather than letting one frantic second set the
 * scale for the other nineteen minutes.
 */
export const FULL_SPEED = 400

/** Patterns anyone can pick, whether from the panel or from a guest's browser. */
export const TOY_PATTERNS = [
  { id: 'steady', label: 'Steady', glyph: '▬' },
  { id: 'pulse', label: 'Pulse', glyph: '⋯' },
  { id: 'wave', label: 'Wave', glyph: '〰' },
  { id: 'escalate', label: 'Build', glyph: '◢' },
  { id: 'burst', label: 'Burst', glyph: '✹' },
] as const

export type ToyPattern = (typeof TOY_PATTERNS)[number]['id']

const PATTERN_IDS = new Set<string>(TOY_PATTERNS.map((pattern) => pattern.id))

export function isPattern(value: unknown): value is ToyPattern {
  return typeof value === 'string' && PATTERN_IDS.has(value)
}

/**
 * A pattern drawn by the user: strength over time, from 0 to `durationMs`,
 * repeating. Points are joined by straight lines; two points on the same
 * millisecond make a sheer edge, which is how a pulse is drawn.
 */
export interface ShapePoint {
  at: number
  level: number
}

export interface PatternShape {
  durationMs: number
  points: ShapePoint[]
}

/** A drawn pattern as saved, with the name it is offered under. */
export interface CustomPattern extends PatternShape {
  id: number
  name: string
}

/**
 * How any pattern is referred to: a built-in's name, or `custom:` and the id
 * of a saved one. One string, so a saved pattern can go anywhere a built-in
 * can — the panel, a guest's buzz, the status — without a second field.
 */
export type PatternId = ToyPattern | `custom:${number}`

export const SHAPE_LIMITS = {
  minMs: 500,
  maxMs: 60_000,
  maxPoints: 200,
  maxName: 40,
} as const

export function customPatternId(id: number): PatternId {
  return `custom:${id}`
}

/** The saved pattern's id inside a `custom:` reference, or null for anything else. */
export function customIdOf(value: unknown): number | null {
  if (typeof value !== 'string' || !value.startsWith('custom:')) return null
  const id = Number(value.slice(7))
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * Makes a drawn shape safe to play, or null if there is nothing to play.
 *
 * Whatever arrives — from the editor, a stored row, or a guest's page — comes
 * out with a sane length, points inside it in time order, levels from 0 to 1,
 * and a point pinned to each end so the loop closes where it was drawn to.
 */
export function normaliseShape(input: unknown): PatternShape | null {
  if (typeof input !== 'object' || input === null) return null
  const record = input as { durationMs?: unknown; points?: unknown }

  const duration = Number(record.durationMs)
  if (!Number.isFinite(duration)) return null
  const durationMs = Math.round(Math.min(SHAPE_LIMITS.maxMs, Math.max(SHAPE_LIMITS.minMs, duration)))

  if (!Array.isArray(record.points)) return null
  const points: ShapePoint[] = []
  for (const raw of record.points.slice(0, SHAPE_LIMITS.maxPoints)) {
    if (typeof raw !== 'object' || raw === null) continue
    const at = Number((raw as { at?: unknown }).at)
    const level = Number((raw as { level?: unknown }).level)
    if (!Number.isFinite(at) || !Number.isFinite(level)) continue
    points.push({ at: Math.round(Math.min(durationMs, Math.max(0, at))), level: round2(clamp01(level)) })
  }
  if (points.length === 0) return null

  // Stable, so two points drawn on the same moment keep the order they were
  // drawn in — that order is which way the edge between them goes.
  points.sort((a, b) => a.at - b.at)
  if (points[0]!.at > 0) points.unshift({ at: 0, level: points[0]!.level })
  if (points.at(-1)!.at < durationMs) points.push({ at: durationMs, level: points.at(-1)!.level })

  return { durationMs, points }
}

/** Strength of a drawn shape `elapsedMs` after it started, looping. */
export function shapeLevel(shape: PatternShape, intensity: number, elapsedMs: number): number {
  const { points, durationMs } = shape
  if (points.length === 0 || durationMs <= 0) return 0
  const t = Math.max(0, elapsedMs) % durationMs

  // The last point at or before t. Few enough points that a scan is fine.
  let index = 0
  for (let i = 0; i < points.length; i += 1) {
    if (points[i]!.at <= t) index = i
    else break
  }

  const from = points[index]!
  const to = points[index + 1]
  let level = from.level
  if (to && to.at > from.at) level = from.level + ((to.level - from.level) * (t - from.at)) / (to.at - from.at)
  return clamp01(level) * clamp01(intensity)
}

/**
 * How long a pattern with no end of its own takes to build up before starting
 * over. Only `escalate` and `burst` care; the others repeat on a shorter beat.
 */
export const PATTERN_CYCLE_MS = 10_000

/**
 * Reads a `.funscript` file's text.
 *
 * Throws on anything that is not a funscript at all, so the caller can say so,
 * but is forgiving about the details real scripts get wrong: actions out of
 * order, positions outside 0–100, two actions on the same millisecond. An
 * `inverted` script is flipped here, once, so nothing downstream has to know.
 */
export function parseFunscript(text: string): StrokeAction[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('The funscript is not valid JSON')
  }

  if (typeof parsed !== 'object' || parsed === null) throw new Error('The funscript is empty')
  const record = parsed as { actions?: unknown; inverted?: unknown }
  if (!Array.isArray(record.actions)) throw new Error('The funscript has no actions')

  const inverted = record.inverted === true
  const byTime = new Map<number, number>()

  for (const raw of record.actions) {
    if (typeof raw !== 'object' || raw === null) continue
    const at = Number((raw as { at?: unknown }).at)
    const pos = Number((raw as { pos?: unknown }).pos)
    if (!Number.isFinite(at) || !Number.isFinite(pos) || at < 0) continue

    const bounded = Math.min(100, Math.max(0, pos))
    // A later duplicate wins, which is what an editor that appended a
    // correction meant.
    byTime.set(Math.round(at), inverted ? 100 - bounded : bounded)
  }

  const actions = [...byTime].map(([at, pos]) => ({ at, pos })).sort((a, b) => a.at - b.at)
  if (actions.length < 2) throw new Error('The funscript has fewer than two actions')
  return actions
}

/**
 * Index of the last action at or before `ms`, or -1 if `ms` is before the first.
 * A binary search, because this runs twenty times a second against scripts
 * that can hold tens of thousands of actions.
 */
export function actionIndexAt(actions: StrokeAction[], ms: number): number {
  let low = 0
  let high = actions.length - 1
  let found = -1

  while (low <= high) {
    const mid = (low + high) >> 1
    if (actions[mid]!.at <= ms) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return found
}

/** How strongly a vibrator should run at `ms` into the video, from 0 to 1. */
export function levelAt(script: ToyScript, ms: number, from: VibrateFrom = 'speed'): number {
  if (script.kind === 'levels') {
    const index = Math.floor(ms / script.stepMs)
    return clamp01(script.levels[index] ?? 0)
  }

  const actions = script.actions
  const index = actionIndexAt(actions, ms)
  // Before the script starts and after it ends, nothing is happening.
  if (index < 0 || index >= actions.length - 1) return 0

  const from_ = actions[index]!
  const to = actions[index + 1]!
  const span = to.at - from_.at
  if (span <= 0) return 0

  if (from === 'position') {
    const t = (ms - from_.at) / span
    return clamp01((from_.pos + (to.pos - from_.pos) * t) / 100)
  }

  const speed = (Math.abs(to.pos - from_.pos) / span) * 1000
  return clamp01(speed / FULL_SPEED)
}

/**
 * A script's strength across a whole video, reduced to `points` buckets for
 * drawing. Each bucket keeps its strongest moment, so a short sharp hit still
 * shows at a width where it falls between two samples.
 */
export function curveOf(
  script: ToyScript,
  durationMs: number,
  points: number,
  from: VibrateFrom = 'speed',
): number[] {
  const count = Math.max(1, Math.floor(points))
  const span = durationMs / count
  const curve: number[] = new Array<number>(count).fill(0)
  if (!(span > 0)) return curve

  for (let i = 0; i < count; i += 1) {
    const start = i * span
    let strongest = 0

    if (script.kind === 'levels') {
      const first = Math.floor(start / script.stepMs)
      const last = Math.max(first, Math.ceil((start + span) / script.stepMs) - 1)
      for (let step = first; step <= last; step += 1) {
        strongest = Math.max(strongest, script.levels[step] ?? 0)
      }
    } else {
      // Strokes are sampled rather than walked: a bucket can span hundreds of
      // actions on a long video, and four looks each is plenty to draw from.
      for (let k = 0; k < 4; k += 1) {
        strongest = Math.max(strongest, levelAt(script, start + (span * (k + 0.5)) / 4, from))
      }
    }

    curve[i] = Math.round(clamp01(strongest) * 100) / 100
  }

  return curve
}

/**
 * Strength of a pattern `elapsedMs` after it started.
 *
 * With a `durationMs`, shapes that build (`escalate`, `burst`) are stretched
 * over that duration, the way a guest's five-second buzz should build over
 * five seconds. Without one they repeat every PATTERN_CYCLE_MS, which is what
 * a pattern left running from the panel needs.
 *
 * Shapes are the ones vibe-signal settled on, measured in milliseconds rather
 * than ten-per-second steps so they do not care how often they are asked.
 */
export function patternLevel(
  pattern: ToyPattern,
  intensity: number,
  elapsedMs: number,
  durationMs: number | null = null,
): number {
  const strength = clamp01(intensity)
  const t = Math.max(0, elapsedMs)
  const span = durationMs !== null && durationMs > 0 ? durationMs : PATTERN_CYCLE_MS
  const fraction = durationMs !== null && durationMs > 0 ? Math.min(t / span, 1) : (t % span) / span

  switch (pattern) {
    case 'steady':
      return strength
    case 'pulse':
      // Half a second on, half a second off.
      return Math.floor(t / 500) % 2 === 0 ? strength : 0
    case 'wave':
      return strength * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / 1500))
    case 'escalate':
      return strength * fraction
    case 'burst':
      return fraction < 0.5 ? strength : strength * 0.15
  }
}

/**
 * Rounds a level onto the steps the device actually has.
 *
 * Done here rather than left to the client library, which rounds up: that
 * turns a level of 0.01 into the first step of the motor, and a toy that
 * should be off keeps buzzing faintly between strokes.
 */
export function toSteps(level: number, steps: number): number {
  if (steps <= 0) return 0
  return Math.round(clamp01(level) * steps)
}

/** A guest's request to buzz the host's toy, as it arrives off the wire. */
export interface BuzzRequest {
  pattern: PatternId
  intensity: number
  durationMs: number
  /** The drawn shape, for a saved pattern; looked up on the host, never sent. */
  shape?: PatternShape
}

/** The ceilings the host set for guests. */
export interface BuzzLimits {
  maxIntensity: number
  maxSeconds: number
}

/**
 * Shapes whatever a guest sent into something safe to play, or null.
 *
 * Every field is clamped to the host's own limits here, on the host's side —
 * the guest page offers the same limits, but a page is only a suggestion.
 */
export function shapeBuzz(
  body: unknown,
  limits: BuzzLimits,
  saved: (id: number) => PatternShape | null = () => null,
): BuzzRequest | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>

  // A saved pattern is named by id and its shape read from the host's own
  // store. A guest can pick one; they can never supply a shape of their own.
  const customId = customIdOf(record['pattern'])
  const shape = customId !== null ? saved(customId) : null
  if (!isPattern(record['pattern']) && !shape) return null

  const intensity = Number(record['intensity'])
  const seconds = Number(record['seconds'])
  if (!Number.isFinite(intensity) || !Number.isFinite(seconds)) return null

  const ceiling = clamp01(limits.maxIntensity)
  const longest = Math.max(1, limits.maxSeconds)

  return {
    pattern: record['pattern'] as PatternId,
    intensity: Math.min(ceiling, clamp01(intensity)),
    // A tenth of a second is the shortest thing a toy can make felt.
    durationMs: Math.round(Math.min(longest, Math.max(0.1, seconds)) * 1000),
    ...(shape ? { shape } : {}),
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
