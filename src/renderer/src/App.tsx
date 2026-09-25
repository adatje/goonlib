import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Collection,
  FolderLocation,
  LibraryStats,
  MediaItem,
  MediaKind,
  MediaSort,
  PlaybackPrefs,
  Root,
  ScanProgress,
  ScrapeProgress,
  Tag,
  TrashUndoResult,
} from '@shared/types'
import { CONTINUE_COUNT, COWATCH_REACTIONS, IMAGE_SECONDS } from '@shared/types'
import { Breadcrumb } from './components/Breadcrumb'
import { CoWatchBar } from './components/CoWatchBar'
import { Duplicates } from './components/Duplicates'
import { Lightbox } from './components/Lightbox'
import { MediaGrid } from './components/MediaGrid'
import { actionOf } from './keys'
import { IS_WINDOWS, TRASH_NAME } from './platform'
import { setClassifyingSound } from './sounds'
import { ContinueRow } from './components/ContinueRow'
import { ShortcutsCard } from './components/ShortcutsCard'
import { countFilters, NO_FILTERS } from './components/Filters'
import type { FilterSet } from './components/Filters'
import { FolderMenu } from './components/FolderMenu'
import type { FolderMenuAt } from './components/FolderMenu'
import { MediaMenu } from './components/MediaMenu'
import type { MenuAt } from './components/MediaMenu'
import { ScanBar } from './components/ScanBar'
import { ScrapeBar } from './components/ScrapeBar'
import { SettingsSheet } from './components/SettingsSheet'
import type { SheetTab } from './components/TabPanel'
import { Sidebar } from './components/Sidebar'
import { looksLikeUrl, Toolbar } from './components/Toolbar'
import {
  advance,
  currentIndex,
  emptyHistory,
  HISTORY_LIMIT,
  pickRandomFrom,
  pickRandomIndex,
  retreat,
  startHistory,
} from './shuffle'
import type { ShuffleHistory } from './shuffle'
import { useCoWatch } from './state/useCoWatch'
import { useToy } from './state/useToy'
import { useLibrary } from './state/useLibrary'
import { useSelection } from './state/useSelection'
import { SelectionBar } from './components/SelectionBar'

/** How long to wait after the last keystroke before querying. */
const SEARCH_DEBOUNCE_MS = 220

/** How often a running scan is allowed to refresh the grid underneath the user. */
const SCAN_REFRESH_MS = 1500

const ACTIVE_PHASES = new Set<ScanProgress['phase']>([
  'walking',
  'probing',
  'thumbnailing',
  'previewing',
  'hashing',
  'classifying',
])


