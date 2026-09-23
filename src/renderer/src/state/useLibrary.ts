import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MediaItem, MediaQuery } from '@shared/types'

/**
 * Windowed access to the library.
 *
 * The grid can be showing row 90,000 of a 150,000-item library, so nothing is ever
 * loaded wholesale. Items arrive one page at a time as the viewport asks for them,
 * keyed by absolute index, and a query change throws the window away.
 */

const PAGE_SIZE = 120

export type LibraryFilters = Omit<MediaQuery, 'limit' | 'offset'>

export interface LibraryView {
  total: number
  /** Combined size of everything in `total`, in bytes. */
  totalBytes: number
  loaded: boolean
  error: string | null
  itemAt(index: number): MediaItem | undefined
  /**
   * Position of an item in the current result set, or null if it isn't in the
   * loaded window. Only pages that have been fetched are searched — enough for
   * acting on something the user can see, which is the only case that arises.
   */
  indexOf(mediaId: number): number | null
  ensureRange(startIndex: number, endIndex: number): void
  /**
   * Every id in the current result set, in grid order.
   *
   * Selection can span items the grid has never loaded — shift-clicking across
   * ten thousand rows, or selecting everything — and `itemAt` can only answer
   * for pages that have arrived. Fetched once per query and cached, since the
   * answer only changes when the query does.
   */
  allIds(): Promise<number[]>
  /** Re-fetches loaded pages in place, without blanking the grid. */
  refresh(): void
}

export function useLibrary(filters: LibraryFilters): LibraryView {
  const key = useMemo(() => JSON.stringify(filters), [filters])

  const [total, setTotal] = useState(0)
  const [totalBytes, setTotalBytes] = useState(0)
  const [items, setItems] = useState<ReadonlyMap<number, MediaItem>>(() => new Map())
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Page bookkeeping lives in a ref: mutating it must not itself cause a render.
  const state = useRef({
    key,
    filters,
    inFlight: new Set<number>(),
    done: new Set<number>(),
    lastRange: [0, 0] as [number, number],
    // Cached per query key, and held as the promise rather than the result so
    // that several selections racing at once share one round trip.
    ids: null as { key: string; promise: Promise<number[]> } | null,
  })
  state.current.filters = filters

  const loadPage = useCallback(async (page: number): Promise<void> => {
    const current = state.current
    if (current.inFlight.has(page) || current.done.has(page)) return

    const requestKey = current.key
    current.inFlight.add(page)

    try {
      const result = await window.goonlib.library.list({
        ...current.filters,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })

      // The query changed while this was in flight — its rows belong to a window
      // that no longer exists.
      if (state.current.key !== requestKey) return

      current.done.add(page)
      setTotal(result.total)
      setTotalBytes(Number(result.totalBytes) || 0)
      setItems((previous) => {
        const next = new Map(previous)
        result.items.forEach((item, offset) => next.set(page * PAGE_SIZE + offset, item))
        return next
      })
      setError(null)
      setLoaded(true)
    } catch (err) {
      if (state.current.key !== requestKey) return
      setError(err instanceof Error ? err.message : String(err))
      setLoaded(true)
    } finally {
      current.inFlight.delete(page)
    }
  }, [])

  const ensureRange = useCallback(
    (startIndex: number, endIndex: number): void => {
      state.current.lastRange = [startIndex, endIndex]

      const firstPage = Math.max(0, Math.floor(startIndex / PAGE_SIZE))
      const lastPage = Math.floor(Math.max(startIndex, endIndex) / PAGE_SIZE)

      for (let page = firstPage; page <= lastPage; page += 1) void loadPage(page)
    },
    [loadPage],
  )

  // A new query invalidates the whole window.
  useEffect(() => {
    state.current.key = key
    state.current.inFlight.clear()
    state.current.done.clear()

    setItems(new Map())
    setTotal(0)
    setTotalBytes(0)
    setLoaded(false)

    void loadPage(0)

    // Whatever the grid was showing, reload the pages under it too.
    const [start, end] = state.current.lastRange
    if (end > 0) ensureRange(start, end)
  }, [key, loadPage, ensureRange])

  /**
   * Marks loaded pages stale and re-fetches the visible ones. Existing rows stay
   * on screen until their replacements arrive, so a scan filling in thumbnails
   * doesn't make the grid flash.
   */
  const refresh = useCallback((): void => {
    state.current.done.clear()
    // Rows may have come or gone — most likely trashed — so the cached id list
    // no longer describes the result set.
    state.current.ids = null
    void loadPage(0)
    const [start, end] = state.current.lastRange
    if (end > 0) ensureRange(start, end)
  }, [loadPage, ensureRange])

  const allIds = useCallback(async (): Promise<number[]> => {
    const current = state.current
    if (current.ids?.key === current.key) return current.ids.promise

    const promise = window.goonlib.library.ids(current.filters)
    current.ids = { key: current.key, promise }

    try {
      return await promise
    } catch (err) {
      // Don't cache a failure: the next attempt should get to try again.
      if (current.ids?.promise === promise) current.ids = null
      throw err
    }
  }, [])

  const itemAt = useCallback((index: number): MediaItem | undefined => items.get(index), [items])

  const indexOf = useCallback(
    (mediaId: number): number | null => {
      for (const [index, item] of items) {
        if (item.id === mediaId) return index
      }
      return null
    },
    [items],
  )

  return { total, totalBytes, loaded, error, itemAt, indexOf, ensureRange, allIds, refresh }
}
