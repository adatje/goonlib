import { useCallback, useEffect, useRef, useState } from 'react'

/** The shape this menu needs. Both `Collection` and `Tag` satisfy it. */
export interface NamedList {
  id: number
  name: string
  count: number
}

export interface AddToCollectionProps {
  collections: NamedList[]
  /** Called with an existing id, or a name to create one. */
  onAdd: (target: { id: number } | { name: string }) => void
  label?: string
  placeholder?: string
  emptyText?: string
  /** Rendered with a check beside them, for a list the item already belongs to. */
  activeIds?: ReadonlySet<number>
  /**
   * Takes the item back out of one it is in. Given this, the menu is a
   * multi-select: clicking a ticked entry removes, an unticked one adds, and
   * the menu stays open, so an accidental pick is one click to undo.
   */
  onRemove?: (id: number) => void
}

/**
 * A small menu for filing the current item into a collection or a tag, with an
 * inline "create and add" so the first one doesn't require a detour to the
 * sidebar.
 */
export function AddToCollection(props: AddToCollectionProps): React.JSX.Element {
  const { collections, onAdd } = props

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const shellRef = useRef<HTMLDivElement | null>(null)

  // Close when clicking anywhere else.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      if (!shellRef.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const multi = props.onRemove !== undefined

  const create = useCallback(() => {
    const name = draft.trim()
    if (!name) return
    onAdd({ name })
    setDraft('')
    if (!multi) setOpen(false)
  }, [draft, onAdd, multi])

  return (
    <div className="addto" ref={shellRef}>
      <button
        type="button"
        className="addto__trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {props.label ?? 'Add to…'}
      </button>

      {open ? (
        <div className="addto__menu" role="menu" aria-multiselectable={multi || undefined}>
          {collections.length === 0 ? (
            <p className="addto__empty">{props.emptyText ?? 'No collections yet.'}</p>
          ) : (
            collections.map((collection) => (
              <button
                key={collection.id}
                type="button"
                className="addto__item"
                role={multi ? 'menuitemcheckbox' : 'menuitem'}
                aria-checked={multi ? (props.activeIds?.has(collection.id) ?? false) : undefined}
                onClick={() => {
                  if (multi && props.activeIds?.has(collection.id)) {
                    props.onRemove?.(collection.id)
                  } else {
                    onAdd({ id: collection.id })
                  }
                  if (!multi) setOpen(false)
                }}
              >
                <span className="addto__check" aria-hidden="true">
                  {props.activeIds?.has(collection.id) ? '✓' : ''}
                </span>
                <span className="addto__name">{collection.name}</span>
                <span className="addto__count">{collection.count}</span>
              </button>
            ))
          )}

          <div className="addto__new">
            <input
              className="addto__input"
              placeholder={props.placeholder ?? 'New collection…'}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') create()
                if (event.key === 'Escape') setOpen(false)
                // The lightbox listens for keys at the window; without this its
                // shortcuts would fire while the user is typing a name.
                event.stopPropagation()
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
