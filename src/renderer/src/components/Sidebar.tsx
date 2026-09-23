import type { Collection, FolderLocation, LibraryStats, Root, Tag } from '@shared/types'
import { formatCount } from '../format'
import markUrl from '../assets/mark.png'
import markSound1 from '../assets/mark-1.mp3'
import markSound2 from '../assets/mark-2.mp3'
import markSound3 from '../assets/mark-3.mp3'
import markSound4 from '../assets/mark-4.mp3'
import markSound5 from '../assets/mark-5.mp3'
import scanSound from '../assets/scan.mp3'
import { CollectionList } from './CollectionList'
import { FolderTree } from './FolderTree'
import { FolderIcon, LibraryIcon, ScanIcon, SourcesIcon } from './SidebarIcons'
import { SidebarSection } from './SidebarSection'
import { TagList } from './TagList'
import { GearIcon, HeartIcon } from './Toolbar'

export interface SidebarProps {
  roots: Root[]
  stats: LibraryStats | null
  busy: boolean
  location: FolderLocation | null
  collections: Collection[]
  collectionId: number | null
  tags: Tag[]
  tagId: number | null
  /** The Favorites view is showing. */
  favorites: boolean
  onSelectFavorites: () => void
  mode: 'library' | 'duplicates'
  onSelectMode: (mode: 'library' | 'duplicates') => void
  onAddRoot: () => void
  onRemoveRoot: (id: number) => void
  onToggleRoot: (root: Root) => void
  onSelectFolder: (location: FolderLocation | null) => void
  onSelectCollection: (id: number | null) => void
  onCreateCollection: (name: string) => void
  onRenameCollection: (id: number, name: string) => void
  onDeleteCollection: (collection: Collection) => void
  onSelectTag: (id: number | null) => void
  onCreateTag: (name: string) => void
  onRenameTag: (id: number, name: string) => void
  onDeleteTag: (tag: Tag) => void
  /** A scan is running, so Rescan waits for it. */
  scanning: boolean
  /** Looks for new, changed and removed files in every source. */
  onRescan: () => void
  /** Opens the Settings sheet — the toy, watching together, and AI. */
  onOpenSettings: () => void
  /** A session is running. Lights the gear, so sharing is never invisible. */
  sharing: boolean
  /** Someone is waiting to be let in, which needs answering wherever you are. */
  knocking: number
  /** Connected to a toy; lights the gear, so a toy is never on unseen. */
  toyLive: boolean
  /** Connected but stopped, which is worth a different look from running. */
  toyStopped: boolean
}

