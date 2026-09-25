import { useEffect, useMemo, useRef, useState } from 'react'
import type { LibraryBreakdown, MediaKind, MediaQuery } from '@shared/types'
import { formatBytes, formatCount } from '../format'

/** Roughly what it measures while shut, for keeping it inside the window. */
const WIDTH = 420
const HEIGHT = 320

/** The donut, in the same 16px-grid spirit as the icons: one square, drawn big. */
const SIZE = 136
const RADIUS = 54
const THICKNESS = 18

/** One step down into a source, and then into its folders. */
interface Step {
  rootId: number
  /** The rel_path prefix this step stands for, ending in '/' unless it is the source. */
  path: string
  label: string
}

/**
 * Where the room went, behind the disc in the toolbar.
 *
 * It describes what the grid is showing rather than the library as a whole: the
 * number beside the disc moves when you search, pick a tag or open a folder, and
 * a card that ignored all that would be answering a question nobody asked.
 *
 * A source is a lid, not a leaf. Picking one makes it the top of the card and
 * the breakdown becomes its folders, which can be opened in turn - content is
 * sorted into folders, so a split that stopped at the source would put one bar
 * across everything and call it an answer. Drilling is done by handing the same
 * query back with a narrower root and prefix, so every level is worked out the
 * way the first one was.
 *
 * Both lists start shut, and both can be open at once. The card is opened to
 * see the total and the shape of the ring; the rows are the follow-up
 * question, and asking it should be a click rather than the default.
 */
