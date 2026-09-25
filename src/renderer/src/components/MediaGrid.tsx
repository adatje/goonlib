import { useEffect, useRef, useState } from 'react'
import { VirtuosoGrid } from 'react-virtuoso'
import type { MediaItem } from '@shared/types'
import type { LibraryView } from '../state/useLibrary'
import type { Selection } from '../state/useSelection'
import { MediaCard } from './MediaCard'

export interface MediaGridProps {
  view: LibraryView
  hasRoots: boolean
  scanning: boolean
  /**
   * What is being looked at, when it is one named thing rather than the whole
   * library. An empty one of these has nothing in it yet, which is a different
   * thing from a search that found nothing.
   */
  emptyKind?: { kind: 'collection' | 'tag'; name: string } | null
  onOpen: (index: number) => void
  selection?: Selection
  /** Enables drag-to-reorder, which only means anything inside a collection. */
  reorderable?: boolean
  onReorder?: (fromIndex: number, toIndex: number) => void
  onContextMenu?: (mediaId: number, x: number, y: number) => void
  onToggleFavorite?: (item: MediaItem) => void
}

export function MediaGrid({
  view,
  hasRoots,
  scanning,
  emptyKind,
  onOpen,
  selection,
  reorderable = false,
  onReorder,
  onContextMenu,
  onToggleFavorite,
}: MediaGridProps): React.JSX.Element {
  /**
   * Which way the grid can still be scrolled, so the stylesheet can fade that
   * edge - the same trick the Continue watching row uses, turned on its side.
   * The scroller belongs to the virtualiser, so it is taken from its ref.
   */
  const [edges, setEdges] = useState<'none' | 'start' | 'middle' | 'end'>('none')
  const scrollerRef = useRef<HTMLElement | Window | null>(null)

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || scroller instanceof Window) return

    const measure = (): void => {
      const slack = scroller.scrollHeight - scroller.clientHeight
      if (slack <= 4) return setEdges('none')
      if (scroller.scrollTop <= 4) return setEdges('start')
      if (scroller.scrollTop >= slack - 4) return setEdges('end')
      setEdges('middle')
    }

    measure()
    scroller.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [view.total])

  if (view.error) {
    return (
      <div className="empty" role="alert">
        <h2 className="empty__title">Couldn&apos;t read the library</h2>
        <p className="empty__body">{view.error}</p>
      </div>
    )
  }

  if (view.loaded && view.total === 0) {
    return <Empty hasRoots={hasRoots} scanning={scanning} emptyKind={emptyKind ?? null} />
  }

  return (
    <VirtuosoGrid
      className="grid"
      data-edges={edges}
      scrollerRef={(ref) => (scrollerRef.current = ref)}
      totalCount={view.total}
      listClassName="grid__list"
      itemClassName="grid__item"
      // Keep a screenful of rows rendered either side so fast scrolling doesn't
      // outrun the page fetches.
      overscan={800}
      rangeChanged={({ startIndex, endIndex }) => view.ensureRange(startIndex, endIndex)}
      itemContent={(index) => {
        const item = view.itemAt(index)

        const card = (
          <MediaCard
            item={item}
            onOpen={() => onOpen(index)}
            selected={item !== undefined && selection !== undefined && selection.has(item.id)}
            onToggleSelect={item ? () => selection?.toggle(item.id, index) : undefined}
            onExtendSelect={() => selection?.extendTo(index)}
            onContextMenu={onContextMenu}
            onToggleFavorite={onToggleFavorite}
          />
        )

        if (!reorderable) return card

        return (
          <div
            draggable={item !== undefined}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', String(index))
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(event) => {
              // Without preventDefault the drop never fires at all.
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }}
            onDrop={(event) => {
              event.preventDefault()
              const from = Number(event.dataTransfer.getData('text/plain'))
              if (Number.isInteger(from) && from !== index) onReorder?.(from, index)
            }}
          >
            {card}
          </div>
        )
      }}
    />
  )
}

function Empty({
  hasRoots,
  scanning,
  emptyKind,
}: {
  hasRoots: boolean
  scanning: boolean
  emptyKind: { kind: 'collection' | 'tag'; name: string } | null
}): React.JSX.Element {
  if (!hasRoots) {
    return (
      <div className="empty">
        <h2 className="empty__title">No folders yet</h2>
        <p className="empty__body">
          Add a folder and GoonLib will index what&apos;s inside it. Your files stay exactly
          where they are - nothing is moved, copied, or renamed.
        </p>
      </div>
    )
  }

  if (scanning) {
    return (
      <div className="empty">
        <h2 className="empty__title">Scanning…</h2>
        <p className="empty__body">Items will appear here as they&apos;re found.</p>
      </div>
    )
  }

  // A collection or tag with nothing in it is not a search that failed - there
  // is nothing to search. Say what it is and how things get into it.
  if (emptyKind) {
    return (
      <div className="empty">
        <h2 className="empty__title">
          {emptyKind.name} is empty
        </h2>
        <p className="empty__body">
          {emptyKind.kind === 'collection'
            ? 'Select items in the library and use Add to Collection, or right-click a single one. A collection can also gather tags: right-click it in the sidebar to choose which.'
            : 'Select items in the library and use Add to Tag, or right-click a single one.'}
        </p>
      </div>
    )
  }

  return (
    <div className="empty">
      <h2 className="empty__title">Nothing matches</h2>
      <p className="empty__body">Try a different search or filter.</p>
    </div>
  )
}
