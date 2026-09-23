import { useCallback, useEffect, useState } from 'react'
import type { FolderLocation, FolderNode, Root } from '@shared/types'
import { formatCount } from '../format'

/**
 * Where a top-level folder row starts, chosen so its name lands at the same
 * depth as the items in Collections, Tags and Sources.
 */
const ROW_INDENT = 20

/** Each level deeper steps in by one arrow's width. */
const DEPTH_STEP = 13

export interface FolderTreeProps {
  roots: Root[]
  location: FolderLocation | null
  onSelect: (location: FolderLocation | null) => void
}

/**
 * Expandable folder navigation, one level loaded at a time.
 *
 * Children are fetched only when a node is opened, so a library with thousands of
 * folders costs nothing until you actually go looking. Selecting a folder shows
 * everything beneath it, which is why the counts here are recursive.
 */
export function FolderTree(props: FolderTreeProps): React.JSX.Element {
  const { roots, location, onSelect } = props

  return (
    <div className="tree">
      <button
        type="button"
        className={location === null ? 'tree__row tree__row--on' : 'tree__row'}
        onClick={() => onSelect(null)}
        style={{ paddingLeft: ROW_INDENT }}
      >
        <span className="tree__twist" />
        <span className="tree__label">All folders</span>
      </button>

      {roots.map((root) => (
        <FolderBranch
          key={root.id}
          rootId={root.id}
          name={basename(root.path)}
          path=""
          depth={0}
          enabled={root.enabled}
          location={location}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

interface FolderBranchProps {
  rootId: number
  name: string
  path: string
  depth: number
  enabled: boolean
  count?: number
  hasChildren?: boolean
  location: FolderLocation | null
  onSelect: (location: FolderLocation) => void
}

function FolderBranch(props: FolderBranchProps): React.JSX.Element {
  const { rootId, name, path, depth, enabled, location, onSelect } = props

  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<FolderNode[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isRoot = depth === 0
  const selected = location?.rootId === rootId && location.path === path

  // Fetch children the first time this node is opened, then keep them.
  useEffect(() => {
    if (!open || children !== null || loading) return

    setLoading(true)
    window.goonlib.folders
      .children(rootId, path)
      .then((found) => {
        setChildren(found)
        setError(null)
      })
      .catch((err: unknown) => {
        // Swallowing this as an empty list makes a broken query indistinguishable
        // from a folder that genuinely has no subfolders — which is exactly how a
        // parameter-binding bug looked like correct behaviour.
        setError(err instanceof Error ? err.message : String(err))
        setChildren([])
      })
      .finally(() => setLoading(false))
  }, [open, children, loading, rootId, path])

  const toggle = useCallback((event: React.MouseEvent) => {
    // Expanding shouldn't also navigate — the twisty and the label are separate
    // affordances, as in every file browser.
    event.stopPropagation()
    setOpen((current) => !current)
  }, [])

  // A root always gets a twisty: we don't know if it has subfolders until asked,
  // and querying every root up front defeats the point of lazy loading.
  const expandable = isRoot || props.hasChildren === true

  return (
    <>
      <button
        type="button"
        className={selected ? 'tree__row tree__row--on' : 'tree__row'}
        onClick={() => onSelect({ rootId, path })}
        style={{ paddingLeft: ROW_INDENT + depth * DEPTH_STEP }}
        title={path || name}
        data-disabled={!enabled}
      >
        <span
          className={expandable ? 'tree__twist tree__twist--able' : 'tree__twist'}
          onClick={expandable ? toggle : undefined}
          role={expandable ? 'button' : undefined}
          aria-label={expandable ? (open ? `Collapse ${name}` : `Expand ${name}`) : undefined}
        >
          {expandable ? <Chevron open={open} /> : null}
        </span>

        <span className="tree__label">{name}</span>

        {props.count !== undefined ? (
          <span className="tree__count">{formatCount(props.count)}</span>
        ) : null}
      </button>

      {open && children
        ? children.map((child) => (
            <FolderBranch
              key={child.path}
              rootId={rootId}
              name={child.name}
              path={child.path}
              depth={depth + 1}
              enabled={enabled}
              count={child.count}
              hasChildren={child.hasChildren}
              location={location}
              onSelect={onSelect}
            />
          ))
        : null}

      {open && loading ? (
        <div className="tree__loading" style={{ paddingLeft: ROW_INDENT + (depth + 1) * DEPTH_STEP }}>
          Loading…
        </div>
      ) : null}

      {open && error ? (
        <div className="tree__error" style={{ paddingLeft: ROW_INDENT + (depth + 1) * DEPTH_STEP }} role="alert">
          {error}
        </div>
      ) : null}

      {open && !error && children?.length === 0 && !loading ? (
        <div className="tree__loading" style={{ paddingLeft: ROW_INDENT + (depth + 1) * DEPTH_STEP }}>
          No subfolders
        </div>
      ) : null}
    </>
  )
}

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/**
 * A drawn chevron rather than a ▸ character: at the size a text triangle fits
 * in this column it read as a dot, not as something to click. Points right
 * when closed and turns down when open.
 */
function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 10 10"
      width="10"
      height="10"
      aria-hidden="true"
      focusable="false"
      className={open ? 'tree__chevron tree__chevron--open' : 'tree__chevron'}
    >
      <path
        d="M3.5 1.8 6.8 5 3.5 8.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
