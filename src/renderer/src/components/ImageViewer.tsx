import { useCallback, useEffect, useRef, useState } from 'react'
import type { MediaItem } from '@shared/types'

export interface ImageViewerProps {
  item: MediaItem
  /**
   * Seconds until autoplay moves on, drawn as a line along the bottom of the
   * image that shrinks away over that time. Null while autoplay is not timing
   * this image.
   */
  timerSeconds?: number | null
}

/** Half size to eight times it; fitted to the window is 1. */
const MIN_ZOOM = 0.5
const MAX_ZOOM = 8
const FIT = 1

/**
 * The zoom carried from one image to the next, and from one opening of the
 * viewer to the next. Deliberately not stored: a zoom is about the picture in
 * front of you, so it lasts the session and the app opens fitted again.
 */
let lastZoom = FIT

/**
 * Fitted to the window by default, with wheel zoom either way and drag to pan
 * once the picture is bigger than the window. Panning is clamped so the image
 * can never be dragged off screen entirely.
 */
export function ImageViewer({ item, timerSeconds = null }: ImageViewerProps): React.JSX.Element {
  const [zoom, setZoom] = useState(lastZoom)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [failed, setFailed] = useState(false)

  const dragOrigin = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 })

  // Where the fitted image sits in the viewer, for the timer line to run along
  // its bottom edge. Offsets ignore the zoom transform, which is what is
  // wanted: the line belongs to the image as fitted, not as zoomed.
  const viewerRef = useRef<HTMLDivElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null)
  const measure = useCallback(() => {
    const image = imageRef.current
    if (!image || image.offsetWidth === 0) return
    setBox({ left: image.offsetLeft, top: image.offsetTop + image.offsetHeight, width: image.offsetWidth })
  }, [])
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const observer = new ResizeObserver(measure)
    observer.observe(viewer)
    return () => observer.disconnect()
  }, [measure])

  // A different image is shown at the same zoom, centred again: stepping
  // through a set at 150% should stay at 150%.
  useEffect(() => {
    setOffset({ x: 0, y: 0 })
    setFailed(false)
  }, [item.id])

  const applyZoom = useCallback((next: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
    setZoom(clamped)
    lastZoom = clamped
    // Nothing to pan once it fits, so it is centred again.
    if (clamped <= FIT) setOffset({ x: 0, y: 0 })
  }, [])

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      event.preventDefault()
      applyZoom(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15))
    },
    [zoom, applyZoom],
  )

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (zoom <= FIT) return
      event.currentTarget.setPointerCapture(event.pointerId)
      dragOrigin.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y }
      setDragging(true)
    },
    [zoom, offset],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!dragging) return
      setOffset({
        x: dragOrigin.current.offsetX + (event.clientX - dragOrigin.current.x),
        y: dragOrigin.current.offsetY + (event.clientY - dragOrigin.current.y),
      })
    },
    [dragging],
  )

  const endDrag = useCallback(() => setDragging(false), [])

  if (failed) {
    return (
      <div className="player player--message" role="alert">
        <p className="player__headline">This image couldn&apos;t be displayed</p>
        <p className="player__detail">{item.name}</p>
      </div>
    )
  }

  return (
    <div
      className="viewer"
      ref={viewerRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => applyZoom(zoom === FIT ? 2 : FIT)}
      data-zoomed={zoom > FIT}
      data-dragging={dragging}
    >
      <img
        ref={imageRef}
        onLoad={measure}
        className="viewer__image"
        src={`media://play/${item.id}?m=${item.mtime}`}
        alt={item.name}
        draggable={false}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
        }}
        onError={() => setFailed(true)}
      />

      {timerSeconds !== null && box ? (
        <span
          // Keyed by image and duration, so the line starts full again for
          // each new image or a changed timer.
          key={`${item.id}:${timerSeconds}`}
          className="viewer__timer"
          style={{
            left: box.left,
            top: box.top - 3,
            width: box.width,
            animationDuration: `${timerSeconds}s`,
          }}
          aria-hidden="true"
        />
      ) : null}

      {zoom !== FIT ? (
        <span className="viewer__zoom">{Math.round(zoom * 100)}%</span>
      ) : null}
    </div>
  )
}
