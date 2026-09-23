import { useEffect, useId, useRef, useState } from 'react'
import type { ToyStatus } from '@shared/types'
import type { ToyView } from '../state/useToy'
import { patternLabel } from './ToySections'
import type { PlayerClock } from './VideoPlayer'

/** Points the curve is drawn with. About one per two pixels of a wide player. */
const CURVE_POINTS = 400

/** How much of the recent past the live trace shows, with no script to draw. */
const TRACE_MS = 12_000

/** How often what is actually being sent is sampled, for both traces. */
const SAMPLE_MS = 150

/** What is driving the toy at one moment, which is what colours a trace. */
type Source = 'script' | 'pattern' | 'guest'

function driving(status: ToyStatus): Source {
  if (status.guests.playing) return 'guest'
  if (status.manual) return 'pattern'
  return 'script'
}

export interface ToyBarProps {
  toy: ToyView
  mediaId: number
  clock: PlayerClock
}

/**
 * What the toy is doing, drawn under the player.
 *
 * With a script — a funscript, or the soundtrack — the whole video's curve is
 * shown with the playhead on it, so what is coming can be seen before it is
 * felt; clicking it seeks, like the scrub bar above. Without one, it shows the
 * last few seconds of what was actually sent.
 *
 * Over either, a brighter line is what the toy is really getting: the curve is
 * only what the video asks for, while a pattern of yours or a guest's buzz
 * takes it higher and Intensity holds it all down. The line is coloured by
 * whichever of the three is driving at the time.
 */
