import { useEffect } from 'react'
import type { CoWatchView } from '../state/useCoWatch'
import { CoWatchSection, SessionName } from './CoWatchPanel'
import { GearIcon } from './Toolbar'

/**
 * Starting and managing a session, as a card.
 *
 * The same panel that lives on the Watch Together tab of Settings, reachable
 * from the sidebar without going through Settings at all. Sharing your library
 * is not a setting - it is something you start, watch and stop, often in the
 * middle of doing something else - and burying the stop button two clicks deep
 * under a gear was the wrong shape for it.
 *
 * What stays behind in Settings is what really is configuration: the toy's
 * guest permissions, and whether a session starts where you left off.
 */
export function CoWatchCard({
  cowatch,
  onOpenSettings,
  onClose,
}: {
  cowatch: CoWatchView
  /** Opens the Watch Together tab, for the settings this card does not carry. */
  onOpenSettings: () => void
  onClose: () => void
}): React.JSX.Element {
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])

  return (
    <div
      className="prompt"
      role="dialog"
      aria-modal="true"
      aria-label="Watch Together"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="settings cowatchcard">
        <header className="settings__head">
          <h2 className="settings__title">Watch Together</h2>
          <button type="button" className="lightbox__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="settings__body">
          <div className="settings__group">
            <SessionName />
          </div>

          <div className="settings__group">
            <CoWatchSection cowatch={cowatch} />
          </div>

          {/* A gear in the corner, like the one in the sidebar that opens the
              same sheet. The card is about running a session; the settings
              behind it are a side door, and a full-width button gave them the
              same weight as starting one. */}
          <div className="cowatchcard__foot">
            <button
              type="button"
              className="icon-button"
              onClick={onOpenSettings}
              title="Guest permissions and other Watch Together settings"
            >
              <GearIcon />
              <span className="visually-hidden">Watch Together settings</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