export function Sidebar(props: SidebarProps): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <button
          type="button"
          className="sidebar__mark-button"
          onClick={playMark}
          title="Careful senpai, I'm sensitive"
          tabIndex={-1}
          aria-hidden="true"
        >
          <img className="sidebar__mark" src={markUrl} alt="" width={20} height={20} />
        </button>
        GoonLib
      </div>

      <nav className="sidebar__nav">
        {/* Favorites first, set a little apart from the library as a whole. */}
        <button
          type="button"
          className={
            props.mode === 'library' && props.favorites
              ? 'nav-item nav-item--favorites nav-item--active'
              : 'nav-item nav-item--favorites'
          }
          onClick={props.onSelectFavorites}
        >
          <span className="nav-item__label">
            <HeartIcon filled={props.favorites} size={13} />
            Favorites
          </span>
          {props.stats ? (
            <span className="nav-item__count">{formatCount(props.stats.favorites)}</span>
          ) : null}
        </button>
        <button
          type="button"
          className={
            // Only the whole library: a collection, tag, folder or Favorites
            // each replaces it, so none of them leaves Library lit.
            props.mode === 'library' &&
            props.collectionId === null &&
            props.tagId === null &&
            props.location === null &&
            !props.favorites
              ? 'nav-item nav-item--active'
              : 'nav-item'
          }
          onClick={() => {
            props.onSelectCollection(null)
            props.onSelectMode('library')
          }}
        >
          <span className="nav-item__label">
            <LibraryIcon />
            Library
          </span>
          {props.stats ? (
            <span className="nav-item__count">{formatCount(props.stats.total)}</span>
          ) : null}
        </button>
        {/* Duplicates is reached from Settings → De-duplication, beside the
            setting that decides what counts as one. Library leads back. */}
      </nav>

      {/* Pink rules split the sidebar in three: the library itself, the ways
          of sorting it, and where it comes from. */}
      <hr className="sidebar__divider" />

      <CollectionList
        collections={props.collections}
        selectedId={props.collectionId}
        onSelect={props.onSelectCollection}
        onCreate={props.onCreateCollection}
        onRename={props.onRenameCollection}
        onDelete={props.onDeleteCollection}
      />

      <TagList
        tags={props.tags}
        selectedId={props.tagId}
        onSelect={props.onSelectTag}
        onCreate={props.onCreateTag}
        onRename={props.onRenameTag}
        onDelete={props.onDeleteTag}
      />

      <hr className="sidebar__divider" />

      <SidebarSection title="Folders" id="folders" icon={<FolderIcon />} active={props.location !== null}>
        {props.roots.length === 0 ? (
          <p className="muted">No folders yet. Add a source below.</p>
        ) : (
          // A source switched off under Sources is out of the library, so it is
          // out of the folder list too.
          <FolderTree
            roots={props.roots.filter((root) => root.enabled)}
            location={props.location}
            onSelect={props.onSelectFolder}
          />
        )}
      </SidebarSection>

      <SidebarSection title="Sources" id="sources" count={props.roots.length} icon={<SourcesIcon />}>
        {props.roots.length > 0 ? (
          <ul className="root-list">
            {props.roots.map((root) => (
              <li key={root.id} className="root">
                <label className="root__toggle">
                  <input
                    type="checkbox"
                    checked={root.enabled}
                    onChange={() => props.onToggleRoot(root)}
                  />
                  <span className="root__path" title={root.path}>
                    {basename(root.path)}
                  </span>
                </label>
                <button
                  type="button"
                  className="root__remove"
                  onClick={() => props.onRemoveRoot(root.id)}
                  aria-label={`Remove ${root.path} from the library`}
                  title="Remove from library (your files are not touched)"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <button type="button" className="button" onClick={props.onAddRoot} disabled={props.busy}>
          {props.busy ? 'Choosing…' : 'Add source'}
        </button>
      </SidebarSection>

      {/* Pinned to the bottom of the sidebar, whatever is scrolled above it. */}
      <footer className="sidebar__foot">
        <button
          type="button"
          className={props.scanning ? 'icon-button sidebar__rescan is-scanning' : 'icon-button sidebar__rescan'}
          onClick={() => {
            playScan()
            props.onRescan()
          }}
          disabled={props.scanning}
          title={props.scanning ? 'Scanning…' : 'Rescan: look for new, changed and removed files'}
        >
          <ScanIcon />
          <span className="visually-hidden">{props.scanning ? 'Scanning' : 'Rescan'}</span>
        </button>
        {/* The one way into Settings — the toy, watching together, and AI
            alike. It looks like every other icon here: the toy chip says what
            the toy is doing, so the gear does not colour itself for it. The
            count stays, since someone at the door is answered from here and
            nothing else on this screen says so. */}
        <button
          type="button"
          className="icon-button sidebar__settings"
          onClick={props.onOpenSettings}
          title={settingsTitle(props)}
        >
          <GearIcon />
          {props.knocking > 0 ? <span className="sidebar__badge">{props.knocking}</span> : null}
          <span className="visually-hidden">Settings</span>
        </button>
      </footer>
    </aside>
  )
}

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** What the gear says on hover: Settings, and anything it is lit up about. */
function settingsTitle(props: SidebarProps): string {
  const notes: string[] = []
  if (props.knocking > 0) {
    notes.push(props.knocking === 1 ? 'someone is waiting to join' : `${props.knocking} waiting to join`)
  } else if (props.sharing) {
    notes.push('sharing')
  }
  if (props.toyLive) notes.push(props.toyStopped ? 'toy stopped' : 'toy connected')
  return notes.length > 0 ? `Settings - ${notes.join(', ')}` : 'Settings'
}

let scanAudio: HTMLAudioElement | null = null

/** A sonar ping as Rescan starts looking. A second click restarts it rather than doubling it. */
function playScan(): void {
  scanAudio?.pause()
  scanAudio = new Audio(scanSound)
  scanAudio.volume = 0.7
  void scanAudio.play().catch(() => undefined)
}

const MARK_SOUNDS = [markSound1, markSound2, markSound3, markSound4, markSound5]
/** The last two played, newest first. */
let recentMarkSounds: number[] = []
let markAudio: HTMLAudioElement | null = null
/** Somewhere from 3 to 8 clicks. */
function markPatience(): number {
  return 3 + Math.floor(Math.random() * 6)
}

/** Clicks still to go before the mark next answers. */
let markClicksLeft = markPatience()

/**
 * The mark answers a click, though never straight away: each answer takes a
 * fresh 3 to 8 clicks. It picks at random, never one of the last two, and an
 * answer cuts off one still playing rather than talking over it.
 */
function playMark(): void {
  if (markClicksLeft > 1) {
    markClicksLeft -= 1
    return
  }
  markClicksLeft = markPatience()

  const choices = MARK_SOUNDS.map((_, index) => index).filter((index) => !recentMarkSounds.includes(index))
  const next = choices[Math.floor(Math.random() * choices.length)] ?? 0
  recentMarkSounds = [next, ...recentMarkSounds].slice(0, 2)

  markAudio?.pause()
  markAudio = new Audio(MARK_SOUNDS[next])
  void markAudio.play().catch(() => undefined)
}
