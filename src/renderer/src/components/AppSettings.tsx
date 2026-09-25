import { useEffect, useState } from 'react'
import { CONTINUE_COUNT, IMAGE_SECONDS, RESUME_AFTER } from '@shared/types'
import type { PlaybackPrefs } from '@shared/types'
import { NumberField, Slider, Switch } from './SettingsControls'
import { UpdateSettings } from './UpdateSettings'

/**
 * Settings → App: how the app itself behaves, starting with the media player.
 * Every control writes through as it changes, like the rest of Settings.
 */
export function AppSettings(props: {
  playback: PlaybackPrefs
  onPlaybackChange: (patch: Partial<PlaybackPrefs>) => void
  /** Fired after the history is cleared, so the library drops what it showed. */
  onChanged: () => void
}): React.JSX.Element {
  const { playback } = props

  return (
    <>
      <div className="settings__section">
        <span className="settings__label">Media Player</span>

        <ImageSeconds
          value={playback.imageSeconds}
          onChange={(imageSeconds) => props.onPlaybackChange({ imageSeconds })}
        />

        <Switch
          label="Play on open"
          hint="Toggles whether to play videos on open by default."
          checked={playback.playOnOpen}
          onChange={(playOnOpen) => props.onPlaybackChange({ playOnOpen })}
        />

        <Switch
          label="Shuffle as default"
          hint="Globally enables shuffle=true as default when playing any media items."
          checked={playback.shuffleDefault}
          onChange={(shuffleDefault) => props.onPlaybackChange({ shuffleDefault })}
        />


        <Switch
          label="Show Meta data"
          hint="Shows the open item's details beside it in the media player: file, size, dates, and how often and how long it has been watched."
          checked={playback.showMetadata}
          onChange={(showMetadata) => props.onPlaybackChange({ showMetadata })}
        />

        <Switch
          label="Show description"
          hint="Part of what the viewer's description button shows: the description itself."
          checked={playback.showCaption}
          disabled={!playback.showDescription}
          onChange={(showCaption) => props.onPlaybackChange({ showCaption })}
        />

        <Switch
          label="Show tags"
          hint="The other part: the item's tags, over the media."
          checked={playback.showTags}
          disabled={!playback.showDescription}
          onChange={(showTags) => props.onPlaybackChange({ showTags })}
        />

        <Switch
          label="Show EXIF data"
          hint="Shows a photo's EXIF data, if it has any: camera, lens, settings and the date it was taken."
          checked={playback.showExif}
          onChange={(showExif) => props.onPlaybackChange({ showExif })}
        />

        <Switch
          label="Include Location"
          hint="Whether to also include location information in shown EXIF data"
          checked={playback.showLocation}
          disabled={!playback.showExif}
          onChange={(showLocation) => props.onPlaybackChange({ showLocation })}
        />
      </div>

      <WatchHistory
        playback={playback}
        onPlaybackChange={props.onPlaybackChange}
        onChanged={props.onChanged}
      />

      <UpdateSettings playback={playback} onPlaybackChange={props.onPlaybackChange} />
    </>
  )
}

/** Watch history: what is remembered about what you have watched. */
function WatchHistory(props: {
  playback: PlaybackPrefs
  onPlaybackChange: (patch: Partial<PlaybackPrefs>) => void
  onChanged: () => void
}): React.JSX.Element {
  const { playback } = props

  return (
    <div className="settings__group settings__section">
      <span className="settings__label">Watch history</span>

      <Switch
        label="Keep watch history"
        hint="Counts how often each item is opened and how long it is watched for."
        checked={playback.keepHistory}
        onChange={(keepHistory) => props.onPlaybackChange({ keepHistory })}
      />

      <Switch
        label="Remember playback position"
        hint="Notes where a video was left and carries on from there next time. A video watched to the end starts fresh."
        checked={playback.resumePosition}
        onChange={(resumePosition) => props.onPlaybackChange({ resumePosition })}
      />

      {/* As a share of the video's length rather than a number of seconds: half a
          minute is nothing in a film and most of a clip, and a library has
          plenty of both. */}
      <Slider
        label="Remember after"
        hint="How far into a video you must be before the place is kept. A video whose length is not known yet needs a minute."
        min={RESUME_AFTER.min}
        max={RESUME_AFTER.max}
        step={5}
        value={playback.resumeAfterPercent}
        disabled={!playback.resumePosition}
        format={(value) => (value === 0 ? 'Any point' : `${value}%`)}
        onChange={(resumeAfterPercent) => props.onPlaybackChange({ resumeAfterPercent })}
      />

      <Switch
        label="Show Continue watching"
        hint="A row of part-watched videos above the library."
        checked={playback.showContinue}
        disabled={!playback.resumePosition}
        onChange={(showContinue) => props.onPlaybackChange({ showContinue })}
      />

      <NumberField
        label="Continue watching holds"
        hint="The most it will keep. The row scrolls sideways once they no longer fit."
        suffix="items"
        min={CONTINUE_COUNT.min}
        max={CONTINUE_COUNT.max}
        value={playback.continueCount}
        disabled={!playback.resumePosition || !playback.showContinue}
        onChange={(continueCount) => props.onPlaybackChange({ continueCount })}
      />

      <ClearHistory onCleared={props.onChanged} />
    </div>
  )
}

/**
 * Forgets every count, time watched and position, after asking. Separate from
 * the switch above it: turning recording off should not throw away what is
 * already there, and throwing it away should not be a side effect of a switch.
 */
function ClearHistory({ onCleared }: { onCleared: () => void }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const [gone, setGone] = useState<number | null>(null)

  return (
    <div className="settings__row settings__row--tight">
      {confirming ? (
        <>
          <button
            type="button"
            className="button button--danger"
            onClick={() => {
              setConfirming(false)
              void window.goonlib.media
                .clearHistory()
                .then((rows) => {
                  setGone(rows)
                  onCleared()
                })
                .catch(() => undefined)
            }}
          >
            Really clear?
          </button>
          <button type="button" className="button button--quiet" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          className="button button--quiet"
          onClick={() => {
            setGone(null)
            setConfirming(true)
          }}
          title="Forget every count, time watched and playback position"
        >
          Clear watch history
        </button>
      )}
      {gone !== null ? (
        <span className="muted">{gone === 0 ? 'Nothing to clear' : `Cleared ${gone}`}</span>
      ) : null}
    </div>
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