export default function App(): React.JSX.Element {
  const [roots, setRoots] = useState<Root[]>([])
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<MediaKind | 'all'>('all')
  const [sort, setSort] = useState<MediaSort>('added')
  /** What the Filters panel is narrowing by. Cleared by its own button, not by a view change. */
  const [chosen, setChosen] = useState<FilterSet>(NO_FILTERS)
  // Picking Shuffle, even again, deals a fresh order.
  const [shuffleSeed, setShuffleSeed] = useState(() => Math.floor(Math.random() * 2147483647))
  const chooseSort = useCallback((next: MediaSort) => {
    if (next === 'shuffle') setShuffleSeed(Math.floor(Math.random() * 2147483647))
    setSort(next)
  }, [])

  const [location, setLocation] = useState<FolderLocation | null>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [collectionId, setCollectionId] = useState<number | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [tagId, setTagId] = useState<number | null>(null)
  const [favorites, setFavorites] = useState(false)
  const [mode, setMode] = useState<'library' | 'duplicates'>('library')
  // The one Settings sheet: which tab it is open on, or null when closed.
  const [sheetTab, setSheetTab] = useState<SheetTab | null>(null)
  const openSettings = useCallback((tab?: SheetTab) => setSheetTab(tab ?? lastSheetTab()), [])
  const chooseSheetTab = useCallback((tab: SheetTab) => {
    setSheetTab(tab)
    try {
      localStorage.setItem(SHEET_TAB_KEY, tab)
    } catch {
      // Only a convenience; the sheet opens on the first tab without it.
    }
  }, [])
  const cowatch = useCoWatch()
  const toy = useToy()
  // In a session someone else is driving: this screen follows the room, and
  // anything that would change what is on screen has to be asked for.
  const watchingAlong = cowatch.session.active && !cowatch.session.control.inControl
  // Bumped when something was refused for want of control, so the session bar
  // can point at the button that asks for it.
  const [controlNudge, setControlNudge] = useState(0)
  const [folderMenuAt, setFolderMenuAt] = useState<FolderMenuAt | null>(null)
  // Held here rather than in the viewer: the viewer is mounted and unmounted
  // constantly, and re-reading the preference on every open would flicker.
  const [playback, setPlayback] = useState<PlaybackPrefs>({
    autoplay: true,
    playOnOpen: true,
    volume: 1,
    muted: false,
    randomKind: 'all',
    imageSeconds: IMAGE_SECONDS.default,
    shuffleDefault: false,
    showMetadata: false,
    showExif: false,
    showLocation: false,
    showDescription: true,
    showCaption: true,
    showTags: true,
    loop: false,
    keepHistory: true,
    resumePosition: true,
    resumeAfterPercent: 30,
    showContinue: true,
    continueCount: CONTINUE_COUNT.default,
    autoUpdate: true,
    resumeInSessions: true,
  })

  // The stored value is what lands in state, not the value we asked for, so a
  // write that failed leaves the toggle showing the truth.
  const changePlayback = useCallback((patch: Partial<PlaybackPrefs>): void => {
    void window.goonlib.playback.setPrefs(patch).then(setPlayback).catch(() => undefined)
    // Turning shuffle-by-default on or off takes effect now, not next launch.
    if (patch.shuffleDefault !== undefined) setShuffle(patch.shuffleDefault)
  }, [])

  /**
   * Volume is held here at once, so the next video opens at it even mid-drag,
   * and written a moment after the slider settles rather than on every pixel.
   * The write's answer is not put back into state: by the time it arrives the
   * slider may well have moved on, and snapping it back would fight the hand.
   */
  const volumeSave = useRef<ReturnType<typeof setTimeout> | null>(null)
  const changeVolume = useCallback((volume: number, muted: boolean): void => {
    setPlayback((current) => ({ ...current, volume, muted }))
    if (volumeSave.current) clearTimeout(volumeSave.current)
    volumeSave.current = setTimeout(() => {
      void window.goonlib.playback.setPrefs({ volume, muted }).catch(() => undefined)
    }, 400)
  }, [])
  const [scrape, setScrape] = useState<ScrapeProgress | null>(null)

  // 'manual' has no meaning outside a collection — guard rather than send a sort
  // the query would have to silently reinterpret.
  const effectiveSort: MediaSort = sort === 'manual' && collectionId === null ? 'added' : sort

  // Folder, collection, and tag are three alternative ways of narrowing the same
  // library, and selecting one clears the others. They could intersect — the
  // query supports it — but nothing in the chrome would show that two filters
  // are active, so an empty grid would have no visible explanation.
  const narrowed = collectionId !== null || tagId !== null || favorites

  const filters = useMemo(
    () => ({
      kind,
      search,
      sort: effectiveSort,
      order: effectiveSort === 'name' ? ('asc' as const) : ('desc' as const),
      rootId: narrowed ? undefined : location?.rootId,
      pathPrefix: narrowed ? undefined : location?.path,
      collectionId: collectionId ?? undefined,
      tagId: tagId ?? undefined,
      favorite: favorites || undefined,
      tagIds: chosen.tagIds.length > 0 ? chosen.tagIds : undefined,
      exts: chosen.exts.length > 0 ? chosen.exts : undefined,
      durations: chosen.durations.length > 0 ? chosen.durations : undefined,
      sizes: chosen.sizes.length > 0 ? chosen.sizes : undefined,
      seed: effectiveSort === 'shuffle' ? shuffleSeed : undefined,
    }),
    [kind, search, effectiveSort, location, collectionId, tagId, favorites, narrowed, shuffleSeed, chosen],
  )
  const view = useLibrary(filters)
  const selection = useSelection(view)

  const scanning = progress !== null && ACTIVE_PHASES.has(progress.phase)

  // A selection only means anything against the list it was made in. Changing
  // folder, collection, tag, search or sort leaves you looking at different
  // files, and carrying a hidden selection into that — with a Trash button
  // attached to it — is how the wrong thing gets deleted.
  useEffect(() => {
    selection.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear is stable; the
    // point is to react to the query changing, not to the selection object.
  }, [filters])

  // Typing shouldn't fire a query per keystroke. A pasted URL is never sent to
  // the query at all — searching filenames for `https://…` matches nothing and
  // would blank the grid the moment you paste.
  useEffect(() => {
    const timer = setTimeout(
      () => setSearch(looksLikeUrl(searchText) ? '' : searchText),
      SEARCH_DEBOUNCE_MS,
    )
    return () => clearTimeout(timer)
  }, [searchText])

  // A short-lived line saying what an undo or redo did, since the files it
  // moves are usually not on screen when it happens.
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3500)
    return () => clearTimeout(timer)
  }, [notice])

  const refreshSidebar = useCallback(async () => {
    try {
      const [nextRoots, nextStats, nextCollections, nextTags] = await Promise.all([
        window.goonlib.roots.list(),
        window.goonlib.library.stats(),
        window.goonlib.collections.list(),
        window.goonlib.tags.list(),
      ])
      setRoots(nextRoots)
      setStats(nextStats)
      setCollections(nextCollections)
      setTags(nextTags)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refreshSidebar()
    void window.goonlib.scan.status().then(setProgress).catch(() => undefined)
    // Falls back to the optimistic defaults above if this fails, which are the
    // behaviour the app had before these preferences existed.
    void window.goonlib.playback
      .prefs()
      .then((prefs) => {
        setPlayback(prefs)
        setShuffle(prefs.shuffleDefault)
      })
      .catch(() => undefined)
  }, [refreshSidebar])

  // Progress is pushed from the main process, so a download keeps reporting even
  // though the call that started it is still awaiting its final result.
  useEffect(() => window.goonlib.scrape.onProgress(setScrape), [])

  // The sonar keeps sounding while the classifier works - the one stage of a
  // scan slow enough to walk away from - and stops however it ends, this
  // window included.
  useEffect(() => {
    setClassifyingSound(progress?.phase === 'classifying')
    return () => setClassifyingSound(false)
  }, [progress?.phase])

  // Live scan progress, with grid refreshes rate-limited so a fast scan doesn't
  // re-render the viewport dozens of times a second.
  const lastRefresh = useRef(0)
  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(() => {
    return window.goonlib.scan.onProgress((next) => {
      setProgress(next)

      const finished = !ACTIVE_PHASES.has(next.phase)
      const now = Date.now()

      if (finished || now - lastRefresh.current > SCAN_REFRESH_MS) {
        lastRefresh.current = now
        viewRef.current.refresh()
        void refreshSidebar()
      }
    })
  }, [refreshSidebar])

  const guard = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const addRoot = useCallback(async () => {
    setBusy(true)
    await guard(async () => {
      const added = await window.goonlib.roots.add()
      if (added) await refreshSidebar()
    })
    setBusy(false)
  }, [guard, refreshSidebar])

  const removeRoot = useCallback(
    (id: number) =>
      void guard(async () => {
        await window.goonlib.roots.remove(id)
        await refreshSidebar()
        view.refresh()
      }),
    [guard, refreshSidebar, view],
  )

  const toggleRoot = useCallback(
    (root: Root) =>
      void guard(async () => {
        await window.goonlib.roots.setEnabled(root.id, !root.enabled)
        await refreshSidebar()
        view.refresh()
      }),
    [guard, refreshSidebar, view],
  )

  /**
   * Downloads a thread, then clears the box so the toolbar goes back to being a
   * search — leaving the URL in place would keep the library hidden behind a
   * filter that matches nothing.
   */
  const startScrape = useCallback(
    (url: string) =>
      void guard(async () => {
        await window.goonlib.scrape.start(url)
        setSearchText('')
        // The scrape adds its folder as a source and kicks off a scan; the
        // sidebar needs to show it immediately rather than at the next refresh.
        await refreshSidebar()
      }),
    [guard, refreshSidebar],
  )

  const rescan = useCallback(() => void guard(() => window.goonlib.scan.start()), [guard])
  const cancelScan = useCallback(() => void guard(() => window.goonlib.scan.cancel()), [guard])

  const [trashing, setTrashing] = useState(false)

  const moveSelected = useCallback(async () => {
    if (selection.size === 0) return
    setTrashing(true)
    try {
      const result = await window.goonlib.media.move([...selection.ids])
      // Dismissing the folder picker leaves everything exactly as it was,
      // selection included — it should not read as a completed action.
      if (!result.chosen) return

      selection.clear()
      view.refresh()
      await refreshSidebar()

      // Anything that didn't go to plan is worth saying; a clean move speaks
      // for itself once the grid updates.
      const notes = [
        result.renamed > 0 ? `${result.renamed} renamed to avoid a clash` : null,
        result.skipped > 0 ? `${result.skipped} already there` : null,
        result.failed > 0 ? `${result.failed} couldn't be moved` : null,
      ].filter((note): note is string => note !== null)

      setError(notes.length > 0 ? `Moved to ${result.destination}: ${notes.join(', ')}.` : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTrashing(false)
    }
  }, [selection, view, refreshSidebar])

  const trashOne = useCallback(
    (mediaId: number) =>
      void guard(async () => {
        const removed = await window.goonlib.media.trash([mediaId], { confirm: false })
        if (removed === 0) return
        // The lightbox tracks a position rather than an id, so refreshing slides
        // the next item into the slot the deleted one occupied.
        view.refresh()
        await refreshSidebar()
      }),
    [guard, view, refreshSidebar],
  )

  const trashSelected = useCallback(async (confirm: boolean) => {
    if (selection.size === 0) return
    setTrashing(true)
    try {
      // A cancelled confirmation comes back as zero and changes nothing.
      const removed = await window.goonlib.media.trash([...selection.ids], { confirm })
      if (removed > 0) {
        selection.clear()
        view.refresh()
        await refreshSidebar()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTrashing(false)
    }
  }, [selection, view, refreshSidebar])

  /**
   * Ctrl/Cmd+Z puts the last Delete back; Ctrl+Y, or Shift+Cmd+Z, trashes it
   * again. Listened for everywhere, the viewer included — deleting from the
   * viewer is exactly when an undo is wanted. Left alone while typing, where
   * the same keys mean undo the text.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const undo = key === 'z' && !event.shiftKey
      const redo = key === 'y' || (key === 'z' && event.shiftKey)
      if (!undo && !redo) return

      const target = event.target as HTMLElement | null
      const typing =
        target !== null &&
        (target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          (target instanceof HTMLInputElement &&
            !['range', 'checkbox', 'radio', 'button'].includes(target.type)))
      if (typing) return

      event.preventDefault()
      const action = undo ? window.goonlib.media.undoTrash() : window.goonlib.media.redoTrash()
      void action
        .then((result) => {
          setNotice(trashNotice(undo, result))
          if (result.moved > 0) {
            view.refresh()
            void refreshSidebar()
          }
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [view, refreshSidebar])

  // Lightbox position is held as an index into the current result set, so
  // navigating simply walks the same window the grid is already paging.
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  /**
   * What the room is on, when this grid has no row for it — a guest drove to
   * something outside the folder or filter being browsed here. Shown only while
   * nothing is open by index.
   */
  const [roomItem, setRoomItem] = useState<MediaItem | null>(null)

  // Cmd+A and Escape for the grid selection. Both are claimed by something else
  // in the obvious contexts — Cmd+A selects text in the search box, Escape
  // closes the lightbox — so this only acts when neither is in play.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (mode !== 'library' || openIndex !== null || roomItem !== null) return

      const target = event.target as HTMLElement | null
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (typing) return

      if (event.key === 'Escape' && selection.size > 0) {
        event.preventDefault()
        selection.clear()
        return
      }

      switch (actionOf('library', event) ?? '') {
        case 'library.selectAll':
          event.preventDefault()
          selection.selectAll()
          break

        // Both delete keys: forward-delete, and the backspace-position one that
        // also reports itself as "delete" on Apple keyboards.
        case 'library.trash':
          if (selection.size === 0) break
          event.preventDefault()
          // No dialog on the keystroke: pressing delete is already the decision,
          // and the system Trash is the undo. The bar's button still asks.
          void trashSelected(false)
          break

        case 'library.search':
          event.preventDefault()
          document.querySelector<HTMLInputElement>('.toolbar__search')?.focus()
          break

        case 'library.filters':
          event.preventDefault()
          document.querySelector<HTMLButtonElement>('.toolbar__sort')?.click()
          break

        case 'library.kindAll':
          setKind('all')
          break
        case 'library.kindImages':
          setKind('image')
          break
        case 'library.kindVideos':
          setKind('video')
          break

        case 'app.shortcuts':
          event.preventDefault()
          setShowKeys(true)
          break

        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, openIndex, roomItem, selection, trashSelected])
  const [shuffle, setShuffle] = useState(false)
  const historyRef = useRef<ShuffleHistory>(emptyHistory)

  // Indices only mean anything against one result set, so a changed query
  // invalidates the shuffle history entirely.
  useEffect(() => {
    historyRef.current = emptyHistory
  }, [filters])

  // Entering shuffle from a normal browse should continue from where you are,
  // not jump somewhere unrelated.
  useEffect(() => {
    if (shuffle && openIndex !== null && historyRef.current.items.length === 0) {
      historyRef.current = startHistory(openIndex)
    }
  }, [shuffle, openIndex])

  const navigate = useCallback(
    (delta: number) => {
      if (watchingAlong) {
        setControlNudge((n) => n + 1)
        return
      }

      if (shuffle) {
        // Shuffle keeps its own back/forward history so "previous" returns to
        // what was actually played rather than rolling a new number.
        const next =
          delta > 0
            ? advance(historyRef.current, view.total, undefined, kindCandidates.current ?? undefined)
            : retreat(historyRef.current)
        historyRef.current = next

        const index = currentIndex(next)
        if (index === null) return

        view.ensureRange(Math.max(0, index - 2), index + 2)
        setOpenIndex(index)
        return
      }

      setOpenIndex((current) => {
        if (current === null) return null
        const next = current + delta
        if (next < 0 || next >= view.total) return current
        // Make sure the neighbouring page is loaded before we land on it.
        view.ensureRange(Math.max(0, next - 2), next + 2)
        return next
      })
    },
    [view, shuffle, watchingAlong],
  )

  /** Jumps straight to a random item, opening the viewer if it isn't already. */
  /** Opens a random item of `wanted` kind from what the grid is showing. */
  const randomOf = useCallback((wanted: PlaybackPrefs['randomKind']) => {
    if (watchingAlong) {
      setControlNudge((n) => n + 1)
      return
    }

    const open = (index: number): void => {
      // Append rather than restart: pressing Random repeatedly should keep
      // avoiding what it just showed you, and should still be able to step back
      // through it.
      const items = [...historyRef.current.items, index].slice(-HISTORY_LIMIT)
      historyRef.current = { items, pos: items.length - 1 }
      view.ensureRange(Math.max(0, index - 2), index + 2)
      setOpenIndex(index)
    }

    if (wanted === 'all' || filters.kind === wanted) {
      const index = pickRandomIndex(view.total, { recent: historyRef.current.items })
      if (index !== null) open(index)
      return
    }

    // Narrowed to videos or images: the candidates are where those sit in what
    // the grid is showing, so a random pick still respects the folder, tag or
    // search being browsed.
    void (async () => {
      const [all, ofKind] = await Promise.all([
        view.allIds(),
        window.goonlib.library.ids({ ...filters, kind: wanted }),
      ]).catch((): [number[], number[]] => [[], []])

      const position = new Map(all.map((id, index) => [id, index]))
      const candidates = ofKind
        .map((id) => position.get(id))
        .filter((index): index is number => index !== undefined)

      const index = pickRandomFrom(candidates, { recent: historyRef.current.items })
      if (index !== null) open(index)
    })()
  }, [view, watchingAlong, filters])

  const openRandom = useCallback(
    () => randomOf(playback.randomKind),
    [randomOf, playback.randomKind],
  )

  /**
   * Right-clicking Random: remember what it picks from, and go straight to
   * one — choosing "videos" and then having to click again would be a step
   * nobody wants.
   */
  const chooseRandomKind = useCallback((randomKind: PlaybackPrefs['randomKind']) => {
    setPlayback((current) => ({ ...current, randomKind }))
    void window.goonlib.playback.setPrefs({ randomKind }).catch(() => undefined)
  }, [])

  /**
   * Where the chosen kind sits in the grid, for shuffle to pick its next item
   * from. Null when shuffle can take anything — no narrowing, or the grid is
   * already showing only that kind. Worked out ahead of time, since "next"
   * has to answer at once and the ids are a round trip away.
   */
  const kindCandidates = useRef<number[] | null>(null)
  useEffect(() => {
    const wanted = playback.randomKind
    kindCandidates.current = null
    if (wanted === 'all' || filters.kind === wanted) return

    let live = true
    void Promise.all([view.allIds(), window.goonlib.library.ids({ ...filters, kind: wanted })])
      .then(([all, ofKind]) => {
        if (!live) return
        const position = new Map(all.map((id, index) => [id, index]))
        kindCandidates.current = ofKind
          .map((id) => position.get(id))
          .filter((index): index is number => index !== undefined)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- view.total stands in
    // for the view: a new list of the same length is the same list here.
  }, [playback.randomKind, filters, view.total])

  const openItem = openIndex === null ? undefined : view.itemAt(openIndex)

  const viewerItem = openItem ?? (openIndex === null ? (roomItem ?? undefined) : undefined)

  useEffect(() => {
    if (openIndex !== null) setRoomItem(null)
  }, [openIndex])

  const closeViewer = useCallback(() => {
    setOpenIndex(null)
    setRoomItem(null)
    // Whatever was watched has probably moved, or joined, the row.
    setContinueKey((key) => key + 1)
  }, [])

  /** Opening from the grid or a menu, which watching along only allows for what is already playing. */
  const openAt = useCallback(
    (index: number) => {
      if (watchingAlong && view.itemAt(index)?.id !== cowatch.session.playback.mediaId) {
        setControlNudge((n) => n + 1)
        return
      }
      setOpenIndex(index)
    },
    [watchingAlong, view, cowatch.session.playback.mediaId],
  )
  const openAtRef = useRef(openAt)
  openAtRef.current = openAt

  // --- co-watching ---------------------------------------------------------

  // Read through refs inside the effects below. The room's state is what those
  // effects compare against, but depending on it would re-run them on every
  // heartbeat and every message anyone sends.
  const roomRef = useRef(cowatch.session.playback)
  roomRef.current = cowatch.session.playback
  const inControlRef = useRef(cowatch.session.control.inControl)
  inControlRef.current = cowatch.session.control.inControl
  const openIndexRef = useRef(openIndex)
  openIndexRef.current = openIndex
  const sharing = cowatch.session.active
  const inControl = cowatch.session.control.inControl
  const roomMediaId = cowatch.session.playback.mediaId

  /**
   * While in control, opening something here opens it for everyone.
   *
   * Guarded against the room's own echo — the viewer landing on what the room
   * is already on must not re-open it and reset everybody to zero — and
   * against a page still loading, which leaves nothing on screen for a moment
   * and must not read as closing the viewer.
   */
  useEffect(() => {
    if (!sharing || !inControlRef.current) return

    if (viewerItem) {
      if (roomRef.current.mediaId !== viewerItem.id) {
        cowatch.intent({ kind: 'open', mediaId: viewerItem.id })
      }
    } else if (openIndexRef.current === null && roomRef.current.mediaId !== null) {
      cowatch.intent({ kind: 'close' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the room is read
    // through refs on purpose; this should fire when the viewer moves, not
    // when the room does.
  }, [sharing, viewerItem?.id])

  /** Moves this viewer onto whatever the room is on, finding it if the grid has not loaded it. */
  const followRoom = useCallback((mediaId: number) => {
    const index = viewRef.current.indexOf(mediaId)
    if (index !== null) {
      setOpenIndex(index)
      return
    }

    void (async () => {
      const ids = await viewRef.current.allIds().catch((): number[] => [])
      if (roomRef.current.mediaId !== mediaId) return

      const at = ids.indexOf(mediaId)
      if (at >= 0) {
        viewRef.current.ensureRange(Math.max(0, at - 2), at + 2)
        setOpenIndex(at)
        return
      }

      // Not in what this grid is showing at all. Show it anyway: the session
      // is about watching the same thing, not about what is being browsed.
      const item = await window.goonlib.library.get(mediaId).catch(() => null)
      if (!item || roomRef.current.mediaId !== mediaId) return
      setOpenIndex(null)
      setRoomItem(item)
    })()
  }, [])

  /**
   * And the room moves this viewer.
   *
   * In control, the room only moves because this screen moved it, so following
   * it would just chase our own echo — except at the moment control arrives,
   * when whatever the last controller left on is worth catching up to. Watching
   * along, the viewer follows every move, and is pulled back if it strays.
   */
  const lastRoomId = useRef<number | null>(null)
  const wasInControl = useRef(inControl)
  useEffect(() => {
    const moved = lastRoomId.current !== roomMediaId
    const gainedControl = inControl && !wasInControl.current
    lastRoomId.current = roomMediaId
    wasInControl.current = inControl

    if (!sharing) return
    if (inControl && !gainedControl) return
    if (!moved && !gainedControl && viewerItem === undefined) return

    if (roomMediaId === null) {
      if (moved && viewerItem) closeViewer()
      return
    }

    if (viewerItem?.id !== roomMediaId) followRoom(roomMediaId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- followRoom and
    // closeViewer are stable
  }, [sharing, roomMediaId, inControl, viewerItem?.id])

  const coWatchPlayer = useMemo(
    () =>
      sharing
        ? {
            playback: cowatch.session.playback,
            inControl,
            onIntent: cowatch.intent,
            onReady: cowatch.ready,
          }
        : undefined,
    [sharing, inControl, cowatch.session.playback, cowatch.intent, cowatch.ready],
  )

  // --- collections ---------------------------------------------------------

  const selectCollection = useCallback((id: number | null) => {
    setCollectionId(id)
    // Choosing a collection means you want to look at media, not at the dupe report.
    if (id !== null) setMode('library')
    // Folder, collection, and tag are alternative ways of narrowing the same
    // library; leaving a stale one selected would silently intersect them.
    setLocation(null)
    setTagId(null)
    setFavorites(false)
    setOpenIndex(null)
    // Entering a collection shows the order the user arranged; leaving it returns
    // to the library's default, since 'manual' has nothing to sort by out there.
    setSort(id === null ? 'added' : 'manual')
  }, [])

  const createCollection = useCallback(
    (name: string) =>
      void guard(async () => {
        const created = await window.goonlib.collections.create(name)
        await refreshSidebar()
        setCollectionId(created.id)
      }),
    [guard, refreshSidebar],
  )

  const renameCollection = useCallback(
    (id: number, name: string) =>
      void guard(async () => {
        await window.goonlib.collections.rename(id, name)
        await refreshSidebar()
      }),
    [guard, refreshSidebar],
  )

  const deleteCollection = useCallback(
    (collection: Collection) =>
      void guard(async () => {
        await window.goonlib.collections.remove(collection.id)
        if (collectionId === collection.id) setCollectionId(null)
        await refreshSidebar()
        view.refresh()
      }),
    [guard, refreshSidebar, collectionId, view],
  )

  const addToCollection = useCallback(
    (target: { id: number } | { name: string }, mediaId: number) =>
      guard(async () => {
        const id = 'id' in target ? target.id : (await window.goonlib.collections.create(target.name)).id
        await window.goonlib.collections.add(id, [mediaId])
        await refreshSidebar()
      }),
    [guard, refreshSidebar],
  )

  /** Takes one item out of one collection, from the viewer's menu. */
  const leaveCollection = useCallback(
    (targetId: number, mediaId: number) =>
      guard(async () => {
        await window.goonlib.collections.removeItems(targetId, [mediaId])
        await refreshSidebar()
        // Only the collection on screen changes what the grid shows.
        if (targetId === collectionId) view.refresh()
      }),
    [guard, refreshSidebar, collectionId, view],
  )

  const removeFromCollection = useCallback(
    (mediaId: number) =>
      void guard(async () => {
        if (collectionId === null) return
        await window.goonlib.collections.removeItems(collectionId, [mediaId])
        await refreshSidebar()
        view.refresh()
      }),
    [guard, refreshSidebar, collectionId, view],
  )

  // --- tags -----------------------------------------------------------------

  const selectTag = useCallback((id: number | null) => {
    setTagId(id)
    if (id !== null) setMode('library')
    setLocation(null)
    setCollectionId(null)
    setFavorites(false)
    setOpenIndex(null)
    // 'manual' order belongs to collections; a tag has no arrangement of its own.
    setSort('added')
  }, [])

  // --- favorites ------------------------------------------------------------

  /** Favorites is one more way of narrowing the library, alongside the rest. */
  const selectFavorites = useCallback(() => {
    setFavorites(true)
    setMode('library')
    setLocation(null)
    setCollectionId(null)
    setTagId(null)
    setOpenIndex(null)
    setSort('added')
  }, [])

  /**
   * Hearts or un-hearts items, from a card, the viewer, or the selection bar.
   *
   * Refreshing the view is what redraws the heart: the grid and the viewer both
   * read `favoritedAt` off the loaded rows, so there is no second copy of the
   * state to keep in step. In the Favorites view the same refresh drops an
   * un-hearted item out, the way trashing one does.
   */
  /**
   * Bumped whenever a favourite changes. The selection bar's heart reads how
   * many of the selection are favourites, and favouriting does not change the
   * selection - so without this the count it holds would never be re-read, and
   * the button would keep pointing the way it did before the click.
   */
  const [favoriteKey, setFavoriteKey] = useState(0)

  const changeFavorite = useCallback(
    (mediaIds: number[], favorite: boolean) =>
      guard(async () => {
        await window.goonlib.media.favorite(mediaIds, favorite)
        setFavoriteKey((key) => key + 1)
        view.refresh()
        await refreshSidebar()
      }),
    [guard, view, refreshSidebar],
  )

  const toggleFavorite = useCallback(
    (item: MediaItem) => void changeFavorite([item.id], item.favoritedAt === null),
    [changeFavorite],
  )

  const favoriteSelected = useCallback(
    (favorite: boolean) => {
      if (selection.size === 0) return
      const ids = [...selection.ids]
      // Un-hearting inside Favorites removes those rows from the list, and a
      // selection pointing at rows that are no longer there is exactly the
      // hidden state the filter-change effect exists to prevent.
      if (!favorite && favorites) selection.clear()
      void changeFavorite(ids, favorite)
    },
    [selection, favorites, changeFavorite],
  )

  const createTag = useCallback(
    (name: string) =>
      void guard(async () => {
        const created = await window.goonlib.tags.create(name)
        await refreshSidebar()
        setTagId(created.id)
      }),
    [guard, refreshSidebar],
  )

  const renameTag = useCallback(
    (id: number, name: string) =>
      void guard(async () => {
        // Renaming onto an existing name merges the two, so the surviving tag
        // may not be the one that was being edited — follow it, or the sidebar
        // would be left pointing at a tag that no longer exists.
        const survivor = await window.goonlib.tags.rename(id, name)
        await refreshSidebar()
        setTagId((current) => (current === id ? survivor.id : current))
        view.refresh()
      }),
    [guard, refreshSidebar, view],
  )

  const deleteTag = useCallback(
    (tag: Tag) =>
      void guard(async () => {
        await window.goonlib.tags.remove(tag.id)
        if (tagId === tag.id) setTagId(null)
        await refreshSidebar()
        view.refresh()
      }),
    [guard, refreshSidebar, tagId, view],
  )

  /**
   * Attaches or detaches a tag on one item, from the viewer's label strip.
   *
   * Awaited rather than fired-and-forgotten: the viewer re-reads the item's
   * labels once this resolves, and doing that before the write lands would show
   * the old set.
   */
  /**
   * Filing everything selected. The single-item handlers above are what a
   * right-click menu means; these are what the selection bar means, and the
   * IPC underneath has always taken a list.
   */
  const addSelectionToCollection = useCallback(
    (target: { id: number } | { name: string }) =>
      guard(async () => {
        const ids = [...selection.ids]
        if (ids.length === 0) return
        const id = 'id' in target ? target.id : (await window.goonlib.collections.create(target.name)).id
        await window.goonlib.collections.add(id, ids)
        await refreshSidebar()
        view.refresh()
      }),
    [guard, refreshSidebar, selection, view],
  )

  const addSelectionToTag = useCallback(
    (target: { id: number } | { name: string }) =>
      guard(async () => {
        const ids = [...selection.ids]
        if (ids.length === 0) return
        const id = 'id' in target ? target.id : (await window.goonlib.tags.create(target.name)).id
        await window.goonlib.tags.assign(id, ids)
        await refreshSidebar()
        view.refresh()
      }),
    [guard, refreshSidebar, selection, view],
  )

  const toggleTagOnMedia = useCallback(
    (target: { id: number } | { name: string }, mediaId: number, attached: boolean) =>
      guard(async () => {
        const id = 'id' in target ? target.id : (await window.goonlib.tags.create(target.name)).id

        if (attached) await window.goonlib.tags.unassign(id, [mediaId])
        else await window.goonlib.tags.assign(id, [mediaId])

        await refreshSidebar()
        // A tag filter is showing exactly the set this just changed.
        if (tagId !== null) view.refresh()
      }),
    [guard, refreshSidebar, tagId, view],
  )

  /** The shortcuts card, opened with its own key and closed with Escape. */
  const [showKeys, setShowKeys] = useState(false)

  /** Bumped to re-read Continue watching: after the viewer closes, and after a clear. */
  const [continueKey, setContinueKey] = useState(0)

  /** Where the right-click menu is open, and on what. */
  const [menuAt, setMenuAt] = useState<MenuAt | null>(null)

  const showContextMenu = useCallback(
    (mediaId: number, x: number, y: number) => setMenuAt({ mediaId, x, y }),
    [],
  )

  // The item the menu is about, fetched rather than taken from the grid: the
  // menu outlives a page of results, and needs the item's current favourite.
  const [menuItem, setMenuItem] = useState<MediaItem | null>(null)
  useEffect(() => {
    if (!menuAt) {
      setMenuItem(null)
      return
    }
    let live = true
    void window.goonlib.library
      .get(menuAt.mediaId)
      .then((item) => live && setMenuItem(item))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [menuAt])

  const reorder = useCallback(
    (fromIndex: number, toIndex: number) =>
      void guard(async () => {
        if (collectionId === null) return
        const moved = view.itemAt(fromIndex)
        if (!moved) return
        await window.goonlib.collections.move(collectionId, moved.id, toIndex)
        view.refresh()
      }),
    [guard, collectionId, view],
  )

  return (
    <div className="app">
      <Sidebar
        scanning={scanning}
        onRescan={rescan}
        roots={roots}
        stats={stats}
        busy={busy}
        location={location}
        collections={collections}
        collectionId={collectionId}
        tags={tags}
        tagId={tagId}
        favorites={favorites}
        onSelectFavorites={selectFavorites}
        mode={mode}
        onSelectMode={setMode}
        onAddRoot={() => void addRoot()}
        onRemoveRoot={removeRoot}
        onToggleRoot={toggleRoot}
        onFolderMenu={(rootId, path, name, x, y) => setFolderMenuAt({ rootId, path, name, x, y })}
        onChanged={() => {
          void refreshSidebar()
          view.refresh()
        }}
        onSelectFolder={(next) => {
          setLocation(next)
          // Picking a folder means leaving the collection, tag and favorites views.
          setCollectionId(null)
          setTagId(null)
          setFavorites(false)
        }}
        onSelectCollection={selectCollection}
        onCreateCollection={createCollection}
        onRenameCollection={renameCollection}
        onDeleteCollection={deleteCollection}
        onSelectTag={selectTag}
        onCreateTag={createTag}
        onRenameTag={renameTag}
        onDeleteTag={deleteTag}
        // Someone at the door is the one thing worth jumping straight to.
        onShowShortcuts={() => setShowKeys(true)}
        onOpenSettings={() =>
          openSettings(cowatch.session.knocking.length > 0 ? 'together' : undefined)
        }
        sharing={sharing}
        knocking={cowatch.session.knocking.length}
        // A toy actually connected, as everywhere else — not merely an engine
        // running, which lit the gear with nothing attached to it.
        toyLive={toy.live}
        toyStopped={!toy.status.armed}
      />

      <main className="content">
        {mode === 'library' ? (
          <>
            <Toolbar
              search={searchText}
              onSearchChange={setSearchText}
              kind={kind}
              onKindChange={setKind}
              sort={sort}
              onSortChange={chooseSort}
              total={view.total}
              totalBytes={view.totalBytes}
              allowManualSort={collectionId !== null}
              filters={chosen}
              onFiltersChange={setChosen}
              tags={tags}
              toy={toy}
              scraping={
                scrape?.phase === 'fetching' || scrape?.phase === 'downloading'
              }
              onScrape={startScrape}
            />

            <Breadcrumb location={location} roots={roots} onNavigate={setLocation} />
          </>
        ) : null}

        {scrape ? (
          <ScrapeBar
            progress={scrape}
            onCancel={() => void guard(() => window.goonlib.scrape.cancel())}
            onDismiss={() => setScrape(null)}
          />
        ) : null}

        {progress ? <ScanBar progress={progress} onCancel={cancelScan} /> : null}

        {error ? (
          <div className="banner banner--error" role="alert">
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="banner banner--info" role="status">
            {notice}
          </div>
        ) : null}

        {mode === 'library' && selection.size > 0 ? (
          <SelectionBar
            selection={selection}
            total={view.total}
            busy={trashing}
            onTrash={() => void trashSelected(true)}
            onMove={() => void moveSelected()}
            onFavorite={favoriteSelected}
            favoriteKey={favoriteKey}
            collections={collections}
            tags={tags}
            onAddToCollection={addSelectionToCollection}
            onAddToTag={addSelectionToTag}
          />
        ) : null}

        {/* Only the plain library: a narrowed view is a search for something
            particular, and this row would be in the way of it. */}
        {mode === 'library' &&
        playback.showContinue &&
        playback.resumePosition &&
        !narrowed &&
        collectionId === null &&
        tagId === null &&
        !favorites &&
        location === null &&
        search === '' &&
        // Videos have to be among what the grid is showing, since that is how
        // the viewer opens one.
        kind !== 'image' ? (
          <ContinueRow
            refreshKey={continueKey}
            count={playback.continueCount}
            onOpen={(mediaId) => {
              const index = view.indexOf(mediaId)
              if (index !== null) openAt(index)
            }}
            onContextMenu={showContextMenu}
            onToggleFavorite={toggleFavorite}
          />
        ) : null}

        {mode === 'library' ? (
          <MediaGrid
            view={view}
            hasRoots={roots.length > 0}
            scanning={scanning}
            // Only when nothing else is narrowing: a search inside a collection
            // that finds nothing really is "nothing matches".
            emptyKind={
              search !== '' || countFilters(chosen) > 0
                ? null
                : collectionId !== null
                  ? {
                      kind: 'collection',
                      name: collections.find((entry) => entry.id === collectionId)?.name ?? 'This collection',
                    }
                  : tagId !== null
                    ? { kind: 'tag', name: tags.find((entry) => entry.id === tagId)?.name ?? 'This tag' }
                    : null
            }
            onOpen={openAt}
            selection={selection}
            // Reordering only makes sense against a hand-set order, so it's off
            // once the user sorts by name, size, or date.
            reorderable={collectionId !== null && effectiveSort === 'manual'}
            onReorder={reorder}
            onContextMenu={showContextMenu}
            onToggleFavorite={toggleFavorite}
          />
        ) : (
          <Duplicates
            onChanged={() => {
              void refreshSidebar()
              view.refresh()
            }}
          />
        )}
      </main>

      {viewerItem ? (
        <Lightbox
          playback={playback}
          onPlaybackChange={changePlayback}
          onVolumeChange={changeVolume}
          item={viewerItem}
          index={openIndex ?? -1}
          total={view.total}
          collections={collections}
          activeCollectionId={collectionId}
          onClose={closeViewer}
          onNavigate={navigate}
          onAddToCollection={addToCollection}
          onLeaveCollection={leaveCollection}
          onRemoveFromCollection={removeFromCollection}
          onContextMenu={showContextMenu}
          onTrash={trashOne}
          onToggleFavorite={toggleFavorite}
          tags={tags}
          onToggleTag={toggleTagOnMedia}
          shuffle={shuffle}
          onShuffleChange={setShuffle}
          onRandomKind={chooseRandomKind}
          onRandom={openRandom}
          coWatch={coWatchPlayer}
          upNext={
            sharing
              ? {
                  queue: cowatch.session.queue,
                  canPlay: inControl,
                  onPlay: (mediaId) => cowatch.intent({ kind: 'open', mediaId }),
                  onRemove: (index) =>
                    cowatch.setQueue(cowatch.session.queue.filter((_, at) => at !== index)),
                }
              : undefined
          }
          waitingFor={cowatch.session.playback.waiting ? cowatch.session.playback.waitingFor : []}
          toy={toy}
        />
      ) : null}

      {/* Reactions land wherever you are, not only inside the viewer — the
          point of them is that someone else is there. */}
      {cowatch.reactions.length > 0 ? (
        <div className="reactions" aria-hidden="true">
          {cowatch.reactions.map((reaction) => (
            <span key={reaction.id} className="reactions__one">
              {COWATCH_REACTIONS.find((known) => known.id === reaction.emoji)?.glyph ?? '*'}
              <span className="reactions__from">{reaction.from}</span>
            </span>
          ))}
        </div>
      ) : null}

      {/* Above the viewer rather than inside it: a session outlives whatever
          is on screen, and talking should not mean closing the film. */}
      {sharing ? (
        <CoWatchBar
          cowatch={cowatch}
          nudge={controlNudge}
          onOpenPanel={() => openSettings('together')}
        />
      ) : null}

      {sheetTab !== null ? (
        <SettingsSheet
          playback={playback}
          onPlaybackChange={changePlayback}
          toy={toy}
          cowatch={cowatch}
          tab={sheetTab}
          onSelectTab={chooseSheetTab}
          onClose={() => setSheetTab(null)}
          onOpenDuplicates={() => {
            setSheetTab(null)
            setMode('duplicates')
          }}
          onChanged={() => {
            // Auto-sorting creates collections as it runs, so the sidebar is
            // stale the moment a classification pass starts.
            void refreshSidebar()
            setContinueKey((key) => key + 1)
            view.refresh()
          }}
        />
      ) : null}

      {showKeys ? <ShortcutsCard onClose={() => setShowKeys(false)} /> : null}

      {folderMenuAt ? (
        <FolderMenu
          at={folderMenuAt}
          roots={roots.filter((root) => root.enabled)}
          onClose={() => setFolderMenuAt(null)}
          onChanged={() => {
            void refreshSidebar()
            view.refresh()
          }}
          onMessage={setError}
        />
      ) : null}

      {menuAt ? (
        <MediaMenu
          at={menuAt}
          item={menuItem}
          roots={roots.filter((root) => root.enabled)}
          onMessage={setError}
          collections={collections}
          tags={tags}
          activeCollection={collections.find((entry) => entry.id === collectionId) ?? null}
          onClose={() => setMenuAt(null)}
          onOpen={(mediaId: number) => {
            const index = view.indexOf(mediaId)
            if (index !== null) openAt(index)
          }}
          onFavorite={(mediaId: number, favorite: boolean) => void changeFavorite([mediaId], favorite)}
          onAddToCollection={addToCollection}
          onLeaveCollection={leaveCollection}
          onToggleTag={toggleTagOnMedia}
          onChanged={() => {
            void refreshSidebar()
            view.refresh()
          }}
        />
      ) : null}
    </div>
  )
}

/** What an undo or redo of a Delete did, in one line. */
function trashNotice(undo: boolean, result: TrashUndoResult): string {
  const files = (count: number): string => (count === 1 ? '1 file' : `${count} files`)
  if (result.moved === 0 && result.failed === 0) {
    return undo ? 'Nothing to undo' : 'Nothing to redo'
  }
  const done = undo
    ? `Put back ${files(result.moved)} from the ${TRASH_NAME}`
    : `Moved ${files(result.moved)} to the ${TRASH_NAME} again`
  if (result.failed === 0) return done
  // Windows never reports where the Recycle Bin put a file, so undo cannot find
  // it again. Saying it is gone or replaced would be wrong: it is right there,
  // waiting to be put back by hand.
  const missed = !undo
    ? `${files(result.failed)} could not be trashed again`
    : IS_WINDOWS
      ? `${files(result.failed)} stayed in the ${TRASH_NAME} - Windows does not say where it put them, so put those back from there`
      : `${files(result.failed)} could not be put back - gone from the ${TRASH_NAME}, or replaced`
  return result.moved > 0 ? `${done}. ${missed}.` : `${missed[0]!.toUpperCase()}${missed.slice(1)}.`
}

/** Remembered per machine, so Settings reopens on the tab last used. */
const SHEET_TAB_KEY = 'goonlib.settingsTab'

const SHEET_TABS: readonly SheetTab[] = [
  'app',
  'backup',
  'shortcuts',
  'styling',
  'controls',
  'solo',
  'patterns',
  'together',
  'providers',
  'tagging',
  'duplicates',
]

function lastSheetTab(): SheetTab {
  try {
    const value = localStorage.getItem(SHEET_TAB_KEY)
    return SHEET_TABS.includes(value as SheetTab) ? (value as SheetTab) : 'controls'
  } catch {
    return 'controls'
  }
}
