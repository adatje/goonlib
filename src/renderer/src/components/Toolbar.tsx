import { useCallback, useEffect, useRef, useState } from 'react'
import type { MediaKind, MediaSort, Tag } from '@shared/types'
import { Filters } from './Filters'
import type { FilterSet } from './Filters'
import { formatBytes, formatCount } from '../format'
import { DownloadIcon, ImageIcon, LibraryIcon, SearchIcon, SortIcon, StorageIcon, VideoIcon } from './SidebarIcons'
import type { ToyView } from '../state/useToy'
import { ToyChip } from './ToyChip'

export interface ToolbarProps {
  search: string
  onSearchChange: (value: string) => void
  kind: MediaKind | 'all'
  onKindChange: (kind: MediaKind | 'all') => void
  sort: MediaSort
  onSortChange: (sort: MediaSort) => void
  total: number
  /** Combined size of what `total` counts, in bytes. */
  totalBytes: number
  /** True when viewing a collection, which is the only context with a saved order. */
  allowManualSort?: boolean
  /** What the grid is narrowed by, and everything it could be narrowed by. */
  filters: FilterSet
  onFiltersChange: (filters: FilterSet) => void
  tags: Tag[]
  /** The toy, for the chip that stops it and runs a pattern. Only shown while one is connected. */
  toy: ToyView
  /** True while a thread download is already running. */
  scraping: boolean
  onScrape: (url: string) => void
}

/**
 * A pasted link turns the search box into a download box.
 *
 * Detecting the scheme rather than validating the whole URL on every keystroke
 * is deliberate: the moment you paste anything web-shaped, searching filenames
 * for it is certainly not what you meant, so the box should stop pretending it
 * is a search. Whether the link is actually a 4chan thread is the main
 * process's call, and its refusal is a far better error than a greyed-out
 * button with no explanation.
 */
export function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

/**
 * Cogwheel: eight square teeth around a solid body, with the hub cut out. The
 * earlier stroked version read as a sun at this size.
 */
export function GearIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M13.27,6.84 L14.93,7.04 L14.93,8.96 L13.27,9.16 L12.55,10.91 L13.58,12.22 L12.22,13.58 L10.91,12.55 L9.16,13.27 L8.96,14.93 L7.04,14.93 L6.84,13.27 L5.09,12.55 L3.78,13.58 L2.42,12.22 L3.45,10.91 L2.73,9.16 L1.07,8.96 L1.07,7.04 L2.73,6.84 L3.45,5.09 L2.42,3.78 L3.78,2.42 L5.09,3.45 L6.84,2.73 L7.04,1.07 L8.96,1.07 L9.16,2.73 L10.91,3.45 L12.22,2.42 L13.58,3.78 L12.55,5.09 Z M10.3,8 A2.3,2.3 0 1 0 5.7,8 A2.3,2.3 0 1 0 10.3,8 Z"
      />
    </svg>
  )
}

/** The familiar crossing-arrows glyph. */
export function ShuffleIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none">
      <path
        d="M1 3.5h2.4c.9 0 1.7.45 2.2 1.2l3.8 6.1c.5.75 1.3 1.2 2.2 1.2H15M1 12.5h2.4c.9 0 1.7-.45 2.2-1.2l.9-1.45M15 3.5h-2.3c-.9 0-1.7.45-2.2 1.2l-.9 1.45"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.8 1.6 15 3.5l-2.2 1.9M12.8 10.1l2.2 1.9-2.2 1.9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Outlined when off, filled when on — the same glyph in both states. */
export function HeartIcon({ filled = false, size = 15 }: { filled?: boolean; size?: number }): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path
        d="M8 14s-5.6-3.4-5.6-7.3A3.1 3.1 0 0 1 8 4.6a3.1 3.1 0 0 1 5.6 2.1C13.6 10.6 8 14 8 14Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The media-type segments, each with the glyph that stands for it. */
const KINDS: Array<{ value: MediaKind | 'all'; label: string; icon: React.JSX.Element }> = [
  { value: 'all', label: 'All', icon: <LibraryIcon /> },
  { value: 'image', label: 'Images', icon: <ImageIcon /> },
  { value: 'video', label: 'Videos', icon: <VideoIcon /> },
]

const SORT_LABELS: Array<{ value: MediaSort; label: string }> = [
  { value: 'added', label: 'Recently added' },
  { value: 'name', label: 'Name' },
  { value: 'size', label: 'Size' },
  { value: 'duration', label: 'Duration' },
  { value: 'shuffle', label: 'Shuffle' },
]

