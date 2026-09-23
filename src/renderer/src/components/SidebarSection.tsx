import { useCallback, useState } from 'react'
import { formatCount } from '../format'

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

  return (
    <div className={props.active ? 'sidebar__section sidebar__section--active' : 'sidebar__section'}>
      <h2 className="sidebar__heading">
        <button
          type="button"
          className="sidebar__disclosure"
          onClick={toggle}
          aria-expanded={!collapsed}
        >
          {props.icon ? <span className="sidebar__icon">{props.icon}</span> : null}
          <span className="sidebar__title">{props.title}</span>
          {props.count !== undefined && (collapsed || props.count > 0) ? (
            <span className="sidebar__tally">{formatCount(props.count)}</span>
          ) : null}
        </button>
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
