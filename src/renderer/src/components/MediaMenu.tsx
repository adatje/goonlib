import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Collection, MediaFileAction, MediaItem, Root, Tag } from '@shared/types'
import { IS_MAC, REVEAL_LABEL, TRASH_NAME } from '../platform'
import { FolderPicker } from './FolderPicker'
import { AddToCollection } from './AddToCollection'

/** Where a menu was asked for, in window coordinates. */
export interface MenuAt {
  mediaId: number
  x: number
  y: number
}

export interface MediaMenuProps {
  /** The sources whose folders can be moved into. */
  roots: Root[]
  /** Shown when a move has something to say. */
  onMessage?: (text: string) => void
  at: MenuAt
  item: MediaItem | null
  collections: Collection[]
  tags: Tag[]
  /** The collection being viewed, which this item can be taken out of. */
  activeCollection: Collection | null
  onClose: () => void
  onOpen: (mediaId: number) => void
  onFavorite: (mediaId: number, favorite: boolean) => void
  onAddToCollection: (target: { id: number } | { name: string }, mediaId: number) => Promise<void> | void
  onLeaveCollection: (collectionId: number, mediaId: number) => Promise<void> | void
  onToggleTag: (
    target: { id: number } | { name: string },
    mediaId: number,
    attached: boolean,
  ) => Promise<void> | void
  /** Fired after anything that changed the library, so the grid catches up. */
  onChanged: () => void
}

/**
 * The right-click menu for an item, drawn by the app rather than the system.
 *
 * It was a native menu, which looked right on macOS and nowhere else, could
 * not take the name of a new collection, and shared none of the app's own
 * colours. This is the same list in the app's style, with the viewer's own
 * Add to Collection and Add to Tag menus inside it, so filing works the same
 * way wherever you do it. Everything that touches the machine — the clipboard,
 * the Finder, the Trash — is still done by the main process.
 */