export function ToyBar({ toy, mediaId, clock }: ToyBarProps): React.JSX.Element {
  const { status, prefs } = toy
  const script = status.script
  const scripted =
    (script.kind === 'funscript' || script.kind === 'audio') && script.mediaId === mediaId
  const durationMs = Math.round(clock.duration * 1000)

  const [curve, setCurve] = useState<number[] | null>(null)

  // Asked for again when the way strokes are felt changes, since that changes
  // the curve; not when the playhead moves, which only moves the marker.
  useEffect(() => {
    setCurve(null)
    if (!scripted || durationMs <= 0) return
    let live = true
    void window.goonlib.toy
      .curve(mediaId, durationMs, CURVE_POINTS)
      .then((next) => {
        if (live) setCurve(next)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [scripted, script.kind, mediaId, durationMs, prefs?.vibrateFrom])

  const source = driving(status)
  const trace = useTrace(status.level, source, !scripted)
  const sent = useSent(status.level, source, clock, mediaId, scripted && curve !== null)

  return (
    <div className={status.armed ? 'toybar' : 'toybar toybar--stopped'}>
      <span className="toybar__label">{label(status, scripted)}</span>

      {scripted && curve ? (
        <Curve curve={curve} clock={clock} sent={sent} />
      ) : (
        <Trace points={trace} />
      )}

      <span className="toybar__level" aria-label="Strength right now">
        <span className="toybar__level-fill" style={{ height: `${status.level * 100}%` }} />
      </span>
    </div>
  )
}

function Curve({
  curve,
  clock,
  sent,
}: {
  curve: number[]
  clock: PlayerClock
  sent: Array<Sample | null>
}): React.JSX.Element {
  const clip = useId()
  const played = clock.duration > 0 ? Math.min(1, clock.currentTime / clock.duration) : 0
  const path = areaPath(curve)

  return (
    <div
      className="toybar__track toybar__track--seekable"
      role="slider"
      aria-label="Toy pattern - click to seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(clock.duration)}
      aria-valuenow={Math.round(clock.currentTime)}
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        if (box.width > 0) clock.seek(((event.clientX - box.left) / box.width) * clock.duration)
      }}
    >
      <svg className="toybar__svg" viewBox={`0 0 ${curve.length} 100`} preserveAspectRatio="none">
        <defs>
          <clipPath id={clip}>
            <rect x={0} y={0} width={played * curve.length} height={100} />
          </clipPath>
        </defs>
        <path d={path} className="toybar__ahead" />
        {/* The same shape again, clipped to what has already played. */}
        <path d={path} className="toybar__played" clipPath={`url(#${clip})`} />
        {/* What the toy actually got, over what the video asked for. */}
        {runs(sent, curve.length).map((run) => (
          <polyline
            key={`${run.source}:${run.from}`}
            className={`toybar__sent toybar__sent--${run.source}`}
            points={run.points}
          />
        ))}
      </svg>
      <span className="toybar__head" style={{ left: `${played * 100}%` }} />
    </div>
  )
}

function Trace({ points }: { points: Tick[] }): React.JSX.Element {
  const now = Date.now()
  const at = (point: Tick): string => {
    const x = ((point.at - (now - TRACE_MS)) / TRACE_MS) * 1000
    return `${x.toFixed(1)},${(100 - point.level * 100).toFixed(1)}`
  }
  const line = points.map(at).join(' ')

  // One run per stretch with the same thing driving, so a guest's buzz and a
  // pattern of yours are told apart at a glance.
  const strands: Array<{ source: Source; points: string }> = []
  points.forEach((point, index) => {
    const last = strands[strands.length - 1]
    if (last && points[index - 1]?.source === point.source) last.points += ` ${at(point)}`
    else strands.push({ source: point.source, points: index > 0 ? `${at(points[index - 1]!)} ${at(point)}` : at(point) })
  })

  return (
    <div className="toybar__track">
      <svg className="toybar__svg" viewBox="0 0 1000 100" preserveAspectRatio="none">
        {points.length > 0 ? (
          <polygon points={`0,100 ${line} 1000,100`} className="toybar__trace" />
        ) : null}
        {strands.map((strand, index) => (
          <polyline
            key={index}
            className={`toybar__sent toybar__sent--${strand.source}`}
            points={strand.points}
          />
        ))}
      </svg>
    </div>
  )
}

/** One reading of what was sent, and what was driving when it was taken. */
interface Sample {
  level: number
  source: Source
}

interface Tick extends Sample {
  at: number
}

/**
 * What was actually sent, across the video's own length: one slot per point of
 * the drawn curve, holding the strongest reading taken while the playhead was
 * in it. Watching a stretch again overwrites it, so the line always shows the
 * last time through rather than a smear of every time.
 */
function useSent(
  level: number,
  source: Source,
  clock: PlayerClock,
  mediaId: number,
  active: boolean,
): Array<Sample | null> {
  const [samples, setSamples] = useState<Array<Sample | null>>(() =>
    new Array<Sample | null>(CURVE_POINTS).fill(null),
  )

  // Read through refs: these change several times a second, and re-running the
  // timer for each would leave it sampling nothing.
  const latest = useRef({ level, source, clock })
  latest.current = { level, source, clock }

  useEffect(() => {
    setSamples(new Array<Sample | null>(CURVE_POINTS).fill(null))
  }, [mediaId])

  useEffect(() => {
    if (!active) return
    let slot = -1
    const timer = setInterval(() => {
      const { clock: now, level: sending, source: from } = latest.current
      if (!(now.duration > 0)) return
      const index = Math.min(
        CURVE_POINTS - 1,
        Math.max(0, Math.floor((now.currentTime / now.duration) * CURVE_POINTS)),
      )
      setSamples((current) => {
        const next = [...current]
        // Moving into a slot starts it over; staying in one keeps its peak, so
        // a brief hit is not lost between samples.
        const held = index === slot ? next[index] : null
        next[index] = { level: Math.max(sending, held?.level ?? 0), source: from }
        slot = index
        return next
      })
    }, SAMPLE_MS)
    return () => clearInterval(timer)
  }, [active])

  return samples
}

/**
 * The sampled slots as lines, broken where nothing was recorded and split
 * where what was driving changed.
 */
function runs(
  samples: Array<Sample | null>,
  width: number,
): Array<{ source: Source; from: number; points: string }> {
  const out: Array<{ source: Source; from: number; points: string }> = []
  const scale = width / Math.max(1, samples.length)

  const at = (index: number, sample: Sample): string =>
    `${((index + 0.5) * scale).toFixed(1)},${(100 - sample.level * 100).toFixed(1)}`

  samples.forEach((sample, index) => {
    if (!sample) return
    const before = samples[index - 1]
    const last = out[out.length - 1]
    if (last && before && before.source === sample.source) {
      last.points += ` ${at(index, sample)}`
      return
    }
    // A new run starts on the last point of the one before it, so the line
    // carries on through a change of source rather than breaking there.
    const joined = before ? `${at(index - 1, before)} ` : ''
    out.push({ source: sample.source, from: index, points: joined + at(index, sample) })
  })

  return out
}

/**
 * The last TRACE_MS of levels, as a step line ending at now.
 *
 * Levels only arrive when they change, so the trace also ticks on a timer —
 * otherwise a steady pattern would sit still instead of scrolling past.
 */
function useTrace(level: number, source: Source, active: boolean): Tick[] {
  const [points, setPoints] = useState<Tick[]>([])

  useEffect(() => {
    if (!active) {
      setPoints([])
      return
    }
    const add = (): void => {
      const now = Date.now()
      setPoints((current) => [
        ...current.filter((point) => point.at > now - TRACE_MS - 1000),
        { at: now, level, source },
      ])
    }
    add()
    const timer = setInterval(add, SAMPLE_MS)
    return () => clearInterval(timer)
  }, [level, source, active])

  return points
}

/** An area under the curve, as an SVG path over a 0–100 high box. */
function areaPath(curve: number[]): string {
  let d = `M0,100`
  curve.forEach((level, i) => {
    const y = (100 - level * 100).toFixed(1)
    d += ` L${i},${y} L${i + 1},${y}`
  })
  return `${d} L${curve.length},100 Z`
}

function label(status: ToyStatus, scripted: boolean): string {
  if (!status.armed) return 'Stopped'
  if (scripted) return status.script.kind === 'funscript' ? 'Script' : 'Sound'
  if (status.guests.playing) return status.guests.playing.name
  if (status.manual) return patternLabel(status, status.manual.pattern)
  if (status.script.kind === 'loading') return 'Reading…'
  return 'Toy'
}
