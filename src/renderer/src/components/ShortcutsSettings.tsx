import { useEffect, useState } from 'react'
import { clashesWith, describeBinding, KEY_ACTIONS, bindingFromEvent } from '@shared/keys'
import { accept, useBindings } from '../keys'
import { IS_MAC, withTrashName } from '../platform'

/**
 * Settings → Shortcuts: the same list as the card, with every key changeable.
 *
 * Recording a key takes the next press as it comes, so a shortcut is set by
 * pressing it rather than by writing it out. A key already spoken for in the
 * same place is refused, with the clash named — silently stealing it would
 * leave the other action dead with nothing to say why.
 */
export function ShortcutsSettings(): React.JSX.Element {
  const bindings = useBindings()
  const [recording, setRecording] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!recording) return

    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setRecording(null)
        return
      }

      const pressed = bindingFromEvent(event)
      if (!pressed) return

      const action = KEY_ACTIONS.find((entry) => entry.id === recording)
      if (!action) return

      const clashes = clashesWith(bindings, action.context, pressed, action.id)
      if (clashes.length > 0) {
        const other = KEY_ACTIONS.find((entry) => entry.id === clashes[0])
        setProblem(`${describeBinding(pressed, IS_MAC)} already does “${withTrashName(other?.label ?? clashes[0] ?? "")}”.`)
        setRecording(null)
        return
      }

      setProblem(null)
      setRecording(null)
      void window.goonlib.keys
        .set(action.id, [pressed])
        .then(accept)
        .catch(() => undefined)
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, bindings])

  const groups = [...new Set(KEY_ACTIONS.map((action) => action.group))]

  return (
    <div className="toy__section">
      <div className="settings__row settings__row--tight">
        <button
          type="button"
          className="button button--quiet"
          onClick={() => {
            setProblem(null)
            void window.goonlib.keys.reset().then(accept).catch(() => undefined)
          }}
        >
          Reset every shortcut
        </button>
        {problem ? <span className="settings__bad">{problem}</span> : null}
      </div>

      {groups.map((group) => (
        <section key={group} className="settings__group shortcuts__group">
          <span className="settings__label">{group}</span>
          {KEY_ACTIONS.filter((action) => action.group === group).map((action) => (
            <div key={action.id} className="shortcuts__setting">
              <span className="shortcuts__label">{withTrashName(action.label)}</span>
              <button
                type="button"
                className={recording === action.id ? 'button button--on' : 'button button--quiet'}
                onClick={() => {
                  setProblem(null)
                  setRecording(recording === action.id ? null : action.id)
                }}
                title={recording === action.id ? 'Press the key you want' : 'Click, then press a key'}
              >
                {recording === action.id
                  ? 'Press a key…'
                  : (bindings[action.id] ?? []).length === 0
                    ? 'Unset'
                    : (bindings[action.id] ?? []).map((binding) => describeBinding(binding, IS_MAC)).join('  ')}
              </button>
              <button
                type="button"
                className="styling__reset"
                onClick={() => void window.goonlib.keys.set(action.id, []).then(accept).catch(() => undefined)}
                title="Leave this without a key"
                aria-label={`Clear ${withTrashName(action.label)}`}
              >
                ×
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
