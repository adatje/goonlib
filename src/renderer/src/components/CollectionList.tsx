import { useCallback, useState } from 'react'
import type { Collection } from '@shared/types'
import { formatCount } from '../format'
import { CollectionsIcon } from './SidebarIcons'
import { matchesFilter, SidebarSection, useSectionFilter } from './SidebarSection'

export interface CollectionListProps {
  collections: Collection[]
  selectedId: number | null
  onSelect: (id: number | null) => void
  onCreate: (name: string) => void
  onRename: (id: number, name: string) => void
  onDelete: (collection: Collection) => void
}

export function CollectionList(props: CollectionListProps): React.JSX.Element {
  const { collections, selectedId, onSelect, onCreate, onRename, onDelete } = props

  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)

  const commitCreate = useCallback(() => {
    const name = draft.trim()
    if (name) onCreate(name)
    setDraft('')
    setCreating(false)
  }, [draft, onCreate])

  const [filter, chooseFilter] = useSectionFilter('collections')
  const shown = collections.filter((collection) => matchesFilter(filter, collection))

  return (
    <SidebarSection
      title="Collections"
      id="collections"
      count={shown.length}
      icon={<CollectionsIcon />}
      active={selectedId !== null}
      filter={{ value: filter, onChange: chooseFilter }}
    >

      {shown.length === 0 && !creating ? (
        <p className="muted">{collections.length === 0 ? 'None yet.' : 'None of those here.'}</p>
      ) : (
        <ul className="collection-list">
          {shown.map((collection) => (
            <li key={collection.id} className="collection">
              {editingId === collection.id ? (
                <input
                  className="collection__input"
                  defaultValue={collection.name}
                  autoFocus
                  onBlur={(event) => {
                    const next = event.target.value.trim()
                    if (next && next !== collection.name) onRename(collection.id, next)
                    setEditingId(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    // Escape must not commit — restore and bail.
                    if (event.key === 'Escape') {
                      event.currentTarget.value = collection.name
                      event.currentTarget.blur()
                    }
                  }}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className={
                      selectedId === collection.id
                        ? 'collection__name collection__name--on'
                        : 'collection__name'
                    }
                    onClick={() => onSelect(collection.id)}
                    onDoubleClick={() => setEditingId(collection.id)}
                    title={`${collection.name} - double-click to rename`}
                  >
                    <span className="collection__label">
                      {collection.name}
                      {collection.count > 0 && collection.aiCount === collection.count ? (
                        <span className="tag__ai" aria-label="filed by AI">
                          ai
                        </span>
                      ) : null}
                    </span>
                    <span className="collection__count">{formatCount(collection.count)}</span>
                  </button>
                  <button
                    type="button"
                    className="root__remove"
                    onClick={() => onDelete(collection)}
                    aria-label={`Delete the collection ${collection.name}`}
                    title="Delete collection (your files are not touched)"
                  >
                    ×
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <input
          className="collection__input"
          placeholder="Collection name"
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitCreate}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitCreate()
            if (event.key === 'Escape') {
              setDraft('')
              setCreating(false)
            }
          }}
        />
      ) : (
        <button type="button" className="button button--quiet" onClick={() => setCreating(true)}>
          New collection
        </button>
      )}
    </SidebarSection>
  )
}
