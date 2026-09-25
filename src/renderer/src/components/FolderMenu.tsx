import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderPicker } from './FolderPicker'
import type { FolderActionResult, Root } from '@shared/types'

/** Where a folder menu was asked for, and for which folder. */
export interface FolderMenuAt {
  rootId: number
  path: string
  name: string
  x: number
  y: number
}

/**
 * The right-click menu on a folder: make one inside it, empty it into another,
 * or send it to the Trash.
 *
 * Drawn by the app rather than the system, in the app's own colours, like the
 * media menu it stands beside. Picking a destination walks the sources' own
 * folder tree rather than opening a file browser: the point is sorting what is
 * already in the library, so anywhere else is not a useful answer.
 */
export function FolderMenu(props: {
  at: FolderMenuAt
  roots: Root[]
  onClose: () => void
  /** Fired after anything that changed the folders, so the tree and grid re-read. */
  onChanged: () => void
  onMessage: (text: string) => void
}): React.JSX.Element {
  const { at, onClose, onChanged, onMessage } = props
  const [mode, setMode] = useState<'menu' | 'new' | 'move' | 'confirm'>('menu')
  const [name, setName] = useState('')
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const away = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    // A frame later, or the click that opened this would close it again.
    const timer = setTimeout(() => document.addEventListener('mousedown', away), 0)
    document.addEventListener('keydown', escape)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [onClose])

  const run = useCallback(
    async (work: () => Promise<FolderActionResult>) => {
      setBusy(true)
      try {
        const result = await work()
        if (result.message) onMessage(result.message)
        if (result.ok) onChanged()
      } catch (err) {
        onMessage(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
        onClose()
      }
    },
    [onChanged, onClose, onMessage],
  )

  const isRoot = at.path === ''

  return (
    <div
      ref={ref}
      className="mediamenu"
      role="menu"
      style={{ left: at.x, top: at.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {mode === 'menu' ? (
        <>
          <span className="mediamenu__head">{at.name}</span>
          <div className="mediamenu__rule" role="separator" />

          <button type="button" className="mediamenu__item" role="menuitem" onClick={() => setMode('new')}>
            New folder…
          </button>
          <button type="button" className="mediamenu__item" role="menuitem" onClick={() => setMode('move')}>
            Move contents to…
          </button>

          <div className="mediamenu__rule" role="separator" />
          <button
            type="button"
            className="mediamenu__item mediamenu__item--danger"
            role="menuitem"
            onClick={() => {
              setMode('confirm')
              void window.goonlib.folders
                .count(at.rootId, at.path)
                .then(setCount)
                .catch(() => setCount(0))
            }}
          >
            {isRoot ? 'Delete source folder' : 'Delete folder'}
          </button>
        </>
      ) : null}

      {mode === 'new' ? (
        <form
          className="mediamenu__form"
          onSubmit={(event) => {
            event.preventDefault()
            void run(() => window.goonlib.folders.create(at.rootId, at.path, name))
          }}
        >
          <span className="mediamenu__head">New folder in {at.name}</span>
          <input
            className="collection__input"
            value={name}
            autoFocus
            placeholder="Name"
            onChange={(event) => setName(event.target.value)}
          />
          <div className="settings__row settings__row--tight">
            <button type="submit" className="button button--primary" disabled={busy || !name.trim()}>
              Create
            </button>
            <button type="button" className="button button--quiet" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {mode === 'move' ? (
        <>
          <span className="mediamenu__head">Move everything in {at.name} to</span>
          <div className="mediamenu__rule" role="separator" />
          <FolderPicker
            roots={props.roots}
            exclude={{ rootId: at.rootId, path: at.path }}
            onPick={(target) =>
              void run(() =>
                window.goonlib.folders.moveContents(at.rootId, at.path, target.rootId, target.path),
              )
            }
          />
        </>
      ) : null}

      {mode === 'confirm' ? (
        <div className="mediamenu__form">
          <span className="mediamenu__head">
            {count === null
              ? 'Counting…'
              : count === 0
                ? `${at.name} is empty.`
                : `${at.name} holds ${count} ${count === 1 ? 'item' : 'items'}.`}
          </span>
          <span className="settings__hint">
            {isRoot
              ? 'The folder goes to the Trash and the source is removed from the library. This one cannot be undone from here - the folder is in the Trash if you need it back.'
              : 'The folder and everything under it go to the Trash. Ctrl+Z puts it back.'}
          </span>
          <div className="settings__row settings__row--tight">
            <button
              type="button"
              className="button button--danger"
              disabled={busy || count === null}
              onClick={() => void run(() => window.goonlib.folders.remove(at.rootId, at.path))}
            >
              Move to Trash
            </button>
            <button type="button" className="button button--quiet" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
