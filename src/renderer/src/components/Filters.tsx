import { useEffect, useRef, useState } from 'react'
import { DURATION_BANDS, SIZE_BANDS } from '@shared/types'
import type { DurationBand, SizeBand, Tag } from '@shared/types'

/** What the Filters panel narrows by. Empty everywhere means no narrowing at all. */
export interface FilterSet {
  tagIds: number[]
  exts: string[]
  durations: DurationBand[]
  sizes: SizeBand[]
}

export const NO_FILTERS: FilterSet = { tagIds: [], exts: [], durations: [], sizes: [] }

/** How many things are being narrowed by, for the toolbar's count. */
export function countFilters(filters: FilterSet): number {
  return filters.tagIds.length + filters.exts.length + filters.durations.length + filters.sizes.length
}

/**
 * The Filters button and its panel.
 *
 * Bands rather than numbers to type: "short" and "large" are what people
 * actually want, and a pair of boxes asking for milliseconds is a worse way to
 * ask. Tags come with a search box, since a classified library has hundreds.
 * Everything applies as it is clicked, like the search box does.
 */
export function Filters(props: {
  filters: FilterSet
  onChange: (filters: FilterSet) => void
  tags: Tag[]
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [exts, setExts] = useState<Array<{ ext: string; count: number }>>([])
  const shellRef = useRef<HTMLDivElement | null>(null)
  const count = countFilters(props.filters)

  useEffect(() => {
    if (!open) return
    void window.goonlib.library
      .extensions()
      .then(setExts)
      .catch(() => setExts([]))

    const outside = (event: MouseEvent): void => {
      if (!shellRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    window.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', escape, true)
    }
  }, [open])

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]

  const matching = props.tags.filter((tag) =>
    search.trim() === '' ? true : tag.name.toLowerCase().includes(search.trim().toLowerCase()),
  )
  // Chosen tags stay in view even when the search would hide them.
  const shownTags = [
    ...matching.filter((tag) => props.filters.tagIds.includes(tag.id)),
    ...matching.filter((tag) => !props.filters.tagIds.includes(tag.id)),
  ].slice(0, 60)

  return (
    <div className="addto" ref={shellRef}>
      <button
        type="button"
        className={count > 0 ? 'toolbar__sort toolbar__sort--on' : 'toolbar__sort'}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={count > 0 ? `Filtering by ${count}` : 'Narrow what the grid shows'}
      >
        Filters
        {count > 0 ? <span className="toolbar__filter-count">{count}</span> : null}
        <span className="toolbar__sort-chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className="addto__menu filters" role="dialog" aria-label="Filters">
          <Band
            title="Length"
            options={(['short', 'medium', 'long'] as const).map((band) => ({
              id: band,
              label: DURATION_BANDS[band].label,
            }))}
            chosen={props.filters.durations}
            onPick={(band) => props.onChange({ ...props.filters, durations: toggle(props.filters.durations, band) })}
          />

          <Band
            title="Size"
            options={(['small', 'medium', 'large'] as const).map((band) => ({
              id: band,
              label: SIZE_BANDS[band].label,
            }))}
            chosen={props.filters.sizes}
            onPick={(band) => props.onChange({ ...props.filters, sizes: toggle(props.filters.sizes, band) })}
          />

          {exts.length > 0 ? (
            <Band
              title="File type"
              options={exts.slice(0, 14).map((entry) => ({
                id: entry.ext,
                label: entry.ext.replace(/^\./, '').toUpperCase(),
              }))}
              chosen={props.filters.exts}
              onPick={(ext) => props.onChange({ ...props.filters, exts: toggle(props.filters.exts, ext) })}
            />
          ) : null}

          <div className="filters__group">
            <span className="filters__title">Tags</span>
            <input
              className="settings__input filters__search"
              value={search}
              placeholder="Search tags"
              aria-label="Search tags"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <div className="filters__chips filters__chips--tall">
              {shownTags.length === 0 ? (
                <span className="settings__hint">No tags match.</span>
              ) : (
                shownTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className={
                      props.filters.tagIds.includes(tag.id)
                        ? 'cowatch__provider cowatch__provider--on'
                        : 'cowatch__provider'
                    }
                    aria-pressed={props.filters.tagIds.includes(tag.id)}
                    onClick={() =>
                      props.onChange({ ...props.filters, tagIds: toggle(props.filters.tagIds, tag.id) })
                    }
                  >
                    {tag.name}
                  </button>
                ))
              )}
            </div>
            <span className="settings__hint">Two tags means the things carrying both.</span>
          </div>

          {count > 0 ? (
            <button type="button" className="button button--quiet" onClick={() => props.onChange(NO_FILTERS)}>
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Band<T extends string>(props: {
  title: string
  options: Array<{ id: T; label: string }>
  chosen: T[]
  onPick: (id: T) => void
}): React.JSX.Element {
  return (
    <div className="filters__group">
      <span className="filters__title">{props.title}</span>
      <div className="filters__chips">
        {props.options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={
              props.chosen.includes(option.id)
                ? 'cowatch__provider cowatch__provider--on'
                : 'cowatch__provider'
            }
            aria-pressed={props.chosen.includes(option.id)}
            onClick={() => props.onPick(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
