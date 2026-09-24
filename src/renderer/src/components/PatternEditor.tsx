import { useCallback, useEffect, useRef, useState } from 'react'
import type { CustomPattern, PatternShape, ShapePoint } from '@shared/toy'
import { normaliseShape, SHAPE_LIMITS } from '@shared/toy'
import type { ToyView } from '../state/useToy'

export interface PatternEditorProps {
  toy: ToyView
  /** The saved pattern being changed, or null to draw a new one. */
  initial: CustomPattern | null
  onDone: () => void
}

/** Moves along the time axis land on this grid, so a beat can be hit exactly. */
const SNAP_MS = 50

/** How often a preview is re-sent while the shape is being dragged. */
const PREVIEW_GAP_MS = 120

/**
 * Shapes to start a new pattern from. Each is only a starting point: every
 * one is drawn with ordinary points and can be pulled into anything else.
 */
const STARTERS: Array<{ label: string; shape: PatternShape }> = [
  {
    label: 'Wave',
    shape: {
      durationMs: 2000,
      points: Array.from({ length: 9 }, (_, i) => ({
        at: i * 250,
        level: Math.round((0.55 - 0.45 * Math.cos((i / 8) * 2 * Math.PI)) * 100) / 100,
      })),
    },
  },
  {
    label: 'Ramp',
    shape: { durationMs: 5000, points: [{ at: 0, level: 0.1 }, { at: 5000, level: 1 }] },
  },
  {
    label: 'Pulse',
    shape: {
      durationMs: 1000,
      points: [
        { at: 0, level: 1 },
        { at: 500, level: 1 },
        { at: 500, level: 0 },
        { at: 1000, level: 0 },
      ],
    },
  },
  {
    label: 'Heartbeat',
    shape: {
      durationMs: 1200,
      points: [
        { at: 0, level: 0 },
        { at: 100, level: 1 },
        { at: 200, level: 0.15 },
        { at: 300, level: 0.85 },
        { at: 450, level: 0 },
        { at: 1200, level: 0 },
      ],
    },
  },
]

/**
 * Draws a pattern: strength up the side, time along the bottom, looping.
 *
 * Click an empty spot to add a point there and drag it straight away; drag a
 * point to move it; double-click one, or focus it and press Delete, to remove
 * it. The two end points only move up and down, so the loop always joins up.
 * Preview plays the shape on the toy as it is being drawn, so it can be shaped
 * by feel rather than by eye.
 */
