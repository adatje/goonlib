import { useEffect, useMemo, useRef, useState } from 'react'
import type { Tag } from '@shared/types'
import { formatCount } from '../format'

/** Roughly what it measures, for keeping it inside the window. */
const WIDTH = 300
const HEIGHT = 380

/**
 * The tags a collection gathers.
 *
 * Anything carrying any one of them is in the collection, without being filed
 * there by hand - which is the difference between the two ideas. A tag says what
 * an item is; a collection is a standing question, and this is the question.
 *
 * Every change saves at once. There is no Save button because there is nothing
 * to lose: membership is worked out when the collection is read, so a tag added
 * here shows up in the grid immediately and a tag removed takes its items back
 * out. Nothing is copied anywhere and nothing can fall out of step.
 */
export function CollectionTags(props: {
  collectionId: number
  collectionName: string
  /** Where the button that opened it sits, in window coordinates. */
  at: { x: number; y: number }
  tags: Tag[]
  onChanged: () => void
  onClose: () => void
}): React.JSX.Element {
  const shell = useRef<HTMLDivElement | null>(null)
  const [chosen, setChosen] = useState<Set<number> | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    void window.goonlib.collections
      .tags(props.collectionId)
      .then((ids) => setChosen(new Set(ids)))
      .catch(() => setChosen(new Set()))
  }, [props.collectionId])

  const { onClose } = props
  useEffect(() => {
    const away = (event: MouseEvent): void => {
      if (!shell.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', away), 0)
    document.addEventListener('keydown', escape)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [onClose])

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const matching = needle
      ? props.tags.filter((tag) => tag.name.toLowerCase().includes(needle))
      : props.tags
    // Whatever is already gathered stays at the top, so turning one off never
    // means hunting for it.
    return [...matching].sort((a, b) => {
      const picked = Number(chosen?.has(b.id) ?? false) - Number(chosen?.has(a.id) ?? false)
      return picked !== 0 ? picked : a.name.localeCompare(b.name)
    })
  }, [props.tags, filter, chosen])

  const toggle = (tagId: number): void => {
    if (!chosen) return
    const next = new Set(chosen)
    if (next.has(tagId)) next.delete(tagId)
    else next.add(tagId)
    setChosen(next)
    void window.goonlib.collections
      .setTags(props.collectionId, [...next])
      .then(props.onChanged)
      .catch(() => undefined)
  }

  // Fixed, so the sidebar's narrow scrolling column cannot squeeze or clip it.
  const place = {
    left: Math.min(props.at.x, Math.max(8, window.innerWidth - WIDTH - 8)),
    top: Math.min(props.at.y, Math.max(8, window.innerHeight - HEIGHT - 8)),
  }

  return (
    <div className="ctags" ref={shell} style={place}>
      <div className="ctags__head">
        <span className="settings__label">Tags included in {props.collectionName}</span>
        <button type="button" className="button button--quiet" onClick={props.onClose}>
          Done
        </button>
      </div>

      <span className="settings__hint">All media items with selected tags will be included</span>

      <input
        className="collection__input"
        placeholder="Find a tag"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      <div className="ctags__list">
        {chosen === null ? (
          <span className="settings__hint">Reading…</span>
        ) : shown.length === 0 ? (
          <span className="settings__hint">
            {props.tags.length === 0 ? 'No tags yet.' : 'No tag by that name.'}
          </span>
        ) : (
          shown.map((tag) => (
            <label key={tag.id} className="ctags__row">
              <input type="checkbox" checked={chosen.has(tag.id)} onChange={() => toggle(tag.id)} />
              <span className="ctags__name">{tag.name}</span>
              <span className="collection__count">{formatCount(tag.count)}</span>
            </label>
          ))
        )}
      </div>
    </div>
  )
}
