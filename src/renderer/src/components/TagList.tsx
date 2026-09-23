import { useCallback, useState } from 'react'
import type { Tag } from '@shared/types'
import { formatCount } from '../format'
import { TagIcon } from './SidebarIcons'
import { matchesFilter, SidebarSection, useSectionFilter } from './SidebarSection'

export interface TagListProps {
  tags: Tag[]
  selectedId: number | null
  onSelect: (id: number | null) => void
  onCreate: (name: string) => void
  onRename: (id: number, name: string) => void
  onDelete: (tag: Tag) => void
}

/**
 * The sidebar's tag section.
 *
 * Structurally a sibling of the folder tree and the collection list: click to
 * narrow the grid, double-click to rename, × to remove. The one thing it says
 * that they don't is where a tag came from — a tag every one of whose items was
 * filed by the classifier is marked, because deleting it is a different kind of
 * decision than deleting one you built by hand.
 */
export function TagList(props: TagListProps): React.JSX.Element {
  const { tags, selectedId, onSelect, onCreate, onRename, onDelete } = props

  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)

  const commitCreate = useCallback(() => {
    const name = draft.trim()
    if (name) onCreate(name)
    setDraft('')
    setCreating(false)
  }, [draft, onCreate])

  const [filter, chooseFilter] = useSectionFilter('tags')
  const shown = tags.filter((tag) => matchesFilter(filter, tag))

  return (
    <SidebarSection
      title="Tags"
      id="tags"
      count={shown.length}
      icon={<TagIcon />}
      active={props.selectedId !== null}
      filter={{ value: filter, onChange: chooseFilter }}
    >

      {shown.length === 0 && !creating ? (
        <p className="muted">{tags.length === 0 ? 'None yet.' : 'None of those here.'}</p>
      ) : (
        // Capped and scrollable: a classified library can easily produce more
        // tags than collections, and it must not push the folder tree off-screen.
        <ul className="collection-list collection-list--capped">
          {shown.map((tag) => (
            <li key={tag.id} className="collection">
              {editingId === tag.id ? (
                <input
                  className="collection__input"
                  defaultValue={tag.name}
                  autoFocus
                  onBlur={(event) => {
                    const next = event.target.value.trim()
                    if (next && next !== tag.name) onRename(tag.id, next)
                    setEditingId(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    // Escape must not commit — restore and bail.
                    if (event.key === 'Escape') {
                      event.currentTarget.value = tag.name
                      event.currentTarget.blur()
                    }
                  }}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className={
                      selectedId === tag.id
                        ? 'collection__name collection__name--on'
                        : 'collection__name'
                    }
                    onClick={() => onSelect(selectedId === tag.id ? null : tag.id)}
                    onDoubleClick={() => setEditingId(tag.id)}
                    title={describe(tag)}
                  >
                    <span className="collection__label">
                      {tag.name}
                      {tag.count > 0 && tag.aiCount === tag.count ? (
                        <span className="tag__ai" aria-label="suggested by AI">
                          ai
                        </span>
                      ) : null}
                    </span>
                    <span className="collection__count">{formatCount(tag.count)}</span>
                  </button>
                  <button
                    type="button"
                    className="root__remove"
                    onClick={() => onDelete(tag)}
                    aria-label={`Delete the tag ${tag.name}`}
                    title="Delete tag (your files are not touched)"
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
          placeholder="Tag name"
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
          New tag
        </button>
      )}
    </SidebarSection>
  )
}

function describe(tag: Tag): string {
  const base = `${tag.name} - double-click to rename`
  if (tag.count === 0 || tag.aiCount === 0) return base
  if (tag.aiCount === tag.count) return `${base}. Every use was suggested by AI.`
  return `${base}. ${formatCount(tag.aiCount)} of ${formatCount(tag.count)} suggested by AI.`
}
