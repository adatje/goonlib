import { VirtuosoGrid } from 'react-virtuoso'
import type { MediaItem } from '@shared/types'
import type { LibraryView } from '../state/useLibrary'
import type { Selection } from '../state/useSelection'
import { MediaCard } from './MediaCard'

export interface MediaGridProps {
  view: LibraryView
  hasRoots: boolean
  scanning: boolean
  onOpen: (index: number) => void
  selection?: Selection
  /** Enables drag-to-reorder, which only means anything inside a collection. */
  reorderable?: boolean
  onReorder?: (fromIndex: number, toIndex: number) => void
  onContextMenu?: (mediaId: number) => void
  onToggleFavorite?: (item: MediaItem) => void
}

export function MediaGrid({
  view,
  hasRoots,
  scanning,
  onOpen,
  selection,
  reorderable = false,
  onReorder,
  onContextMenu,
  onToggleFavorite,
}: MediaGridProps): React.JSX.Element {
  if (view.error) {
    return (
      <div className="empty" role="alert">
        <h2 className="empty__title">Couldn&apos;t read the library</h2>
        <p className="empty__body">{view.error}</p>
      </div>
    )
  }

  if (view.loaded && view.total === 0) {
    return <Empty hasRoots={hasRoots} scanning={scanning} />
  }

  return (
    <VirtuosoGrid
      className="grid"
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

function Empty({ hasRoots, scanning }: { hasRoots: boolean; scanning: boolean }): React.JSX.Element {
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

  return (
    <div className="empty">
      <h2 className="empty__title">Nothing matches</h2>
      <p className="empty__body">Try a different search or filter.</p>
    </div>
  )
}
