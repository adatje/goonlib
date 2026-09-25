import { useEffect, useRef, useState } from 'react'
import type { AppInfo, PlaybackPrefs } from '@shared/types'
import type { CoWatchView } from '../state/useCoWatch'
import type { ToyView } from '../state/useToy'
import { AiSections } from './AiSections'
import { AppSettings } from './AppSettings'
import { AppStyling } from './AppStyling'
import { BackupSettings } from './BackupSettings'
import { ShortcutsSettings } from './ShortcutsSettings'
import { PeopleIcon, PulseIcon, SlidersIcon, SparkleIcon } from './SidebarIcons'
import { TabPanel, type SheetTab } from './TabPanel'
import { ToySections } from './ToySections'

export interface SettingsSheetProps {
  toy: ToyView
  cowatch: CoWatchView
  /** The tab to open on. */
  tab: SheetTab
  /** The player's preferences, for the App page. */
  playback: PlaybackPrefs
  onPlaybackChange: (patch: Partial<PlaybackPrefs>) => void
  onSelectTab: (tab: SheetTab) => void
  onClose: () => void
  /** Fired after anything that could change the library, so the grid refreshes. */
  onChanged: () => void
  /** Closes the sheet and shows the duplicates screen. */
  onOpenDuplicates: () => void
}

/** One entry in the rail. `tabs` is every sheet tab the entry stands for. */
interface RailEntry {
  label: string
  /** The tab the entry opens on. */
  tab: SheetTab
  tabs: SheetTab[]
}

/**
 * The rail, in groups. Tabs run down the side rather than across the top: a
 * row would not fit across the sheet, and the groups say which belong
 * together. Features stands for two tabs, shown as tabs of their own inside it.
 */
const GROUPS: Array<{ label: string; icon: React.ReactNode; entries: RailEntry[] }> = [
  {
    label: 'General',
    icon: <SlidersIcon />,
    entries: [
      { label: 'App', tab: 'app', tabs: ['app'] },
      { label: 'Appearance', tab: 'styling', tabs: ['styling'] },
      { label: 'De-duplication', tab: 'duplicates', tabs: ['duplicates'] },
      { label: 'Shortcuts', tab: 'shortcuts', tabs: ['shortcuts'] },
      { label: 'Backup', tab: 'backup', tabs: ['backup'] },
    ],
  },
  {
    label: 'Toys',
    icon: <PulseIcon />,
    entries: [
      { label: 'Connections', tab: 'controls', tabs: ['controls'] },
      { label: 'Controls', tab: 'solo', tabs: ['solo'] },
      { label: 'Patterns', tab: 'patterns', tabs: ['patterns'] },
    ],
  },
  {
    label: 'Sharing',
    icon: <PeopleIcon />,
    entries: [{ label: 'Watch Together', tab: 'together', tabs: ['together'] }],
  },
  {
    label: 'AI',
    icon: <SparkleIcon />,
    entries: [
      { label: 'Providers', tab: 'providers', tabs: ['providers'] },
      { label: 'Features', tab: 'tagging', tabs: ['tagging'] },
    ],
  },
]

/**
 * What each page opens with: its title, a line on what it is for, and a rule
 * under both. The two Features tabs share one.
 */
const PAGE_HEADS: Record<SheetTab, { title: string; intro: string }> = {
  app: {
    title: 'App',
    intro: 'General app settings.',
  },
  styling: {
    title: 'Appearance',
    intro: 'Light, dark or automatic, and themes of your own to pick from.',
  },
  shortcuts: {
    title: 'Shortcuts',
    intro: 'Every key, and what it does. Click one and press the key you would rather use.',
  },
  backup: {
    title: 'Backup',
    intro: 'Your settings and themes, out to a file and back in.',
  },
  duplicates: {
    title: 'De-duplication',
    intro: 'Find exact copies and look-alike pictures, and keep just one of each.',
  },
  controls: {
    title: 'Connections',
    intro: 'Connect Lovense and other Intiface-compatible devices.',
  },
  solo: {
    title: 'Controls',
    intro: 'Adjust your connected toy control settings.',
  },
  patterns: {
    title: 'Patterns',
    intro: 'Use pre-defined patterns or create a new one',
  },
  together: {
    title: 'Watch Together',
    intro:
      "Lets you invite others to a browser session - no install, nothing to download. Guests see what you're watching, in step with you, and either of you can play, pause or skip. Includes toy controls when enabled.",
  },
  providers: {
    title: 'Providers',
    intro: 'Lets you set up your local and/or OpenAI-compatible LLM provider and model of choice.',
  },
  tagging: { title: 'Features', intro: 'Supported AI features & capabilities' },
}

/** The tabs inside Features, across the top of it. */
const FEATURE_TABS: Array<{ id: SheetTab; label: string }> = [{ id: 'tagging', label: 'Auto-tagging' }]

/**
 * Whether this is a beta build, which the footer says out loud.
 *
 * A plain flag rather than something read out of the version: the version
 * stays an ordinary number so the updater and the installers keep their usual
 * names, and "beta" is a thing said to the reader rather than a release
 * channel. Set it to false when 1.0 ships.
 */
