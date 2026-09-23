import { useState } from 'react'
import type { CustomPattern, PatternId } from '@shared/toy'
import { customIdOf, customPatternId, TOY_PATTERNS } from '@shared/toy'
import { PatternEditor } from './PatternEditor'
import type { ToyPrefs, ToyScriptState, ToyStatus } from '@shared/types'
import type { CoWatchView } from '../state/useCoWatch'
import type { ToyView } from '../state/useToy'
import { CoWatchSection, SessionName } from './CoWatchPanel'
import { TabPanel } from './TabPanel'
import type { SheetTab } from './TabPanel'

export interface ToySectionsProps {
  toy: ToyView
  cowatch: CoWatchView
  /** Whether a co-watching session is running, so the guest settings can say so. */
  sharing: boolean
  /** Which tab of the Settings sheet is showing. */
  tab: SheetTab
}

const TOY_TABS: SheetTab[] = ['controls', 'solo', 'patterns', 'together']

/**
 * The toy's tabs of the Settings sheet — the toy itself, playing on your own,
 * and playing with guests — with the co-watching session itself on the last.
 *
 * Stop sits above the toy tabs rather than inside one. It is the loudest thing
 * here and never moves: on any toy tab, the place to press to make it stop is
 * the same place.
 */
export function ToySections({ toy, cowatch, sharing, tab }: ToySectionsProps): React.JSX.Element {
  const { status, prefs } = toy
  const ready = status.engine === 'ready'
  const onToyTab = TOY_TABS.includes(tab)
  // A dismissed message stays dismissed until a different one comes along.
  const [dismissed, setDismissed] = useState<string | null>(null)

  return (
    <>
      {tab === 'controls' && status.message && status.message !== dismissed && status.engine !== 'installing' ? (
        <div className="banner banner--error settings__banner banner--dismissable" role="alert">
          <span>{status.message}</span>
          <button
            type="button"
            className="banner__close"
            onClick={() => setDismissed(status.message)}
            aria-label="Dismiss"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}

      {onToyTab && ready && status.devices.length > 0 ? <StopStrip toy={toy} /> : null}

      <TabPanel id="controls" tab={tab}>
        <Devices toy={toy} />
        {prefs ? <ConnectionSettings toy={toy} prefs={prefs} /> : null}
        <p className="settings__hint toy__foot">
          {ready
            ? `Connected through ${status.server === 'external' ? 'Intiface Central' : 'Intiface Engine'}. Press X anywhere to stop.`
            : null}
          {ready ? (
            <button type="button" className="button button--quiet" onClick={toy.disconnect}>
              Disconnect
            </button>
          ) : null}
        </p>
      </TabPanel>

      <TabPanel id="solo" tab={tab}>
        {prefs ? <Strength toy={toy} prefs={prefs} /> : null}
        {prefs ? <StrokerSettings toy={toy} prefs={prefs} /> : null}
      </TabPanel>

      <TabPanel id="patterns" tab={tab}>
        <PatternsTab toy={toy} />
      </TabPanel>

      <TabPanel id="together" tab={tab}>
        <Together toy={toy} sharing={sharing} />
        <div className="settings__group">
          <SessionName />
        </div>
        <div className="settings__group">
          <CoWatchSection cowatch={cowatch} />
        </div>
      </TabPanel>
    </>
  )
}

/** Stop, the live meter, and what is driving the toy. Shown on every tab. */
function StopStrip({ toy }: { toy: ToyView }): React.JSX.Element {
  const { status } = toy
  return (
    <div className="toy__stop">
      {status.armed ? (
        <button type="button" className="button button--danger toy__big" onClick={toy.stop}>
          Stop
        </button>
      ) : (
        <button type="button" className="button toy__big" onClick={toy.resume}>
          Stopped - resume
        </button>
      )}
      <div className="toy__meter" aria-label={`Running at ${Math.round(status.level * 100)}%`}>
        <div className="toy__meter-fill" style={{ width: `${status.level * 100}%` }} />
      </div>
      <p className="settings__hint">{describeSource(status)}</p>
    </div>
  )
}

/**
 * The toys, and the one button that finds them: it connects first, and once
 * connected looks again. The list is always here, so connecting never moves
 * the button out from under the pointer.
 */
function Devices({ toy }: { toy: ToyView }): React.JSX.Element {
  const { status } = toy
  const ready = status.engine === 'ready'
  const busy = status.engine === 'installing' || status.engine === 'starting' || status.scanning

  const label =
    status.engine === 'installing'
      ? 'Downloading Intiface Engine…'
      : status.engine === 'starting'
        ? 'Connecting…'
        : status.scanning
          ? 'Scanning…'
          : 'Scan'

  return (
    <div className="toy__devices">
      <span className="settings__label">Connected toys</span>
      <div className="toy__list" role="list" aria-label="Connected toys">
        {status.devices.length === 0 ? (
          <span className="toy__list-empty">
            {status.scanning
              ? 'Looking for toys… Switch yours on, and make sure it is not connected to the Lovense app.'
              : ready
                ? 'No toys found.'
                : null}
          </span>
        ) : (
          status.devices.map((device) => (
            <div key={device.index} className="toy__device" role="listitem">
              <span className="toy__device-name">{device.name}</span>
              <span className="toy__device-meta">
                {device.stroke ? 'strokes' : device.vibrate ? 'vibrates' : 'no motors GoonLib drives'}
                {device.battery !== null ? ` · ${Math.round(device.battery * 100)}%` : ''}
              </span>
            </div>
          ))
        )}
      </div>

      {status.engine === 'installing' ? (
        <div className="player__progress" role="status" aria-label="Downloading Intiface Engine">
          <div className="player__progress-fill" style={{ width: `${status.progress ?? 0}%` }} />
        </div>
      ) : null}

      <div className="settings__row">
        <button type="button" className="button" onClick={ready ? toy.scan : toy.connect} disabled={busy}>
          {label}
        </button>
      </div>

      {!ready && !status.installed ? (
        <p className="settings__hint">
          {status.supported
            ? 'The first time, this downloads Intiface Engine (about 6 MB, from the Buttplug.io project on GitHub) - the program that talks to the toy. If Intiface Central is already running, GoonLib uses that instead.'
            : 'There is no Intiface Engine download for this machine. Install Intiface Central from intiface.com, start its server, and connect - GoonLib will use it.'}
        </p>
      ) : null}
    </div>
  )
}

/**
 * How strong the toy gets. Intensity scales everything it does, from every
 * source; guests are held under their own ceiling as well. Timing sits here
 * because it is also about how the toy feels rather than what drives it.
 */
function Strength({ toy, prefs }: { toy: ToyView; prefs: ToyPrefs }): React.JSX.Element {
  return (
    <div className="toy__section">
      <Slider
        label="Intensity"
        hint="The maximum intensity enabled for your toy"
        min={5}
        max={100}
        step={5}
        value={Math.round(prefs.maxIntensity * 100)}
        format={(value) => `${value}%`}
        // Lowering it below Guest Intensity takes that down with it; the main
        // process holds the same rule.
        onChange={(value) => toy.setPrefs({ maxIntensity: value / 100 })}
      />
      <Slider
        label="Guest Intensity"
        hint="The maximum intensity allowed for guests"
        min={5}
        max={100}
        ceiling={Math.round(prefs.maxIntensity * 100)}
        step={5}
        value={Math.round(prefs.guestMaxIntensity * 100)}
        format={(value) => `${value}%`}
        onChange={(value) => toy.setPrefs({ guestMaxIntensity: value / 100 })}
      />
      <Slider
        label="Guest Duration"
        hint="Each guest waits for their own buzz to finish, plus a few seconds, before sending another."
        min={1}
        max={30}
        step={1}
        value={prefs.guestMaxSeconds}
        format={(value) => `${value}s`}
        onChange={(guestMaxSeconds) => toy.setPrefs({ guestMaxSeconds })}
      />
      <Slider
        label="Timing"
        hint="Adjust for bluetooth input lag"
        min={-500}
        max={1000}
        step={25}
        value={prefs.leadMs}
        format={(value) => `${value > 0 ? '+' : ''}${value} ms`}
        onChange={(leadMs) => toy.setPrefs({ leadMs })}
      />
    </div>
  )
}

/** How GoonLib finds the toy. */
function ConnectionSettings({ toy, prefs }: { toy: ToyView; prefs: ToyPrefs }): React.JSX.Element {
  return (
    <>
      <div className="settings__group">
        <span className="settings__label">Connecting</span>
        <Switch
          label="Connect when GoonLib opens"
          checked={prefs.autoConnect}
          onChange={(autoConnect) => toy.setPrefs({ autoConnect })}
        />
        <Switch
          label="Also find toys through the Lovense Connect app"
          hint="For a toy paired to Lovense Connect on your phone. Lovense's servers are asked where that app is. Takes effect the next time you connect."
          checked={prefs.lovenseConnect}
          onChange={(lovenseConnect) => toy.setPrefs({ lovenseConnect })}
        />
      </div>
    </>
  )
}

/** The Patterns tab. While a pattern is being drawn, the editor has the tab to itself. */
function PatternsTab({ toy }: { toy: ToyView }): React.JSX.Element {
  const [editing, setEditing] = useState<CustomPattern | 'new' | null>(null)

  if (editing) {
    return (
      <PatternEditor
        toy={toy}
        initial={editing === 'new' ? null : editing}
        onDone={() => setEditing(null)}
      />
    )
  }

  return (
    <>
      {toy.prefs ? <SyncSettings toy={toy} prefs={toy.prefs} /> : null}
      <div className="settings__group">
        <Patterns toy={toy} onEdit={setEditing} />
      </div>
    </>
  )
}

/** Patterns from the panel: the built-in ones, your own, and a way to draw one. */
function Patterns({
  toy,
  onEdit,
}: {
  toy: ToyView
  onEdit: (pattern: CustomPattern | 'new') => void
}): React.JSX.Element {
  const { status } = toy
  const running = status.manual
  const ready = status.engine === 'ready'

  // Patterns run at full strength; Intensity scales them with everything else.
  const run = (pattern: PatternId): void => toy.manual({ pattern, intensity: 1 })

  return (
    <div className="toy__section">
      <div className="toy__patterns" role="group" aria-label="Pattern">
        {TOY_PATTERNS.map((pattern) => (
          <PatternChip
            key={pattern.id}
            label={pattern.label}
            glyph={pattern.glyph}
            on={running?.pattern === pattern.id}
            disabled={!ready || !status.armed}
            onToggle={() => (running?.pattern === pattern.id ? toy.manual(null) : run(pattern.id))}
          />
        ))}
        {status.patterns.map((pattern) => {
          const id = customPatternId(pattern.id)
          return (
            <span key={pattern.id} className="toy__custom">
              <PatternChip
                label={pattern.name}
                glyph="✎"
                on={running?.pattern === id}
                disabled={!ready || !status.armed}
                onToggle={() => (running?.pattern === id ? toy.manual(null) : run(id))}
              />
              <button
                type="button"
                className="toy__edit"
                onClick={() => onEdit(pattern)}
                aria-label={`Edit ${pattern.name}`}
                title="Edit"
              >
                ⋯
              </button>
            </span>
          )
        })}
        <button type="button" className="cowatch__provider toy__new" onClick={() => onEdit('new')}>
          + New
        </button>
      </div>
      <p className="settings__hint">
        {ready
          ? 'Runs on top of whatever a video is doing - whichever is stronger wins.'
          : 'Connect a toy under Connections to run these. You can draw and save patterns in the meantime.'}
      </p>
    </div>
  )
}

const STROKE_FEEL: Array<{ id: ToyPrefs['vibrateFrom']; label: string }> = [
  { id: 'position', label: 'Deeper Strokes' },
  { id: 'speed', label: 'Faster Strokes' },
]

/** Whether the toy follows what is playing. */
function SyncSettings({ toy, prefs }: { toy: ToyView; prefs: ToyPrefs }): React.JSX.Element {
  return (
    <div className="settings__group">
      <span className="settings__label">Sync</span>

      <Switch
        label="Enable Sync"
        hint="Enables patterns sync"
        checked={prefs.followVideo}
        onChange={(followVideo) => toy.setPrefs({ followVideo })}
      />

      <Switch
        label="Generate patterns"
        hint="Generates a waveform pattern based on the audio profile of the video"
        checked={prefs.audio}
        disabled={!prefs.followVideo}
        onChange={(audio) => toy.setPrefs({ audio })}
      />
    </div>
  )
}

/** How a script's strokes are felt on a toy that vibrates. */
function StrokerSettings({ toy, prefs }: { toy: ToyView; prefs: ToyPrefs }): React.JSX.Element {
  return (
    <div className="settings__group">
      <div className="settings__field">
        <span className="settings__label">Stroker</span>
        <span className="settings__hint">
          For vibrating toys synced to a stroker script.
        </span>
        <div className="cowatch__providers" role="radiogroup" aria-label="Stroker">
          {STROKE_FEEL.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={prefs.vibrateFrom === option.id}
              className={
                prefs.vibrateFrom === option.id ? 'cowatch__provider cowatch__provider--on' : 'cowatch__provider'
              }
              onClick={() => toy.setPrefs({ vibrateFrom: option.id })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="settings__hint">
          Whether to prioritise depth vs. speed when synced to a toy vibration pattern.
        </span>
      </div>
    </div>
  )
}

/** Letting co-watching guests at the toy, and what they are doing with it. */
function Together({ toy, sharing }: { toy: ToyView; sharing: boolean }): React.JSX.Element {
  const { status, prefs } = toy
  if (!prefs) return <></>

  return (
    <div className="toy__section">
      <Switch
        label="Guest control"
        hint="Enables toy control for guests in 'Watch Together' sessions. Controls become visible to guests once enabled."
        checked={prefs.guests}
        onChange={(guests) => toy.setPrefs({ guests })}
      />

      {prefs.guests && guestState(status, sharing) ? (
        <p className={status.guests.open ? 'settings__ok' : 'settings__hint'}>{guestState(status, sharing)}</p>
      ) : null}
    </div>
  )
}

/**
 * Whether guests can reach the toy right now, and if not, what is in the way.
 * Null with no toy connected, which the switch's own hint already covers.
 */
function guestState(status: ToyStatus, sharing: boolean): string | null {
  if (status.engine !== 'ready' || status.devices.length === 0) return null
  if (!status.armed) return 'Stopped - guests are turned away until you resume.'
  if (!sharing) return 'Ready for when you start a session.'
  if (status.guests.playing) {
    const pattern = patternLabel(status, status.guests.playing.pattern).toLowerCase()
    const queued = status.guests.waiting > 0 ? `, ${status.guests.waiting} more queued` : ''
    return `${status.guests.playing.name} is sending a ${pattern}${queued}.`
  }
  return 'Guests can buzz you now.'
}

/** One line on what is driving the toy right now, if anything. */
function describeSource(status: ToyStatus): string {
  if (!status.armed) return 'Nothing will move the toy until you resume.'

  const parts: string[] = []
  const script = describeScript(status.script)
  if (script) parts.push(script)
  if (status.manual) parts.push(`${patternLabel(status, status.manual.pattern)} pattern`)
  if (status.guests.playing) {
    const pattern = patternLabel(status, status.guests.playing.pattern)
    parts.push(`${status.guests.playing.name}'s ${pattern.toLowerCase()}`)
  }
  if (status.guests.waiting > 0) parts.push(`${status.guests.waiting} buzz queued`)

  return parts.length > 0 ? parts.join(' · ') : 'Waiting for a video, a pattern, or a guest.'
}

export function describeScript(script: ToyScriptState): string | null {
  switch (script.kind) {
    case 'funscript':
      return `Playing ${script.name}`
    case 'audio':
      return 'Following the sound'
    case 'loading':
      return 'Reading the video…'
    case 'error':
      return `Script unreadable: ${script.message}`
    case 'none':
      return script.mediaId !== null ? 'This video has no script' : null
  }
}

/** What to call a pattern, whether built in, saved, or still being drawn. */
export function patternLabel(status: ToyStatus, pattern: PatternId | 'preview'): string {
  if (pattern === 'preview') return 'Preview'
  const id = customIdOf(pattern)
  if (id !== null) return status.patterns.find((saved) => saved.id === id)?.name ?? 'Saved'
  return TOY_PATTERNS.find((known) => known.id === pattern)?.label ?? pattern
}

function PatternChip(props: {
  label: string
  glyph: string
  on: boolean
  disabled: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={props.on ? 'cowatch__provider cowatch__provider--on' : 'cowatch__provider'}
      aria-pressed={props.on}
      disabled={props.disabled}
      onClick={props.onToggle}
      title={props.on ? 'Stop this pattern' : undefined}
    >
      <span aria-hidden="true">{props.glyph}</span> {props.label}
    </button>
  )
}

function Switch(props: {
  label: string
  hint?: string
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
        {props.hint ? <span className="switch__hint">{props.hint}</span> : null}
      </span>
    </label>
  )
}

/**
 * A slider that stores on release, not on every pixel of the drag — each
 * change is a settings write in the main process — while still showing the
 * number as it moves.
 */
function Slider(props: {
  label: string
  hint?: string
  min: number
  max: number
  /** The highest it can be set to, when lower than the end of the bar. It stops there while dragging. */
  ceiling?: number
  step: number
  value: number
  format: (value: number) => string
  onChange: (value: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<number | null>(null)
  const limit = (value: number): number => Math.min(value, props.ceiling ?? props.max)
  const shown = draft ?? props.value
  const commit = (): void => {
    if (draft !== null && draft !== props.value) props.onChange(draft)
    setDraft(null)
  }

  return (
    <label className="settings__field">
      <span className="settings__row">
        <span className="settings__label">{props.label}</span>
        <span className="toy__value">{props.format(shown)}</span>
      </span>
      <input
        type="range"
        className="settings__range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={shown}
        onChange={(event) => setDraft(limit(Number(event.target.value)))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      {props.hint ? <span className="settings__hint">{props.hint}</span> : null}
    </label>
  )
}
