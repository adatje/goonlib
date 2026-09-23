import { useCallback, useEffect, useRef, useState } from 'react'

export interface NamePromptProps {
  title: string
  placeholder?: string
  confirmLabel?: string
  onConfirm: (name: string) => void
  onCancel: () => void
}

/**
 * A small modal for the one thing a native menu can't do: ask for text.
 *
 * Used by the context menu's "New Collection…", which has to hand control back to
 * the renderer because Electron menus have no text-input item.
 */
export function NamePrompt(props: NamePromptProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const confirm = useCallback(() => {
    const name = value.trim()
    if (name) props.onConfirm(name)
  }, [value, props])

  return (
    <div
      className="prompt"
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      // Clicking the backdrop cancels, matching every other dialog on the system.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onCancel()
      }}
    >
      <div className="prompt__box">
        <h2 className="prompt__title">{props.title}</h2>

        <input
          ref={inputRef}
          className="prompt__input"
          placeholder={props.placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // The lightbox listens for keys at the window; without this its
            // shortcuts would fire while a name is being typed.
            event.stopPropagation()
            if (event.key === 'Enter') confirm()
            if (event.key === 'Escape') props.onCancel()
          }}
        />

        <div className="prompt__actions">
          <button type="button" className="button button--quiet" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="button"
            onClick={confirm}
            disabled={value.trim().length === 0}
          >
            {props.confirmLabel ?? 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