const BETA = true

/**
 * Settings: everything behind the one gear — how the app looks, the toy,
 * watching together, and AI — in one sheet with a tab for each.
 *
 * Every tab stays mounted and only the chosen one is shown, so nothing typed,
 * drawn or previewing is lost by looking at another. Every control writes
 * through as it changes; the one Save is for keeping a theme being edited.
 */
export function SettingsSheet(props: SettingsSheetProps): React.JSX.Element {
  const { tab } = props
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    shellRef.current?.focus()
    void window.goonlib.app.info().then(setInfo).catch(() => undefined)
  }, [])

  const knocking = props.cowatch.session.knocking.length
  const sharing = props.cowatch.session.active

  return (
    <div
      className="prompt"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose()
      }}
    >
      <div
        className="settings settings--sheet"
        ref={shellRef}
        tabIndex={-1}
        // The viewer listens for keys at the window; without this its shortcuts
        // would fire while settings are being edited. X is let through, so the
        // toy can be stopped from here as from anywhere else.
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            props.onClose()
            event.stopPropagation()
            return
          }
          if (event.key !== 'x' && event.key !== 'X') event.stopPropagation()
        }}
      >
        <header className="settings__head">
          <h2 className="settings__title">Settings</h2>
          <button
            type="button"
            className="lightbox__close"
            onClick={props.onClose}
            aria-label="Close settings"
          >
            ×
          </button>
        </header>

        <div className="sheet">
          <nav className="sheet__rail" role="tablist" aria-orientation="vertical" aria-label="Settings">
            {GROUPS.map((group) => (
              <div key={group.label} className="sheet__group">
                <span className="sheet__group-label">
                  <span className="sheet__group-icon">{group.icon}</span>
                  {group.label}
                </span>
                {group.entries.map((entry) => {
                  const on = entry.tabs.includes(tab)
                  return (
                    <button
                      key={entry.label}
                      type="button"
                      role="tab"
                      id={`settings-tab-${entry.tab}`}
                      aria-selected={on}
                      aria-controls={`settings-panel-${entry.tab}`}
                      className={on ? 'sheet__tab sheet__tab--on' : 'sheet__tab'}
                      // Stays on the inner tab already showing, when there is one.
                      onClick={() => (on ? undefined : props.onSelectTab(entry.tab))}
                    >
                      {entry.label}
                      {entry.tab === 'together' && knocking > 0 ? (
                        <span className="sidebar__badge sheet__badge">{knocking}</span>
                      ) : entry.tab === 'together' && sharing ? (
                        <span className="tabbar__dot" title="A session is running" />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>

          <div className="settings__body sheet__content">
            <header className="sheet__pagehead">
              <h3 className="settings__heading">{PAGE_HEADS[tab].title}</h3>
              <p className="settings__hint">{PAGE_HEADS[tab].intro}</p>
            </header>
            {FEATURE_TABS.some((option) => option.id === tab) ? (
              <div className="tabbar sheet__subtabs" role="tablist" aria-label="Features">
                {FEATURE_TABS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === option.id}
                    aria-controls={`settings-panel-${option.id}`}
                    className={tab === option.id ? 'tabbar__tab tabbar__tab--on' : 'tabbar__tab'}
                    onClick={() => props.onSelectTab(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
            <TabPanel id="app" tab={tab}>
              <AppSettings
                playback={props.playback}
                onPlaybackChange={props.onPlaybackChange}
                onChanged={props.onChanged}
              />
            </TabPanel>
            <TabPanel id="shortcuts" tab={tab}>
              <ShortcutsSettings />
            </TabPanel>
            <TabPanel id="backup" tab={tab}>
              <BackupSettings />
            </TabPanel>
            <TabPanel id="styling" tab={tab}>
              <AppStyling active={tab === 'styling'} />
            </TabPanel>
            <ToySections
              toy={props.toy}
              cowatch={props.cowatch}
              playback={props.playback}
              onPlaybackChange={props.onPlaybackChange}
              sharing={sharing}
              tab={tab}
            />
            <AiSections
              tab={tab}
              onSelectTab={props.onSelectTab}
              onChanged={props.onChanged}
              onOpenDuplicates={props.onOpenDuplicates}
            />
          </div>
        </div>

        {info ? (
          <footer className="settings__foot">
            GoonLib {info.version}
            {BETA ? (
              <span className="settings__beta" title="A beta build. Things may move, and bugs are expected.">
                beta
              </span>
            ) : null}
            {info.ffmpeg ? '' : ' · ffmpeg not found'} · Author:{' '}
            {/* target=_blank rather than an IPC call: the window's open handler
                already sends anything opening a new window to the real browser
                and denies the window itself. */}
            <a
              className="settings__link"
              href="https://github.com/adatje"
              target="_blank"
              rel="noreferrer"
              title="@Adatje on GitHub"
            >
              @Adatje
            </a>
          </footer>
        ) : null}
      </div>
    </div>
  )
}
