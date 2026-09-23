import { useCallback, useEffect, useRef, useState } from 'react'
import { formatCount } from '../format'

/** Which entries a section lists: everything, only yours, or only the classifier's. */
export type SectionFilter = 'all' | 'mine' | 'ai'

const FILTERS: Array<{ id: SectionFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Yours' },
  { id: 'ai', label: 'AI' },
]

export interface SidebarSectionProps {
  title: string
  /** Stable key the collapsed state is remembered under. */
  id: string
  /** Shown beside the title, so a collapsed section still says how much it hides. */
  count?: number
  /** Shown before the title, like the icons on Library and Favorites. */
  icon?: React.ReactNode
  /** Something inside is selected, so the icon shows filled like a selected entry's. */
  active?: boolean
  /**
   * Offers All / Yours / AI on a right-click of the heading, for a list the
   * classifier also fills. Left out, the heading has no menu.
   */
  filter?: { value: SectionFilter; onChange: (next: SectionFilter) => void }
  children: React.ReactNode
}

const STORAGE_PREFIX = 'goonlib.sidebar.'

/**
 * A sidebar section with a disclosure header.
 *
 * The collapsed state lives in localStorage rather than the settings table: it
 * is per-window view state, not a library preference, and round-tripping it
 * through IPC would make the header lag the click.
 */
export function SidebarSection(props: SidebarSectionProps): React.JSX.Element {
  const [collapsed, toggle] = useCollapsed(props.id)
  const [menu, setMenu] = useState(false)
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  // Closes on a click anywhere else, or on Escape.
  useEffect(() => {
    if (!menu) return
    const outside = (event: MouseEvent): void => {
      if (!headingRef.current?.contains(event.target as Node)) setMenu(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(false)
    }
    document.addEventListener('mousedown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [menu])

  const filter = props.filter

  return (
    <div className={props.active ? 'sidebar__section sidebar__section--active' : 'sidebar__section'}>
      <h2 className="sidebar__heading addto" ref={headingRef}>
        <button
          type="button"
          className="sidebar__disclosure"
          onClick={toggle}
          onContextMenu={(event) => {
            if (!filter) return
            event.preventDefault()
            setMenu((open) => !open)
          }}
          aria-expanded={!collapsed}
          aria-haspopup={filter ? 'menu' : undefined}
          title={filter ? `${props.title} - right-click to show all, yours, or the AI's` : undefined}
        >
          {props.icon ? <span className="sidebar__icon">{props.icon}</span> : null}
          <span className="sidebar__title">{props.title}</span>
          {filter && filter.value !== 'all' ? (
            <span className="sidebar__filter">{filter.value === 'ai' ? 'ai' : 'yours'}</span>
          ) : null}
          {props.count !== undefined && (collapsed || props.count > 0) ? (
            <span className="sidebar__tally">{formatCount(props.count)}</span>
          ) : null}
        </button>

        {filter && menu ? (
          <div className="addto__menu addto__menu--narrow" role="menu" aria-label={`${props.title} to show`}>
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                className="addto__item"
                role="menuitemradio"
                aria-checked={filter.value === option.id}
                onClick={() => {
                  setMenu(false)
                  filter.onChange(option.id)
                }}
              >
                <span className="addto__check" aria-hidden="true">
                  {filter.value === option.id ? '✓' : ''}
                </span>
                <span className="addto__name">{option.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </h2>

      {collapsed ? null : props.children}
    </div>
  )
}

/**
 * Remembers whether one section is collapsed.
 *
 * Every storage call is guarded — a renderer with storage blocked or full should
 * lose the preference, not the sidebar.
 */
function useCollapsed(id: string): [boolean, () => void] {
  const key = `${STORAGE_PREFIX}${id}`

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(key, next ? '1' : '0')
      } catch {
        // Not worth surfacing; the section still collapses for this session.
      }
      return next
    })
  }, [key])

  return [collapsed, toggle]
}

/**
 * Which entries a section is showing, remembered per section like its
 * collapsed state — a view choice, not a library preference.
 */
export function useSectionFilter(id: string): [SectionFilter, (next: SectionFilter) => void] {
  const key = `${STORAGE_PREFIX}filter.${id}`

  const [filter, setFilter] = useState<SectionFilter>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === 'mine' || stored === 'ai' ? stored : 'all'
    } catch {
      return 'all'
    }
  })

  const choose = useCallback(
    (next: SectionFilter) => {
      setFilter(next)
      try {
        localStorage.setItem(key, next)
      } catch {
        // Only a convenience; the section simply forgets next time.
      }
    },
    [key],
  )

  return [filter, choose]
}

/** Whether one entry belongs in a section showing `filter`. */
export function matchesFilter(filter: SectionFilter, entry: { count: number; aiCount: number }): boolean {
  // Only an entry the classifier filled entirely counts as the AI's; anything
  // you have touched yourself is yours.
  const fromAi = entry.count > 0 && entry.aiCount === entry.count
  if (filter === 'ai') return fromAi
  if (filter === 'mine') return !fromAi
  return true
}