export function MediaMenu(props: MediaMenuProps): React.JSX.Element | null {
  const [picking, setPicking] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { at, item, onClose, onChanged } = props
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [memberOf, setMemberOf] = useState<ReadonlySet<number>>(new Set())
  const [tagIds, setTagIds] = useState<ReadonlySet<number>>(new Set())

  // Close on a click anywhere else, on Escape, and on a scroll that would
  // otherwise leave the menu pointing at nothing.
  useEffect(() => {
    const outside = (event: MouseEvent): void => {
      if (!shellRef.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('mousedown', outside)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const loadMembership = useCallback(async () => {
    const [collections, annotations] = await Promise.all([
      window.goonlib.collections.of(at.mediaId).catch(() => [] as number[]),
      window.goonlib.media.annotations(at.mediaId).catch(() => ({ labels: [], caption: null })),
    ])
    setMemberOf(new Set(collections))
    const names = new Set(annotations.labels.map((label) => label.label.toLowerCase()))
    setTagIds(new Set(props.tags.filter((tag) => names.has(tag.name.toLowerCase())).map((tag) => tag.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tags read fresh each call
  }, [at.mediaId])

  useEffect(() => {
    void loadMembership()
  }, [loadMembership])

  // Kept on screen: a menu raised near the right or bottom edge is moved back
  // rather than clipped.
  const place = useMemo(() => {
    const width = 230
    const height = 360
    return {
      left: Math.max(8, Math.min(at.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(at.y, window.innerHeight - height - 8)),
    }
  }, [at.x, at.y])

  if (!item) return null

  const act = (kind: MediaFileAction): void => {
    onClose()
    void window.goonlib.media
      .fileAction(kind, item.id)
      .then((done) => {
        if (done && kind === 'trash') onChanged()
      })
      .catch(() => undefined)
  }

  if (renaming !== null) {
    const stem = stemOf(item)

    return (
      <div className="mediamenu" style={place} ref={shellRef} role="dialog" aria-label={`Rename ${item.name}`}>
        <form
          className="mediamenu__form"
          onSubmit={(event) => {
            event.preventDefault()
            setBusy(true)
            void window.goonlib.media
              .rename(item.id, renaming)
              .then((result) => {
                if (result.message) props.onMessage?.(result.message)
                // A refused name leaves the box open with what was typed still
                // in it, so it can be corrected rather than retyped.
                if (!result.ok) return
                onChanged()
                onClose()
              })
              .catch((err: unknown) => props.onMessage?.(err instanceof Error ? err.message : String(err)))
              .finally(() => setBusy(false))
          }}
        >
          <span className="mediamenu__head">Rename</span>
          <input
            className="collection__input"
            value={renaming}
            autoFocus
            placeholder="Name"
            onChange={(event) => setRenaming(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
          {/* The extension is not in the box and not up for editing: it is what
              says what the file is, and this menu is for fixing a bad name. */}
          <span className="settings__hint">Keeps {item.ext || 'its extension'}</span>
          <div className="settings__row settings__row--tight">
            <button
              type="submit"
              className="button button--primary"
              disabled={busy || !renaming.trim() || renaming === stem}
            >
              Rename
            </button>
            <button type="button" className="button button--quiet" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    )
  }

  if (picking) {
    return (
      <div className="mediamenu" style={place} ref={shellRef} role="menu" aria-label={`Move ${item.name}`}>
        <span className="mediamenu__head">Move {item.name} to</span>
        <div className="mediamenu__rule" role="separator" />
        <FolderPicker
          roots={props.roots}
          exclude={{ rootId: -1, path: '' }}
          onPick={(target) => {
            onClose()
            void window.goonlib.media
              .moveTo([item.id], target.rootId, target.path)
              .then((result) => {
                if (result.message) props.onMessage?.(result.message)
                if (result.ok) props.onChanged()
              })
              .catch(() => undefined)
          }}
        />
      </div>
    )
  }

  return (
    <div className="mediamenu" style={place} ref={shellRef} role="menu" aria-label={item.name}>
      <button
        type="button"
        className="mediamenu__item"
        role="menuitem"
        onClick={() => {
          onClose()
          props.onOpen(item.id)
        }}
      >
        {item.kind === 'video' ? 'Play' : 'Open'}
      </button>

      <button
        type="button"
        className="mediamenu__item"
        role="menuitemcheckbox"
        aria-checked={item.favoritedAt !== null}
        onClick={() => {
          onClose()
          props.onFavorite(item.id, item.favoritedAt === null)
        }}
      >
        {item.favoritedAt !== null ? 'Unfavorite' : 'Favorite'}
      </button>

      <div className="mediamenu__rule" role="separator" />

      <div className="mediamenu__row">
        <AddToCollection
          label="Add to Collection"
          collections={props.collections}
          activeIds={memberOf}
          onAdd={(target) =>
            void Promise.resolve(props.onAddToCollection(target, item.id)).then(loadMembership)
          }
          onRemove={(id) => void Promise.resolve(props.onLeaveCollection(id, item.id)).then(loadMembership)}
        />
        <AddToCollection
          label="Add to Tag"
          placeholder="New tag…"
          emptyText="No tags yet."
          collections={props.tags}
          activeIds={tagIds}
          onAdd={(target) =>
            void Promise.resolve(
              props.onToggleTag(target, item.id, 'id' in target && tagIds.has(target.id)),
            ).then(loadMembership)
          }
          onRemove={(id) => void Promise.resolve(props.onToggleTag({ id }, item.id, true)).then(loadMembership)}
        />
      </div>

      {props.activeCollection ? (
        <button
          type="button"
          className="mediamenu__item"
          role="menuitem"
          onClick={() => {
            onClose()
            void Promise.resolve(props.onLeaveCollection(props.activeCollection!.id, item.id))
          }}
        >
          Remove from “{props.activeCollection.name}”
        </button>
      ) : null}

      <div className="mediamenu__rule" role="separator" />

      {/* Off macOS, copying a file puts its path on the clipboard as text -
          which is what "Copy File Path" below already says it does. Showing
          both would be two names for one thing. */}
      {IS_MAC ? (
        <button type="button" className="mediamenu__item" role="menuitem" onClick={() => act('copy')}>
          Copy
        </button>
      ) : null}
      {item.kind === 'image' ? (
        <button type="button" className="mediamenu__item" role="menuitem" onClick={() => act('copy-image')}>
          Copy Image
        </button>
      ) : null}
      <button type="button" className="mediamenu__item" role="menuitem" onClick={() => act('copy-path')}>
        Copy File Path
      </button>
      <button type="button" className="mediamenu__item" role="menuitem" onClick={() => act('copy-name')}>
        Copy Filename
      </button>

      <div className="mediamenu__rule" role="separator" />

      <button
        type="button"
        className="mediamenu__item"
        role="menuitem"
        onClick={() => setRenaming(stemOf(item))}
      >
        Rename…
      </button>

      <button type="button" className="mediamenu__item" role="menuitem" onClick={() => setPicking(true)}>
        Move to folder…
      </button>

      <button type="button" className="mediamenu__item" role="menuitem" onClick={() => act('reveal')}>
        {REVEAL_LABEL}
      </button>

      <div className="mediamenu__rule" role="separator" />

      <button
        type="button"
        className="mediamenu__item mediamenu__item--danger"
        role="menuitem"
        onClick={() => act('trash')}
      >
        Move to {TRASH_NAME}
      </button>
    </div>
  )
}

/**
 * The part of a filename worth editing.
 *
 * The extension is left out of the box entirely rather than shown and guarded:
 * it is what says what the file is, and every name this menu exists to fix is
 * wrong in the stem.
 */
function stemOf(item: MediaItem): string {
  return item.ext && item.name.toLowerCase().endsWith(item.ext.toLowerCase())
    ? item.name.slice(0, -item.ext.length)
    : item.name
}
