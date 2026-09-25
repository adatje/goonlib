import { useEffect, useState } from 'react'
import type { FolderLocation, FolderNode, Root } from '@shared/types'

export /**
 * The sources' folders, one level at a time, as a destination list.
 *
 * The folder being emptied is not offered, and neither is anything inside it -
 * moving a folder's contents into itself is the one answer that cannot mean
 * anything.
 */
function FolderPicker(props: {
  roots: Root[]
  exclude: { rootId: number; path: string }
  onPick: (target: FolderLocation) => void
}): React.JSX.Element {
  return (
    <div className="foldermenu__picker">
      {props.roots.map((root) => (
        <PickerNode
          key={root.id}
          rootId={root.id}
          name={root.path.split('/').filter(Boolean).pop() ?? root.path}
          path=""
          depth={0}
          exclude={props.exclude}
          onPick={props.onPick}
        />
      ))}
    </div>
  )
}

function PickerNode(props: {
  rootId: number
  name: string
  path: string
  depth: number
  exclude: { rootId: number; path: string }
  onPick: (target: FolderLocation) => void
}): React.JSX.Element | null {
  const { rootId, path, depth, exclude, onPick } = props
  const [open, setOpen] = useState(depth === 0)
  const [children, setChildren] = useState<FolderNode[] | null>(null)

  useEffect(() => {
    if (!open || children) return
    void window.goonlib.folders
      .children(rootId, path)
      .then(setChildren)
      .catch(() => setChildren([]))
  }, [open, children, rootId, path])

  // The folder being emptied, and everything under it, cannot be the target.
  const inside = rootId === exclude.rootId && exclude.path !== '' && path.startsWith(exclude.path)
  if (inside) return null

  return (
    <>
      <div className="foldermenu__row" style={{ paddingLeft: 6 + depth * 12 }}>
        <button
          type="button"
          className="foldermenu__twist"
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={() => setOpen((was) => !was)}
        >
          {open ? '⌄' : '›'}
        </button>
        <button
          type="button"
          className="foldermenu__target"
          onClick={() => onPick({ rootId, path })}
        >
          {props.name}
        </button>
      </div>

      {open && children
        ? children.map((child) => (
            <PickerNode
              key={child.path}
              rootId={rootId}
              name={child.name}
              path={child.path}
              depth={depth + 1}
              exclude={exclude}
              onPick={onPick}
            />
          ))
        : null}
    </>
  )
}