/** Only offered inside a collection, which is the only place an order is stored. */
const MANUAL_SORT = { value: 'manual' as const, label: 'Custom order' }

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  const scrapeMode = looksLikeUrl(props.search)

  return (
    <div className="toolbar">
      <div className="toolbar__drag" aria-hidden="true" />
      <div className="toolbar__searchbox">
        {/* The glyph says which of the box's two jobs is live: a magnifier
            while it is searching names, an arrow down once what is in it is a
            link to fetch. */}
        <span className="toolbar__search-icon" aria-hidden="true">
          {scrapeMode ? <DownloadIcon /> : <SearchIcon />}
        </span>
        <input
          type="search"
          className={scrapeMode ? 'toolbar__search toolbar__search--url' : 'toolbar__search'}
          placeholder="Search / Download media items"
          value={props.search}
          onChange={(event) => props.onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && scrapeMode && !props.scraping) {
              props.onScrape(props.search.trim())
            }
          }}
          aria-label="Search the library, or paste a 4chan thread link to download it"
        />
      </div>

      {scrapeMode ? (
        <button
          type="button"
          className="button"
          onClick={() => props.onScrape(props.search.trim())}
          disabled={props.scraping}
          title="Download this thread's images and videos into Downloads, and add the folder to the library"
        >
          {props.scraping ? 'Downloading…' : 'Download thread'}
        </button>
      ) : null}

      <div className="segmented" role="group" aria-label="Filter by media type">
        {KINDS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className={props.kind === entry.value ? 'segmented__item segmented__item--on' : 'segmented__item'}
            onClick={() => props.onKindChange(entry.value)}
            aria-pressed={props.kind === entry.value}
          >
            {entry.icon}
            {entry.label}
          </button>
        ))}
      </div>

      <Filters filters={props.filters} onChange={props.onFiltersChange} tags={props.tags} />

      <SortMenu
        sort={props.sort}
        options={props.allowManualSort ? [MANUAL_SORT, ...SORT_LABELS] : SORT_LABELS}
        onSortChange={props.onSortChange}
      />

      {props.toy.live ? <ToyChip toy={props.toy} /> : null}

      {/* The glyph is the divider: how many, then what they weigh. */}
      <span className="toolbar__count">
        {formatCount(props.total)} items
        <StorageIcon />
        {formatBytes(props.totalBytes)}
      </span>
    </div>
  )
}

/**
 * The sort order, as a menu in the app's own style rather than the system's
 * select, matching the shuffle menu beside it.
 */
function SortMenu(props: {
  sort: MediaSort
  options: Array<{ value: MediaSort; label: string }>
  onSortChange: (sort: MediaSort) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const closeMenu = useCallback(() => setOpen(false), [])
  useDismiss(open, shellRef, closeMenu)

  const current = props.options.find((option) => option.value === props.sort) ?? props.options[0]

  return (
    <div className="addto" ref={shellRef}>
      <button
        type="button"
        className="toolbar__sort"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Sort by ${current?.label ?? ''}`}
      >
        <SortIcon />
        {current?.label}
        <span className="toolbar__sort-chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className="addto__menu addto__menu--narrow" role="menu" aria-label="Sort by">
          {props.options.map((option) => (
            <button
              key={option.value}
              type="button"
              className="addto__item"
              role="menuitemradio"
              aria-checked={option.value === props.sort}
              onClick={() => {
                setOpen(false)
                props.onSortChange(option.value)
              }}
            >
              <span className="addto__check" aria-hidden="true">
                {option.value === props.sort ? '✓' : ''}
              </span>
              <span className="addto__name">{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Closes a menu on a click outside it, or on Escape — without Escape also
 * closing the viewer underneath.
 */
function useDismiss(open: boolean, shellRef: React.RefObject<HTMLDivElement | null>, close: () => void): void {
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent): void => {
      if (!shellRef.current?.contains(event.target as Node)) close()
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
    }
    document.addEventListener('mousedown', outside)
    window.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', escape, true)
    }
  }, [open, shellRef, close])
}

const RANDOM_KINDS: Array<{ id: MediaKind | 'all'; label: string }> = [
  { id: 'video', label: 'Videos' },
  { id: 'image', label: 'Images' },
  { id: 'all', label: 'Both' },
]

/** What a random pick is, in a sentence: "a random video". */
const KIND_NOUN: Record<MediaKind | 'all', string> = {
  video: 'video',
  image: 'image',
  all: 'item',
}

/**
 * The shuffle toggle, and what shuffle picks from.
 *
 * A click turns shuffle on or off, as it always has. A right-click offers
 * videos, images or both; the choice is remembered, turns shuffle on, and
 * governs every random pick — shuffle's next item and R in the viewer — so
 * they never disagree. Lives in the viewer.
 */
export function ShuffleToggle(props: {
  shuffle: boolean
  onShuffleChange: (shuffle: boolean) => void
  kind: MediaKind | 'all'
  onKind: (kind: MediaKind | 'all') => void
  /** Appended to the tooltip — the viewer adds its keyboard shortcut. */
  shortcut?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const closeMenu = useCallback(() => setOpen(false), [])
  useDismiss(open, shellRef, closeMenu)

  const noun = KIND_NOUN[props.kind]
  const state = props.shuffle
    ? `Shuffle is on - next plays a random ${noun}`
    : 'Shuffle off - next plays the following item'

  return (
    <div className="addto" ref={shellRef}>
      <button
        type="button"
        className={props.shuffle ? 'icon-button icon-button--on' : 'icon-button'}
        onClick={() => props.onShuffleChange(!props.shuffle)}
        onContextMenu={(event) => {
          event.preventDefault()
          setOpen((value) => !value)
        }}
        aria-pressed={props.shuffle}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${state}${props.shortcut ? ` (${props.shortcut})` : ''} · right-click to choose videos, images or both`}
      >
        <ShuffleIcon />
        <span className="visually-hidden">Shuffle</span>
      </button>

      {open ? (
        <div className="addto__menu addto__menu--narrow" role="menu" aria-label="Shuffle picks from">
          {RANDOM_KINDS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="addto__item"
              role="menuitemradio"
              aria-checked={option.id === props.kind}
              onClick={() => {
                setOpen(false)
                props.onKind(option.id)
                props.onShuffleChange(true)
              }}
            >
              <span className="addto__check" aria-hidden="true">
                {option.id === props.kind ? '✓' : ''}
              </span>
              <span className="addto__name">{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
