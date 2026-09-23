import { useCallback, useEffect, useState } from 'react'
import type { MediaItem } from '@shared/types'
import { MediaCard } from './MediaCard'

/** How many part-watched videos the row offers. */
const LIMIT = 12

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
  onOpen: (mediaId: number) => void
  onContextMenu?: (mediaId: number, x: number, y: number) => void
}): React.JSX.Element | null {
  const [items, setItems] = useState<Array<{ item: MediaItem; progress: number }>>([])

  const load = useCallback(async () => {
    try {
      const found = await window.goonlib.media.continueWatching(LIMIT)
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
  }, [])

  useEffect(() => {
    void load()
  }, [load, props.refreshKey])

  if (items.length === 0) return null

  return (
    <section className="continue" aria-label="Continue watching">
      <h2 className="continue__title">Continue watching</h2>
      <div className="continue__row">
        {items.map(({ item, progress }) => (
          <div key={item.id} className="continue__card">
            <MediaCard
              item={item}
              progress={progress}
              onOpen={() => props.onOpen(item.id)}
              onContextMenu={props.onContextMenu}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