export function PatternEditor({
  toy,
  initial,
  onDone,
}: PatternEditorProps): React.JSX.Element {
  const [id, setId] = useState<number | undefined>(initial?.id)
  const [name, setName] = useState(initial?.name ?? '')
  const [shape, setShape] = useState<PatternShape>(() =>
    initial ? { durationMs: initial.durationMs, points: initial.points } : STARTERS[0]!.shape,
  )
  const [selected, setSelected] = useState<number | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saved, setSaved] = useState(initial !== null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const graphRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef<number | null>(null)

  const change = useCallback((next: PatternShape) => {
    setShape(next)
    setSaved(false)
  }, [])

  // --- preview ----------------------------------------------------------------

  const { manual } = toy
  const previewStarted = useRef(0)
  const lastSent = useRef(0)
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!previewing) return
    const send = (): void => {
      lastSent.current = Date.now()
      manual({ pattern: 'preview', intensity: 1, shape })
    }
    // Throttled rather than debounced: while a point is being dragged the toy
    // should follow it, not wait for the hand to stop.
    const wait = PREVIEW_GAP_MS - (Date.now() - lastSent.current)
    if (wait <= 0) send()
    else pending.current = setTimeout(send, wait)
    return () => {
      if (pending.current) clearTimeout(pending.current)
    }
  }, [previewing, shape, manual])

  const togglePreview = (): void => {
    if (previewing) {
      setPreviewing(false)
      manual(null)
      return
    }
    previewStarted.current = Date.now()
    setPreviewing(true)
  }

  // Leaving the editor never leaves a half-drawn pattern playing.
  const previewingRef = useRef(previewing)
  previewingRef.current = previewing
  useEffect(
    () => () => {
      if (previewingRef.current) manual(null)
    },
    [manual],
  )

  const playhead = usePlayhead(previewing, previewStarted.current, shape.durationMs)

  // --- drawing ----------------------------------------------------------------

  /** Where a pointer is, in the pattern's own units. */
  const locate = (event: { clientX: number; clientY: number }): ShapePoint | null => {
    const box = graphRef.current?.getBoundingClientRect()
    if (!box || box.width <= 0 || box.height <= 0) return null
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height))
    return {
      at: Math.round((x * shape.durationMs) / SNAP_MS) * SNAP_MS,
      level: Math.round((1 - y) * 100) / 100,
    }
  }

  /** Moves one point, kept between its neighbours; the ends only go up and down. */
  const move = (index: number, to: ShapePoint): void => {
    const points = shape.points.map((point) => ({ ...point }))
    const last = points.length - 1
    const point = points[index]
    if (!point) return
    if (index > 0 && index < last) {
      point.at = Math.min(points[index + 1]!.at, Math.max(points[index - 1]!.at, to.at))
    }
    point.level = to.level
    change({ ...shape, points })
  }

  const remove = (index: number): void => {
    if (index <= 0 || index >= shape.points.length - 1) return
    change({ ...shape, points: shape.points.filter((_, i) => i !== index) })
    setSelected(null)
  }

  const onGraphDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const at = locate(event)
    if (!at || shape.points.length >= SHAPE_LIMITS.maxPoints) return
    // Inserted after every point at or before it, so it lands in time order.
    const index = shape.points.findIndex((point) => point.at > at.at)
    const position = index === -1 ? shape.points.length - 1 : Math.max(1, index)
    const points = [...shape.points]
    points.splice(position, 0, at)
    change({ ...shape, points })
    setSelected(position)
    dragging.current = position
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onHandleDown = (event: React.PointerEvent<HTMLButtonElement>, index: number): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    setSelected(index)
    dragging.current = index
    graphRef.current?.setPointerCapture(event.pointerId)
  }

  const onGraphMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragging.current === null) return
    const to = locate(event)
    if (to) move(dragging.current, to)
  }

  const onGraphUp = (): void => {
    dragging.current = null
  }

  const onHandleKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const point = shape.points[index]
    if (!point) return
    const nudge = (at: number, level: number): void => {
      event.preventDefault()
      move(index, { at: point.at + at, level: Math.min(1, Math.max(0, point.level + level)) })
    }
    switch (event.key) {
      case 'Delete':
      case 'Backspace':
        event.preventDefault()
        remove(index)
        break
      case 'ArrowUp':
        nudge(0, 0.05)
        break
      case 'ArrowDown':
        nudge(0, -0.05)
        break
      case 'ArrowLeft':
        nudge(-SNAP_MS * 2, 0)
        break
      case 'ArrowRight':
        nudge(SNAP_MS * 2, 0)
        break
    }
  }

  /** A new length stretches the drawing to fit, rather than cropping it. */
  const setLength = (seconds: number): void => {
    const durationMs = Math.round(seconds * 1000)
    const scale = durationMs / shape.durationMs
    change({
      durationMs,
      points: shape.points.map((point) => ({ ...point, at: Math.round(point.at * scale) })),
    })
  }

  // --- saving -----------------------------------------------------------------

  const save = (): void => {
    setError(null)
    const clean = normaliseShape(shape)
    if (!clean) return
    void toy
      .savePattern({ id, name: name.trim() || 'Untitled pattern', ...clean })
      .then((stored) => {
        setId(stored.id)
        setName(stored.name)
        setShape({ durationMs: stored.durationMs, points: stored.points })
        setSaved(true)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  const seconds = shape.durationMs / 1000
  const path = linePath(shape)

  return (
    <div className="settings__group pattern">
      <h3 className="pattern__title">{initial ? 'Edit pattern' : 'New pattern'}</h3>

      <input
        className="settings__input"
        value={name}
        maxLength={SHAPE_LIMITS.maxName}
        placeholder="Name your pattern"
        aria-label="Pattern name"
        onChange={(event) => {
          setName(event.target.value)
          setSaved(false)
        }}
      />

      <div className="settings__row settings__row--tight">
        <button
          type="button"
          className={previewing ? 'button button--danger' : 'button'}
          onClick={togglePreview}
          disabled={!toy.status.armed}
          title={toy.status.armed ? undefined : 'The toy is stopped - resume it to preview'}
        >
          {previewing ? 'Stop preview' : 'Preview'}
        </button>
        <button type="button" className="button" onClick={save} disabled={saved}>
          {saved ? 'Saved' : 'Save'}
        </button>
        {id !== undefined ? (
          confirmDelete ? (
            <button
              type="button"
              className="button button--danger"
              onClick={() => {
                toy.deletePattern(id)
                onDone()
              }}
            >
              Really delete?
            </button>
          ) : (
            <button type="button" className="button button--quiet" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )
        ) : null}
        <button type="button" className="button pattern__close" onClick={onDone}>
          Close
        </button>
      </div>

      {error ? <p className="settings__bad">{error}</p> : null}

      {!initial && id === undefined ? (
        <div className="settings__field">
          <span className="settings__label">Pattern</span>
          <div className="toy__patterns" role="group" aria-label="Start from">
            {STARTERS.map((starter) => (
              <button
                key={starter.label}
                type="button"
                className="cowatch__provider"
                onClick={() => change(starter.shape)}
              >
                {starter.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div
        ref={graphRef}
        className="pattern__graph"
        onPointerDown={onGraphDown}
        onPointerMove={onGraphMove}
        onPointerUp={onGraphUp}
        onPointerCancel={onGraphUp}
      >
        <svg className="pattern__svg" viewBox="0 0 1000 100" preserveAspectRatio="none">
          {Array.from({ length: Math.floor(seconds) }, (_, i) => (
            <line
              key={i}
              className="pattern__grid"
              x1={((i + 1) / seconds) * 1000}
              x2={((i + 1) / seconds) * 1000}
              y1={0}
              y2={100}
            />
          ))}
          {[25, 50, 75].map((y) => (
            <line key={y} className="pattern__grid" x1={0} x2={1000} y1={y} y2={y} />
          ))}
          <path className="pattern__area" d={`${path} L1000,100 L0,100 Z`} />
          <path className="pattern__line" d={path} />
        </svg>

        {shape.points.map((point, index) => (
          <button
            key={index}
            type="button"
            className={index === selected ? 'pattern__point pattern__point--on' : 'pattern__point'}
            style={{
              left: `${(point.at / shape.durationMs) * 100}%`,
              top: `${(1 - point.level) * 100}%`,
            }}
            onPointerDown={(event) => onHandleDown(event, index)}
            onDoubleClick={() => remove(index)}
            onKeyDown={(event) => onHandleKey(event, index)}
            onFocus={() => setSelected(index)}
            aria-label={`Point at ${(point.at / 1000).toFixed(2)} seconds, ${Math.round(point.level * 100)}%`}
          />
        ))}

        {playhead !== null ? (
          <span className="pattern__head" style={{ left: `${playhead * 100}%` }} />
        ) : null}
      </div>

      <p className="settings__hint">
        Click to add a point, drag to move one, click and press Delete to remove it.
      </p>

      <label className="settings__field">
        <span className="settings__row">
          <span className="settings__label">Duration</span>
          <span className="settings__value">{seconds.toFixed(1)}s</span>
        </span>
        <input
          type="range"
          className="settings__range"
          min={1}
          max={30}
          step={0.5}
          value={seconds}
          onChange={(event) => setLength(Number(event.target.value))}
        />
      </label>
    </div>
  )
}

/**
 * Where a previewed pattern is in its loop, from 0 to 1, redrawn every frame;
 * null while not previewing. Worked out locally from when preview began, which
 * is also when the toy started it.
 */
function usePlayhead(active: boolean, startedAt: number, durationMs: number): number | null {
  const [fraction, setFraction] = useState<number | null>(null)

  useEffect(() => {
    if (!active) {
      setFraction(null)
      return
    }
    let frame = 0
    const tick = (): void => {
      setFraction(((Date.now() - startedAt) % durationMs) / durationMs)
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [active, startedAt, durationMs])

  return fraction
}

/** The shape as a line across a 1000 by 100 box. */
function linePath(shape: PatternShape): string {
  return shape.points
    .map((point, index) => {
      const x = ((point.at / shape.durationMs) * 1000).toFixed(1)
      const y = ((1 - point.level) * 100).toFixed(1)
      return `${index === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')
}
