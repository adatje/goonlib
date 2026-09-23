import { useEffect, useState } from 'react'
import { IMAGE_SECONDS } from '@shared/types'
import type { PlaybackPrefs } from '@shared/types'

/**
 * Settings → App: how the app itself behaves, starting with the media player.
 * Every control writes through as it changes, like the rest of Settings.
 */
export function AppSettings(props: {
  playback: PlaybackPrefs
  onPlaybackChange: (patch: Partial<PlaybackPrefs>) => void
}): React.JSX.Element {
  const { playback } = props

  return (
    <div className="toy__section">
      <span className="settings__label">Media Player</span>

      <ImageSeconds
        value={playback.imageSeconds}
        onChange={(imageSeconds) => props.onPlaybackChange({ imageSeconds })}
      />

      <Toggle
        label="Play on open"
        hint="Toggles whether to play videos on open by default."
        checked={playback.playOnOpen}
        onChange={(playOnOpen) => props.onPlaybackChange({ playOnOpen })}
      />

      <Toggle
        label="Shuffle as default"
        hint="Globally enables shuffle=true as default when playing any media items."
        checked={playback.shuffleDefault}
        onChange={(shuffleDefault) => props.onPlaybackChange({ shuffleDefault })}
      />

      <Toggle
        label="Show Meta data"
        hint="Shows the open item's details beside it in the media player: file, size, dates, and how often and how long it has been watched."
        checked={playback.showMetadata}
        onChange={(showMetadata) => props.onPlaybackChange({ showMetadata })}
      />

      <Toggle
        label="Show EXIF data"
        hint="Shows a photo's EXIF data, if it has any: camera, lens, settings and the date it was taken."
        checked={playback.showExif}
        onChange={(showExif) => props.onPlaybackChange({ showExif })}
      />

      <Toggle
        label="Include Location"
        hint="Whether to also include location information in shown EXIF data"
        checked={playback.showLocation}
        disabled={!playback.showExif}
        onChange={(showLocation) => props.onPlaybackChange({ showLocation })}
      />
    </div>
  )
}

function Toggle(props: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span className="switch__text">
        <span className="switch__label">{props.label}</span>
        <span className="switch__hint">{props.hint}</span>
      </span>
    </label>
  )
}

/**
 * Seconds as typed, kept to whole numbers between the limits. Typing is free —
 * a half-typed "1" on the way to "12" is never rejected — and the value is
 * held to the range when it is committed, on Enter or leaving the field.
 */
function ImageSeconds(props: { value: number; onChange: (seconds: number) => void }): React.JSX.Element {
  const [draft, setDraft] = useState(String(props.value))
  useEffect(() => setDraft(String(props.value)), [props.value])

  const commit = (): void => {
    const typed = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(typed)) {
      setDraft(String(props.value))
      return
    }
    const seconds = Math.min(IMAGE_SECONDS.max, Math.max(IMAGE_SECONDS.min, Math.round(typed)))
    setDraft(String(seconds))
    if (seconds !== props.value) props.onChange(seconds)
  }

  return (
    <label className="settings__field">
      <span className="settings__label">Image autoplay timer</span>
      <span className="settings__row">
        <input
          type="number"
          className="settings__number"
          min={IMAGE_SECONDS.min}
          max={IMAGE_SECONDS.max}
          step={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
          }}
          aria-describedby="image-seconds-hint"
        />
        <span className="settings__hint">seconds</span>
      </span>
      <span className="settings__hint" id="image-seconds-hint">
        Required for auto-playing images. Sets the time until next image is displayed when autoplay is
        enabled
      </span>
    </label>
  )
}
