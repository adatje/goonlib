import { formatCount } from '../format'
import { TRASH_NAME } from '../platform'
import type { Selection } from '../state/useSelection'

export interface SelectionBarProps {
  selection: Selection
  /** Everything the current filters match, for "select all". */
  total: number
  busy: boolean
  onTrash: () => void
  onMove: () => void
  onFavorite: (favorite: boolean) => void
}

/**
 * The bar that appears once something in the grid is selected.
 *
 * Only rendered when there is a selection: an always-present bar would push the
 * grid down by a row for a mode most looking-at-pictures never enters.
 */
export function SelectionBar({
  selection,
  total,
  busy,
  onTrash,
  onMove,
  onFavorite,
}: SelectionBarProps): React.JSX.Element {
  const all = selection.size >= total && total > 0

  return (
    <div className="selbar">
      <strong>{formatCount(selection.size)} selected</strong>
      {selection.pending ? <span className="muted">working…</span> : null}

      <span className="selbar__spacer" />

      {all ? null : (
        <button type="button" className="button button--quiet" onClick={selection.selectAll}>
          Select all {formatCount(total)}
        </button>
      )}

      <button type="button" className="button button--quiet" onClick={selection.clear}>
        Clear
      </button>

      {/* Two buttons rather than a toggle: a selection is usually a mix, and
          "make all of these favorites" is a different request from flipping
          each one. */}
      <button
        type="button"
        className="button"
        disabled={busy || selection.size === 0}
        onClick={() => onFavorite(true)}
        title="Add the selected items to Favorites"
      >
        Favorite
      </button>

      <button
        type="button"
        className="button button--quiet"
        disabled={busy || selection.size === 0}
        onClick={() => onFavorite(false)}
        title="Remove the selected items from Favorites"
      >
        Unfavorite
      </button>

      <button
        type="button"
        className="button"
        disabled={busy || selection.size === 0}
        onClick={onMove}
        title="Pick a folder and move the selected files into it"
      >
        Move to…
      </button>

      <button
        type="button"
        className="button"
        disabled={busy || selection.size === 0}
        onClick={onTrash}
        title="Moves the selected files to the system Trash after confirmation"
      >
        {busy ? 'Moving…' : `Move to ${TRASH_NAME}`}
      </button>
    </div>
  )
}
