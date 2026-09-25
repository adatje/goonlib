import { useCallback, useEffect, useRef, useState } from 'react'
import type { MediaItem } from '@shared/types'
import { MediaCard } from './MediaCard'

/**
 * Videos left part-way through, across the top of the library.
 *
 * Only the plain library shows it: inside a collection, a tag or a search you
 * are looking for something particular, and a row of unrelated half-watched
 * videos would be in the way. It disappears entirely when there is nothing in
 * it, or when Settings say not to show it.
 */
export function ContinueRow(props: {
  /** Bumped by whoever wants the row re-read — after watching something, say. */
  refreshKey: number
  /** The most it will hold, from Settings. */
  count: number
  onOpen: (mediaId: number) => void
  onContextMenu?: (mediaId: number, x: number, y: number) => void
  onToggleFavorite?: (item: MediaItem) => void
}): React.JSX.Element | null {
  const [items, setItems] = useState<Array<{ item: MediaItem; progress: number }>>([])
  /** Which edges have more beyond them: 'none', 'start', 'middle' or 'end'. */
  const [edges, setEdges] = useState<'none' | 'start' | 'middle' | 'end'>('none')
  const rowRef = useRef<HTMLDivElement | null>(null)

  const { count } = props
  const load = useCallback(async () => {
    try {
      const found = await window.goonlib.media.continueWatching(count)
      const withProgress = await Promise.all(
        found.map(async (item) => {
          const views = await window.goonlib.media.views(item.id).catch(() => null)
          const position = views?.positionMs ?? 0
          const total = item.durationMs ?? 0
          return { item, progress: total > 0 ? Math.min(1, position / total) : 0 }
        }),
      )
      setItems(withProgress)
    } catch {
      setItems([])
    }
  }, [count])

  useEffect(() => {
    void load()
  }, [load, props.refreshKey])

  /**
   * Which way the row can still be scrolled, so the stylesheet can fade that
   * edge. A card sliced off at the frame's edge looks like a layout fault; a
   * card fading out looks like there is more of it.
   */
  useEffect(() => {
    const row = rowRef.current
    if (!row) return

    const measure = (): void => {
      const slack = row.scrollWidth - row.clientWidth
      if (slack <= 4) return setEdges('none')
      if (row.scrollLeft <= 4) return setEdges('start')
      if (row.scrollLeft >= slack - 4) return setEdges('end')
      setEdges('middle')
    }

    measure()
    row.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => {
      row.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [items])

  if (items.length === 0) return null

  return (
    <section className="continue" aria-label="Continue watching">
      <h2 className="continue__title">Continue watching</h2>
      <div ref={rowRef} className="continue__row" data-edges={edges}>
        {items.map(({ item, progress }) => (
          <div key={item.id} className="continue__card">
            <MediaCard
              item={item}
              progress={progress}
              onOpen={() => props.onOpen(item.id)}
              onContextMenu={props.onContextMenu}
              onToggleFavorite={(favourited) => {
                // The row holds its own copy of each item, so the heart is
                // flipped here as well or nothing on screen would change.
                setItems((current) =>
                  current.map((entry) =>
                    entry.item.id === favourited.id
                      ? {
                          ...entry,
                          item: {
                            ...entry.item,
                            favoritedAt: entry.item.favoritedAt === null ? Date.now() : null,
                          },
                        }
                      : entry,
                  ),
                )
                props.onToggleFavorite?.(favourited)
              }}
              dismissTitle="Take off Continue watching"
              onDismiss={() => {
                // Gone from the row at once; the place itself goes in the
                // background, since nothing here depends on the answer.
                setItems((current) => current.filter((entry) => entry.item.id !== item.id))
                void window.goonlib.media.forgetPosition(item.id).catch(() => undefined)
              }}
            />
          </div>
        ))}
      </div>
      <hr className="continue__divider" />
    </section>
  )
}
