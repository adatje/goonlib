import { useEffect, useState } from 'react'

/**
 * The controls every Settings page is built from.
 *
 * There were three copies of the switch and two and a half of the slider, one
 * per page, which is how the AI page ended up writing a setting for every pixel
 * of a drag while the toy page deliberately waited for the release. One of each
 * here, so a page cannot disagree with another about how a setting is stored.
 */

export function Switch(props: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  /** Tighter, for a run of switches inside a group that already has a heading. */
  compact?: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className={props.compact ? 'switch switch--compact' : 'switch'}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span className="switch__text">
        <span className="switch__label">{props.label}</span>
        {props.hint ? <span className="switch__hint">{props.hint}</span> : null}
      </span>
    </label>
  )
}

/**
 * A typed number, held to its range when it is committed rather than as it is
 * typed: a half-typed "1" on the way to "12" is never rejected or rounded up.
 * Commits on Enter and on leaving the field.
 */
export function NumberField(props: {
  label: string
  hint?: string
  /** A word after the box: "seconds", "items". */
  suffix?: string
  min: number
  max: number
  value: number
  disabled?: boolean
  onChange: (value: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(props.value))
  useEffect(() => setDraft(String(props.value)), [props.value])

  const commit = (): void => {
    const typed = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(typed)) {
      setDraft(String(props.value))
      return
    }
    const held = Math.min(props.max, Math.max(props.min, Math.round(typed)))
    setDraft(String(held))
    if (held !== props.value) props.onChange(held)
  }

  return (
    <label className="settings__field">
      <span className="settings__label">{props.label}</span>
      <span className="settings__row">
        <input
          type="number"
          className="settings__number"
          min={props.min}
          max={props.max}
          step={1}
          value={draft}
          disabled={props.disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
          }}
        />
        {props.suffix ? <span className="settings__hint">{props.suffix}</span> : null}
      </span>
      {props.hint ? <span className="settings__hint">{props.hint}</span> : null}
    </label>
  )
}

/**
 * A slider that stores on release, not on every pixel of the drag - each change
 * is a settings write in the main process - while still showing the number as
 * it moves.
 */
export function Slider(props: {
  label: string
  hint?: string
  min: number
  max: number
  step: number
  /** The highest it can be set to, when lower than the end of the bar. It stops there while dragging. */
  ceiling?: number
  value: number
  disabled?: boolean
  format: (value: number) => string
  onChange: (value: number) => void
  /**
   * Called with the value while the slider is held, and with null when it is
   * let go, for a setting that can be felt rather than guessed at. The units
   * are the slider's own; whoever passes this converts them.
   */
  preview?: (value: number | null) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<number | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const limit = (value: number): number => Math.min(value, props.ceiling ?? props.max)
  const shown = draft ?? props.value

  const { preview } = props
  const stopPreview = (): void => {
    if (!previewing) return
    setPreviewing(false)
    preview?.(null)
  }

  const commit = (): void => {
    if (draft !== null && draft !== props.value) props.onChange(draft)
    setDraft(null)
    stopPreview()
  }

  // Held as long as the slider is, and said again every second: whoever is
  // playing it drops a preview it stops hearing about, so a window that goes
  // away mid-drag cannot leave anything running.
  useEffect(() => {
    if (!previewing || !preview) return
    const send = (): void => preview(shown)
    send()
    const timer = setInterval(send, 1000)
    return () => clearInterval(timer)
  }, [previewing, shown, preview])

  return (
    <label className="settings__field">
      <span className="settings__row">
        <span className="settings__label">{props.label}</span>
        <span className="settings__value">{props.format(shown)}</span>
      </span>
      <input
        type="range"
        className="settings__range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={shown}
        disabled={props.disabled}
        onChange={(event) => setDraft(limit(Number(event.target.value)))}
        onPointerDown={() => preview && setPreviewing(true)}
        onKeyDown={() => preview && setPreviewing(true)}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        onPointerCancel={commit}
      />
      {props.hint ? <span className="settings__hint">{props.hint}</span> : null}
    </label>
  )
}
