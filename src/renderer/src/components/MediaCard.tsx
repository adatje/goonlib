import type { MediaItem } from '@shared/types'
import { formatDuration } from '../format'
import { HoverScrub } from './HoverScrub'
import { HeartIcon } from './Toolbar'

export interface MediaCardProps {
  item: MediaItem | undefined
  onOpen: () => void
  /** Cmd/Ctrl-click: add or remove this one card. */
  onToggleSelect?: () => void
  /** Shift-click: extend the selection to this card. */
  onExtendSelect?: () => void
  selected?: boolean
  onContextMenu?: (mediaId: number, x: number, y: number) => void
  /** The heart in the corner. Absent means the card shows no heart at all. */
  onToggleFavorite?: (item: MediaItem) => void
  /** How far through this video was left, 0 to 1, drawn along the bottom. */
  progress?: number
  /** Takes the card off whatever list it is in. Absent means no such button. */
  onDismiss?: () => void
  dismissTitle?: string
}

export function MediaCard({
  item,
  onOpen,
  onToggleSelect,
  onExtendSelect,
  selected = false,
  onContextMenu,
  onToggleFavorite,
  progress,
  onDismiss,
  dismissTitle,
}: MediaCardProps): React.JSX.Element {
  if (!item) {
    // The page covering this index hasn't arrived yet.
    return <div className="card card--skeleton" aria-hidden="true" />
  }

  const hasThumb = item.thumbState === 'done'
  const duration = formatDuration(item.durationMs)
  const favorite = item.favoritedAt !== null

  return (
    <figure
      className={selected ? 'card card--selected' : 'card'}
      title={item.relPath}
      onClick={(event) => {
        // A plain click still opens, exactly as before — selection is something
        // you opt into with a modifier, so nothing about the ordinary path
        // changes. metaKey is the Mac chord, ctrlKey the one everywhere else.
        if (event.metaKey || event.ctrlKey) {
          onToggleSelect?.()
          return
        }
        if (event.shiftKey) {
          onExtendSelect?.()
          return
        }
        onOpen()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu?.(item.id, event.clientX, event.clientY)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (event.metaKey || event.ctrlKey) onToggleSelect?.()
          else onOpen()
        }
      }}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={selected ? `${item.name}, selected` : `Open ${item.name}`}
    >
      <div className="card__frame">
        {hasThumb ? (
          <img
            className="card__thumb"
            // mtime is part of the URL so a re-encoded file gets a fresh
            // thumbnail rather than the immutably-cached old one.
            src={`media://thumb/${item.id}?m=${item.mtime}`}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : (
          <div className="card__pending">
            {item.thumbState === 'error' ? 'No preview' : ''}
          </div>
        )}

        <HoverScrub item={item} />

        {onDismiss ? (
          <button
            type="button"
            className="card__heart card__dismiss"
            // As with the heart: the card underneath must not open.
            onClick={(event) => {
              event.stopPropagation()
              onDismiss()
            }}
            onKeyDown={(event) => event.stopPropagation()}
            aria-label={dismissTitle ?? 'Remove'}
            title={dismissTitle ?? 'Remove'}
          >
            ×
          </button>
        ) : null}

        {onToggleFavorite ? (
          <button
            type="button"
            className={favorite ? 'card__heart card__heart--on' : 'card__heart'}
            // The card underneath opens on click and on Enter; neither should
            // fire when what was meant was the heart.
            onClick={(event) => {
              event.stopPropagation()
              onToggleFavorite(item)
            }}
            onKeyDown={(event) => event.stopPropagation()}
            aria-pressed={favorite}
            aria-label={favorite ? `Unfavorite ${item.name}` : `Favorite ${item.name}`}
            title={favorite ? 'Unfavorite' : 'Favorite'}
          >
            <HeartIcon filled={favorite} size={14} />
          </button>
        ) : null}

        {/* Top left, opposite the heart. Selection was reachable only by holding
            Cmd and clicking, which is a feature you have to be told about. */}
        {onToggleSelect ? (
          <button
            type="button"
            className={selected ? 'card__pick card__pick--on' : 'card__pick'}
            onClick={(event) => {
              event.stopPropagation()
              if (event.shiftKey) onExtendSelect?.()
              else onToggleSelect()
            }}
            onKeyDown={(event) => event.stopPropagation()}
            aria-pressed={selected}
            aria-label={selected ? `Deselect ${item.name}` : `Select ${item.name}`}
            title={selected ? 'Deselect - shift-click for a range' : 'Select - shift-click for a range'}
          >
            {selected ? '✓' : ''}
          </button>
        ) : null}

        {item.kind === 'video' ? (
          <span className="card__badge">{duration || 'video'}</span>
        ) : null}

        {item.missing ? <span className="card__badge card__badge--warn">missing</span> : null}

        {/* How far it was watched, for something left part-way through. */}
        {progress !== undefined && progress > 0 ? (
          <span className="card__progress" aria-hidden="true">
            <span className="card__progress-fill" style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </span>
        ) : null}
      </div>

      <figcaption className="card__name">{item.name}</figcaption>
    </figure>
  )
}
