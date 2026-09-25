import { useEffect, useState } from 'react'
import type { Collection, Tag } from '@shared/types'
import { AddToCollection } from './AddToCollection'
import { HeartIcon } from './Toolbar'
import { MoveIcon, TrashIcon } from './SidebarIcons'
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
  /** Bumped when any favourite changes, so the heart re-reads its count. */
  favoriteKey: number
  collections: Collection[]
  tags: Tag[]
  /** Files everything selected, creating the collection if the name is new. */
  onAddToCollection: (target: { id: number } | { name: string }) => Promise<void> | void
  /** The same for a tag. */
  onAddToTag: (target: { id: number } | { name: string }) => Promise<void> | void
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
  favoriteKey,
  collections,
  tags,
  onAddToCollection,
  onAddToTag,
}: SelectionBarProps): React.JSX.Element {
  const all = selection.size >= total && total > 0
  /*
   * Filing the whole selection. The right-click menu can only ever mean the one
   * card it was opened on, which is right for a menu and no use for a hundred
   * items - so the bulk versions live here, where the count is already the
   * subject of the sentence.
   */
  const [filing, setFiling] = useState<'collection' | 'tag' | null>(null)

  /*
   * How many of the selection are already favourites, which decides which way
   * the one heart button points. It cannot be read off the grid: most of a
   * large selection is never rendered, so the main process counts it.
   */
  const [favorited, setFavorited] = useState(0)
  useEffect(() => {
    const ids = [...selection.ids]
    if (ids.length === 0) return setFavorited(0)
    let current = true
    void window.goonlib.media
      .favoriteCount(ids)
      .then((n) => current && setFavorited(n))
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [selection.ids, favoriteKey])

  // Pink only when every selected item is already a favourite: a mixed
  // selection is not "favourited", and the button's job there is to finish the
  // set rather than to undo it.
  const allFavorited = selection.size > 0 && favorited === selection.size

  return (
    <div className="selbar">
      <strong>{formatCount(selection.size)} selected</strong>
      {selection.pending ? <span className="muted">working…</span> : null}

      <button type="button" className="button button--quiet" onClick={selection.selectAll} hidden={all}>
        Select all
      </button>

      <button type="button" className="button button--quiet" onClick={selection.clear}>
        Clear
      </button>

      <span className="selbar__spacer" />

      <div className="selbar__file">
        <button
          type="button"
          className={filing === 'collection' ? 'button button--on' : 'button button--quiet'}
          disabled={busy}
          onClick={() => setFiling(filing === 'collection' ? null : 'collection')}
        >
          Add to Collection
        </button>
        {filing === 'collection' ? (
          <div className="selbar__picker">
            <AddToCollection
              collections={collections}
              label="Collection"
              placeholder="New collection"
              emptyText="No collections yet."
              onAdd={(target) => {
                setFiling(null)
                void Promise.resolve(onAddToCollection(target))
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="selbar__file">
        <button
          type="button"
          className={filing === 'tag' ? 'button button--on' : 'button button--quiet'}
          disabled={busy}
          onClick={() => setFiling(filing === 'tag' ? null : 'tag')}
        >
          Add to Tag
        </button>
        {filing === 'tag' ? (
          <div className="selbar__picker">
            <AddToCollection
              collections={tags}
              label="Tag"
              placeholder="New tag"
              emptyText="No tags yet."
              onAdd={(target) => {
                setFiling(null)
                void Promise.resolve(onAddToTag(target))
              }}
            />
          </div>
        ) : null}
      </div>

      {/* One button, pointing whichever way most of the selection already is. */}
      <button
        type="button"
        className={allFavorited ? 'icon-button icon-button--fav is-on' : 'icon-button icon-button--fav'}
        disabled={busy || selection.size === 0}
        onClick={() => onFavorite(!allFavorited)}
        aria-pressed={allFavorited}
        title={
          allFavorited
            ? `Take ${formatCount(selection.size)} out of Favorites`
            : `Add ${formatCount(selection.size)} to Favorites`
        }
      >
        <HeartIcon filled={allFavorited} size={15} />
      </button>

      <button
        type="button"
        className="icon-button"
        disabled={busy || selection.size === 0}
        onClick={onMove}
        title="Move - pick a folder and move the selected files into it"
      >
        <MoveIcon />
      </button>

      <button
        type="button"
        className="icon-button icon-button--danger"
        disabled={busy || selection.size === 0}
        onClick={onTrash}
        title={`Trash - moves the selected files to the ${TRASH_NAME} after confirmation`}
      >
        <TrashIcon />
      </button>
    </div>
  )
}
