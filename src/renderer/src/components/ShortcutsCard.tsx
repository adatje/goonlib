import { useEffect } from 'react'
import { describeBinding, KEY_ACTIONS } from '@shared/keys'
import { useBindings } from '../keys'
import { IS_MAC, withTrashName } from '../platform'

/**
 * Every shortcut, as a card. Read-only on purpose: this is what you open
 * mid-task to remember a key, and changing them belongs on its own page in
 * Settings, where there is room to say what clashes with what.
 */
export function ShortcutsCard({ onClose }: { onClose: () => void }): React.JSX.Element {
  const bindings = useBindings()

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])

  const groups = [...new Set(KEY_ACTIONS.map((action) => action.group))]

  return (
    <div
      className="prompt"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="settings shortcuts">
        <header className="settings__head">
          <h2 className="settings__title">Keyboard shortcuts</h2>
          <button type="button" className="lightbox__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="settings__body shortcuts__body">
          {groups.map((group) => (
            <section key={group} className="shortcuts__group">
              <h3 className="mediainfo__title">{group}</h3>
              <dl className="shortcuts__list">
                {KEY_ACTIONS.filter((action) => action.group === group).map((action) => (
                  <div key={action.id} className="shortcuts__row">
                    <dt>{withTrashName(action.label)}</dt>
                    <dd>
                      {(bindings[action.id] ?? []).length === 0 ? (
                        <span className="muted">unset</span>
                      ) : (
                        (bindings[action.id] ?? []).map((binding) => (
                          <kbd key={binding} className="shortcuts__key">
                            {describeBinding(binding, IS_MAC)}
                          </kbd>
                        ))
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
