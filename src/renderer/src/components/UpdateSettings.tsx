import { useEffect, useState } from 'react'
import type { PlaybackPrefs, UpdateState } from '@shared/types'
import { Switch } from './SettingsControls'

/**
 * Settings → App → Updates: what is running, what is out, and one button that
 * means the right thing at each step.
 *
 * The button is deliberately singular. An updater that offers Check, Download
 * and Restart at once asks the reader to work out which applies; there is only
 * ever one sensible next move, so only that one is shown.
 */
export function UpdateSettings(props: {
  playback: PlaybackPrefs
  onPlaybackChange: (patch: Partial<PlaybackPrefs>) => void
}): React.JSX.Element {
  const [state, setState] = useState<UpdateState>({ kind: 'idle', version: '' })

  useEffect(() => {
    void window.goonlib.updates.status().then(setState).catch(() => undefined)
    return window.goonlib.updates.onUpdate(setState)
  }, [])

  return (
    <div className="settings__section">
      <span className="settings__label">Updates</span>

      <Switch
        label="Check for updates"
        hint="Looks for a newer version shortly after the app opens. It never downloads one without asking."
        checked={props.playback.autoUpdate}
        onChange={(autoUpdate) => props.onPlaybackChange({ autoUpdate })}
      />

      {/* Nothing to say from source: there is no button, and the version is
          already in the sheet's footer. */}
      {state.kind === 'unsupported' ? null : (
        <div className="settings__row settings__row--tight">
          <Action state={state} />
          <span
            className="settings__hint settings__hint--clamp"
            title={state.kind === 'error' ? (state.message ?? '') : undefined}
          >
            {describe(state)}
          </span>
        </div>
      )}
    </div>
  )
}

function Action({ state }: { state: UpdateState }): React.JSX.Element | null {
  switch (state.kind) {
    case 'checking':
    case 'downloading':
      return (
        <button type="button" className="button button--quiet" disabled>
          Working…
        </button>
      )
    case 'available':
      return (
        <button
          type="button"
          className="button"
          onClick={() => void window.goonlib.updates.download().catch(() => undefined)}
        >
          Download {state.newVersion}
        </button>
      )
    case 'manual':
      return (
        <button
          type="button"
          className="button"
          onClick={() => void window.goonlib.updates.download().catch(() => undefined)}
        >
          Open the release
        </button>
      )
    case 'ready':
      return (
        <button type="button" className="button button--primary" onClick={() => window.goonlib.updates.install()}>
          Restart to update
        </button>
      )
    default:
      return (
        <button
          type="button"
          className="button button--quiet"
          onClick={() => void window.goonlib.updates.check().catch(() => undefined)}
        >
          Check now
        </button>
      )
  }
}

/**
 * An updater failure in words someone can act on.
 *
 * The two that actually happen get a sentence of their own; anything else
 * falls through to what the updater said, which the main process has already
 * cut down to one line. The full text is on the hint's tooltip either way.
 */
function failure(message: string | undefined): string {
  const text = message ?? ''
  if (/unable to find latest version|cannot parse releases feed|no published versions/i.test(text)) {
    return 'There is nothing published to update to yet.'
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network|socket/i.test(text)) {
    return 'Could not reach GitHub. Check your connection and try again.'
  }
  return text || 'That did not work.'
}

function describe(state: UpdateState): string {
  switch (state.kind) {
    case 'checking':
      return 'Looking…'
    case 'none':
      return `${state.version} is the newest there is.`
    case 'available':
      return `${state.newVersion} is out. You are on ${state.version}.`
    case 'downloading':
      return `Fetching… ${state.percent ?? 0}%`
    case 'ready':
      return `${state.newVersion} is ready and installs when you restart.`
    case 'manual':
      // macOS will not replace an app it has not signed, so this build can find
      // an update but not become one.
      return `${state.newVersion} is out, but this build cannot install it itself - macOS only replaces signed apps.`
    case 'error':
      return failure(state.message)
    default:
      return ''
  }
}
