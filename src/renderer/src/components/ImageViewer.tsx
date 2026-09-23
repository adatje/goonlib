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

const MIN_ZOOM = 1
const MAX_ZOOM = 8

/**
 * Fit-to-window by default, with wheel zoom and drag to pan once zoomed in.
 * Panning is clamped so the image can never be dragged off screen entirely.
 */
export function ImageViewer({ item, timerSeconds = null }: ImageViewerProps): React.JSX.Element {
  const [zoom, setZoom] = useState(1)
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

  // Reset the view whenever a different image is shown.
  useEffect(() => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    setFailed(false)
  }, [item.id])

  const applyZoom = useCallback((next: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
    setZoom(clamped)
    // Snapping back to fit should also recentre, or the image stays offset.
    if (clamped === MIN_ZOOM) setOffset({ x: 0, y: 0 })
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
      if (zoom <= MIN_ZOOM) return
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
      onDoubleClick={() => applyZoom(zoom > MIN_ZOOM ? MIN_ZOOM : 2)}
      data-zoomed={zoom > MIN_ZOOM}
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

      {zoom > MIN_ZOOM ? (
        <span className="viewer__zoom">{Math.round(zoom * 100)}%</span>
      ) : null}
    </div>
  )
}
