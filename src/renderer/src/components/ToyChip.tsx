import { useEffect, useRef, useState } from 'react'
import { customPatternId, TOY_PATTERNS } from '@shared/toy'
import type { PatternId } from '@shared/toy'
import type { ToyView } from '../state/useToy'
import { describeScript, patternLabel } from './ToySections'

/**
 * The toy, wherever you are: what is driving it, a click to stop or resume,
 * and a menu of patterns to start one without opening Settings.
 *
 * A pattern started here waits while a video with a script or a sound curve
 * is playing, and takes over again the moment it stops — so picking one is
 * always safe, whatever is on screen.
 */
export function ToyChip({ toy }: { toy: ToyView }): React.JSX.Element {
  const { status } = toy
  const running = status.manual
  const source = describeScript(status.script) ?? 'Toy connected'

  const [open, setOpen] = useState(false)
  const shellRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent): void => {
      if (!shellRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Closes the menu without also closing the viewer underneath it.
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    window.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', escape, true)
    }
  }, [open])

  const run = (pattern: PatternId): void => {
    setOpen(false)
    // Patterns run at full strength; Intensity scales them with everything else.
    toy.manual(running?.pattern === pattern ? null : { pattern, intensity: 1 })
  }

  return (
    <div className="addto toychip__shell" ref={shellRef}>
      <button
        type="button"
        className={status.armed ? 'addto__trigger toychip' : 'addto__trigger toychip toychip--stopped'}
        onClick={status.armed ? toy.stop : toy.resume}
        title={status.armed ? `${source} - click or press X to stop` : 'Stopped - click to resume'}
      >
        <span className="toychip__meter" aria-hidden="true">
          <span className="toychip__fill" style={{ height: `${status.level * 100}%` }} />
        </span>
        {status.armed ? 'Stop toy' : 'Toy stopped'}
      </button>

      <button
        type="button"
        className={running ? 'addto__trigger toychip__more toychip__more--on' : 'addto__trigger toychip__more'}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={running ? `${patternLabel(status, running.pattern)} - pick another, or stop it` : 'Run a pattern'}
      >
        <span aria-hidden="true">▾</span>
        <span className="visually-hidden">Patterns</span>
      </button>

      {/* The menu hangs from the chip's left edge, like the sort menu beside it. */}
      {open ? (
        <div className="addto__menu addto__menu--narrow" role="menu" aria-label="Pattern">
          {TOY_PATTERNS.map((pattern) => (
            <PatternRow
              key={pattern.id}
              glyph={pattern.glyph}
              label={pattern.label}
              on={running?.pattern === pattern.id}
              disabled={!status.armed}
              onPick={() => run(pattern.id)}
            />
          ))}
          {status.patterns.map((pattern) => (
            <PatternRow
              key={pattern.id}
              glyph="✎"
              label={pattern.name}
              on={running?.pattern === customPatternId(pattern.id)}
              disabled={!status.armed}
              onPick={() => run(customPatternId(pattern.id))}
            />
          ))}
          {running ? (
            <button
              type="button"
              className="addto__item"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                toy.manual(null)
              }}
            >
              <span className="toychip__glyph" aria-hidden="true">
                ×
              </span>
              <span className="addto__name">Stop pattern</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function PatternRow(props: {
  /** The pattern's mark, which stands in for a tick as well. */
  glyph: string
  label: string
  on: boolean
  disabled: boolean
  onPick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="addto__item"
      role="menuitemradio"
      aria-checked={props.on}
      disabled={props.disabled}
      onClick={props.onPick}
    >
      {/* The pattern's own mark is the tick: it turns pink while it runs,
          rather than a second column lighting up beside it. */}
      <span className="toychip__glyph" aria-hidden="true">
        {props.glyph}
      </span>
      <span className="addto__name">{props.label}</span>
    </button>
  )
}
