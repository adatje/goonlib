import type { FolderLocation, Root } from '@shared/types'

export interface BreadcrumbProps {
  location: FolderLocation | null
  roots: Root[]
  onNavigate: (location: FolderLocation | null) => void
}

/**
 * Where you are, and a way back up.
 *
 * The tree is for jumping to a known place; this is for knowing where the current
 * results came from, which a scrolled or collapsed tree can't tell you.
 */
export function Breadcrumb(props: BreadcrumbProps): React.JSX.Element | null {
  const { location, roots, onNavigate } = props

  if (!location) return null

  const root = roots.find((candidate) => candidate.id === location.rootId)
  if (!root) return null

  const segments = location.path.split('/').filter(Boolean)

  return (
    <nav className="crumbs" aria-label="Folder path">
      <button type="button" className="crumbs__item" onClick={() => onNavigate(null)}>
        All folders
      </button>

      <span className="crumbs__sep">/</span>

      <button
        type="button"
        className={segments.length === 0 ? 'crumbs__item crumbs__item--on' : 'crumbs__item'}
        onClick={() => onNavigate({ rootId: root.id, path: '' })}
        title={root.path}
      >
        {basename(root.path)}
      </button>

      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1
        // Rebuild the prefix up to and including this segment.
        const path = `${segments.slice(0, index + 1).join('/')}/`

        return (
          <span key={path} className="crumbs__group">
            <span className="crumbs__sep">/</span>
            <button
              type="button"
              className={isLast ? 'crumbs__item crumbs__item--on' : 'crumbs__item'}
              onClick={() => onNavigate({ rootId: root.id, path })}
            >
              {segment}
            </button>
          </span>
        )
      })}
    </nav>
  )
}

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}