export function StorageCard(props: {
  /** Exactly the query the grid is running, so both describe the same items. */
  query: Omit<MediaQuery, 'limit' | 'offset'>
  /** Where the disc sits, in window coordinates. */
  at: { x: number; y: number }
  onClose: () => void
}): React.JSX.Element {
  const shell = useRef<HTMLDivElement | null>(null)
  const [data, setData] = useState<LibraryBreakdown | null>(null)
  const [failed, setFailed] = useState(false)
  const [trail, setTrail] = useState<Step[]>([])
  // Two independent lids rather than one choice: comparing where the room went
  // with what is taking it up means having both open at once.
  const [openWhere, setOpenWhere] = useState(false)
  const [openType, setOpenType] = useState(false)
  // What the pointer is over, as a *slice* key rather than a row key, so the
  // ring and the list can be lit from either side with one value.
  const [lit, setLit] = useState<string | null>(null)
  const [litKind, setLitKind] = useState<string | null>(null)

  const here = trail[trail.length - 1] ?? null

  // Narrowed to wherever the trail has reached. Everything else about the grid's
  // query - the search, the tags, the kind - is carried along untouched.
  const query = useMemo(
    () => (here ? { ...props.query, rootId: here.rootId, pathPrefix: here.path } : props.query),
    [props.query, here],
  )

  useEffect(() => {
    let live = true
    setFailed(false)
    void window.goonlib.library
      .breakdown(query)
      .then((result) => {
        if (live) setData(result)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [query])

  const { onClose } = props
  useEffect(() => {
    const away = (event: MouseEvent): void => {
      if (!shell.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    // A frame later, or the click that opened this would close it again.
    const timer = setTimeout(() => document.addEventListener('mousedown', away), 0)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('resize', onClose)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  // Anchored under the disc and pulled left, since the disc sits at the far
  // right of the toolbar and a card starting there would hang off the window.
  // The height is measured from where it actually landed, so opening a list
  // makes the card scroll rather than run off the bottom.
  const place = {
    left: Math.max(8, Math.min(props.at.x - WIDTH + 20, window.innerWidth - WIDTH - 8)),
    top: Math.min(props.at.y + 14, Math.max(8, window.innerHeight - HEIGHT - 8)),
  }
  const maxHeight = window.innerHeight - place.top - 16

  // At the top these are the sources; inside one they are its folders. Either
  // way they are what the ring is drawn from, so the two always agree.
  const rows: Array<{ key: string; label: string; items: number; bytes: number; into: Step | null }> =
    data === null
      ? []
      : here === null
        ? data.roots.map((root) => ({
            key: `root-${root.rootId}`,
            label: root.name,
            items: root.items,
            bytes: root.bytes,
            into: { rootId: root.rootId, path: '', label: root.name },
          }))
        : (data.roots[0]?.folders ?? []).map((folder) => ({
            key: `folder-${folder.name}`,
            label: folder.name === '' ? 'Loose files' : folder.name,
            items: folder.items,
            bytes: folder.bytes,
            // Loose files are not a folder, so there is nowhere to go.
            into:
              folder.name === ''
                ? null
                : { rootId: here.rootId, path: `${here.path}${folder.name}/`, label: folder.name },
          }))

  return (
    <div
      className="storecard"
      ref={shell}
      style={{ ...place, maxHeight }}
      role="dialog"
      aria-label="What this is made of"
    >
      {failed ? (
        <span className="settings__hint">That could not be worked out.</span>
      ) : data === null ? (
        <span className="settings__hint">Adding up…</span>
      ) : data.total.items === 0 ? (
        <span className="settings__hint">Nothing here to measure.</span>
      ) : (
        <>
          <div className="storecard__head">
            <strong className="storecard__total">{formatBytes(data.total.bytes)}</strong>
            <span className="settings__hint">across {formatCount(data.total.items)} items</span>
          </div>

          {/* Only shown once there is somewhere to go back to: at the top of a
              library with one source, a breadcrumb saying "Everything" is a
              row of nothing. */}
          {trail.length > 0 ? (
            <nav className="storecard__crumbs" aria-label="Where this is looking">
              <button type="button" className="storecard__crumb" onClick={() => setTrail([])}>
                Everything
              </button>
              {trail.map((step, index) => (
                <span key={`${step.rootId}:${step.path}`} className="storecard__crumbs-part">
                  <span className="storecard__crumb-sep" aria-hidden="true">
                    ›
                  </span>
                  {index === trail.length - 1 ? (
                    <span className="storecard__crumb storecard__crumb--here">{step.label}</span>
                  ) : (
                    <button
                      type="button"
                      className="storecard__crumb"
                      onClick={() => setTrail(trail.slice(0, index + 1))}
                    >
                      {step.label}
                    </button>
                  )}
                </span>
              ))}
            </nav>
          ) : null}

          <Donut rows={rows} lit={lit} onLight={setLit} />

          <Section
            title={here === null ? 'By source' : 'Folders'}
            count={rows.length}
            open={openWhere}
            onToggle={() => setOpenWhere(!openWhere)}
          >
            {rows.length === 0 ? (
              <span className="settings__hint">Nothing filed below this.</span>
            ) : (
              rows.map((row, index) => (
                <Row
                  key={row.key}
                  dot={tint(index)}
                  name={row.label}
                  muted={row.into === null}
                  items={row.items}
                  bytes={row.bytes}
                  onOpen={row.into ? () => setTrail([...trail, row.into!]) : undefined}
                  lit={sliceKey(rows, index) === lit}
                  onLight={(on) => setLit(on ? sliceKey(rows, index) : null)}
                />
              ))
            )}
          </Section>

          <Section
            title="By type"
            count={data.kinds.length}
            open={openType}
            onToggle={() => setOpenType(!openType)}
          >
            <div className={litKind ? 'storecard__bar storecard__bar--lit' : 'storecard__bar'}>
              {data.kinds.map((kind, index) => (
                <span
                  key={kind.kind}
                  className={
                    litKind === kind.kind ? 'storecard__seg storecard__seg--lit' : 'storecard__seg'
                  }
                  style={{ background: tint(index), flexGrow: Math.max(kind.bytes, 1) }}
                  title={`${KIND_NAME[kind.kind]}: ${formatBytes(kind.bytes)}`}
                  onMouseEnter={() => setLitKind(kind.kind)}
                  onMouseLeave={() => setLitKind(null)}
                />
              ))}
            </div>
            {data.kinds.map((kind, index) => (
              <div key={kind.kind}>
                <Row
                  dot={tint(index)}
                  name={KIND_NAME[kind.kind]}
                  items={kind.items}
                  bytes={kind.bytes}
                  head
                  lit={litKind === kind.kind}
                  onLight={(on) => setLitKind(on ? kind.kind : null)}
                />
                {kind.exts.map((ext) => (
                  <Row
                    key={ext.ext}
                    name={ext.ext.replace(/^\./, '').toUpperCase()}
                    items={ext.items}
                    bytes={ext.bytes}
                    indent
                    // An extension belongs to its kind, so pointing at one
                    // lights the same segment its heading does.
                    lit={litKind === kind.kind}
                    onLight={(on) => setLitKind(on ? kind.kind : null)}
                  />
                ))}
              </div>
            ))}
          </Section>
        </>
      )}
    </div>
  )
}

/** What a kind is called in the card, rather than the word the database uses. */
const KIND_NAME: Record<MediaKind, string> = { video: 'Videos', image: 'Images' }

/**
 * A list that starts shut, with its own count on the lid.
 *
 * The count is on the heading rather than inside, so the card says how much
 * there is to see before anything is opened.
 */
function Section(props: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="storecard__section">
      <button
        type="button"
        className={props.open ? 'storecard__lid storecard__lid--open' : 'storecard__lid'}
        onClick={props.onToggle}
        aria-expanded={props.open}
      >
        <span className="storecard__twist" aria-hidden="true">
          ›
        </span>
        <span className="settings__label">{props.title}</span>
        <span className="storecard__count">{formatCount(props.count)}</span>
      </button>
      {props.open ? <div className="storecard__list">{props.children}</div> : null}
    </div>
  )
}

/**
 * One line of the breakdown: what it is, how many, how big.
 *
 * Headings, children and the rows you can open are the same row with the same
 * columns, so the counts and sizes stay in one straight line down the card
 * however deep the grouping goes.
 */
function Row(props: {
  name: string
  items: number
  bytes: number
  dot?: string
  head?: boolean
  indent?: boolean
  muted?: boolean
  /** Set when there is a level below this one to step into. */
  onOpen?: () => void
  /** The chart is pointing back at this row. */
  lit?: boolean
  onLight?: (on: boolean) => void
}): React.JSX.Element {
  const classes = ['storecard__row']
  if (props.head) classes.push('storecard__row--head')
  if (props.indent) classes.push('storecard__row--child')
  if (props.onOpen) classes.push('storecard__row--able')
  if (props.lit) classes.push('storecard__row--lit')

  // Focus counts as pointing at it, so tabbing through the openable rows
  // lights the chart the same way the mouse does.
  const linking = props.onLight
    ? {
        onMouseEnter: () => props.onLight?.(true),
        onMouseLeave: () => props.onLight?.(false),
        onFocus: () => props.onLight?.(true),
        onBlur: () => props.onLight?.(false),
      }
    : {}

  const inside = (
    <>
      {props.dot ? (
        <span className="storecard__dot" style={{ background: props.dot }} aria-hidden="true" />
      ) : null}
      <span
        className={props.muted ? 'storecard__name storecard__name--muted' : 'storecard__name'}
        title={props.name}
      >
        {props.name}
      </span>
      <span className="storecard__count">{formatCount(props.items)}</span>
      <span className="storecard__bytes">{formatBytes(props.bytes)}</span>
    </>
  )

  return props.onOpen ? (
    <button
      type="button"
      className={classes.join(' ')}
      onClick={props.onOpen}
      title={`Open ${props.name}`}
      {...linking}
    >
      {inside}
    </button>
  ) : (
    <div className={classes.join(' ')} {...linking}>
      {inside}
    </div>
  )
}

/**
 * Which slice a row is drawn as.
 *
 * Only the first few rows get an arc of their own; everything after them is
 * folded into the grey remainder, so those rows all point at the same slice -
 * and pointing at that slice lights all of them back. That is the honest
 * answer: they really are one wedge.
 */
function sliceKey(rows: Array<{ key: string }>, index: number): string {
  return index < PALETTE.length ? (rows[index]?.key ?? REST_KEY) : REST_KEY
}

/** The one slice that stands for everything past the palette. */
const REST_KEY = 'rest'

/**
 * The slices, as arcs of one ring.
 *
 * Drawn with `stroke-dasharray` on a single circle rather than as wedge paths:
 * every slice is then the same element with two numbers changed, and the ring
 * keeps its exact thickness whatever the split turns out to be.
 */
function Donut({
  rows,
  lit,
  onLight,
}: {
  rows: Array<{ key: string; label: string; bytes: number }>
  lit: string | null
  onLight: (key: string | null) => void
}): React.JSX.Element {
  // Everything past the palette becomes one grey slice. Twenty-six named
  // wedges is confetti; the tail is one honest "and the rest", and the list
  // below still carries every row with that same grey against it.
  const tail = rows.slice(PALETTE.length)
  const slices = [
    ...rows.slice(0, PALETTE.length).map((row, index) => ({
      key: row.key,
      label: row.label,
      value: row.bytes,
      index,
    })),
    ...(tail.length > 0
      ? [
          {
            key: REST_KEY,
            label: tail.length === 1 ? tail[0]!.label : `${tail.length} more`,
            value: tail.reduce((sum, row) => sum + row.bytes, 0),
            index: PALETTE.length,
          },
        ]
      : []),
  ]

  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const circumference = 2 * Math.PI * RADIUS
  let offset = 0

  const shown = slices.find((slice) => slice.key === lit) ?? null

  return (
    <div className="storecard__donut" onMouseLeave={() => onLight(null)}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} aria-hidden="true">
        {/* The track, so a nearly-empty ring still reads as a ring. Every
            colour here is set through `style` rather than the `stroke`
            attribute: var() and color-mix() are CSS values, and an SVG
            presentation attribute does not parse either of them. */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          style={{ stroke: 'var(--bg-sunken)' }}
          strokeWidth={THICKNESS}
        />
        {slices.map((slice) => {
          const length = total > 0 ? (slice.value / total) * circumference : 0
          const dash = `${length} ${circumference - length}`
          const element = (
            <circle
              key={slice.key}
              className={
                lit !== null && lit !== slice.key
                  ? 'storecard__slice storecard__slice--dim'
                  : 'storecard__slice'
              }
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              style={{ stroke: tint(slice.index) }}
              strokeWidth={THICKNESS}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              // Starts the ring at twelve o'clock, which is where a reader
              // expects the biggest slice to begin.
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              onMouseEnter={() => onLight(slice.key)}
            />
          )
          offset += length
          return element
        })}
      </svg>

      {/* The hole in the middle is where the name goes. Empty at rest, because
          the total is already in the heading two lines above it. */}
      {shown ? (
        <span className="storecard__hub">
          <span className="storecard__hub-name" title={shown.label}>
            {shown.label}
          </span>
          <span className="storecard__hub-share">
            {total > 0 ? Math.round((shown.value / total) * 100) : 0}%
          </span>
        </span>
      ) : null}
    </div>
  )
}

/**
 * The slice colours.
 *
 * Mixed from theme tokens rather than named outright, so every theme gets a
 * palette of its own and the card can never wear colours belonging to some
 * other one. They are deliberately different hues rather than steps along one
 * ramp: a ramp spread over twenty-six folders put four percent between
 * neighbours, which made every ring a flat wash of pink and every level look
 * identical to the one above it.
 */
const PALETTE = [
  'var(--heart)',
  'var(--accent)',
  'var(--success)',
  'var(--warn)',
  'color-mix(in srgb, var(--heart) 50%, var(--accent))',
  'color-mix(in srgb, var(--accent) 55%, var(--success))',
  'color-mix(in srgb, var(--warn) 50%, var(--heart))',
]

/** Everything past the palette, in the ring and in the list alike. */
const REST = 'color-mix(in srgb, var(--text-muted) 70%, transparent)'

function tint(index: number): string {
  return PALETTE[index] ?? REST
}
