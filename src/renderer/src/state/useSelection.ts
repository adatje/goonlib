import { useCallback, useMemo, useRef, useState } from 'react'
import { rangeBetween } from '../selection'

/**
 * Multi-select over the library grid.
 *
 * Selection is held as media ids rather than grid indices: indices shift the
 * moment a scan adds a file or a sort changes, and this feeds a delete. The
 * anchor — where the last plain selection happened — is an index, because that
 * is what "extend the range to here" is measured against.
 *
 * Resolving a range means asking the library for the ids in it, which is a
 * round trip; `pending` covers the gap so the toolbar can say something rather
 * than appearing to have done nothing.
 */

export interface Selection {
  ids: ReadonlySet<number>
  size: number
  pending: boolean
  has(mediaId: number): boolean
  /** Cmd/Ctrl-click: flip one card, and make it the anchor for later ranges. */
  toggle(mediaId: number, index: number): void
  /** Shift-click: select everything between the anchor and here. */
  extendTo(index: number): void
  selectAll(): void
  clear(): void
}

export interface SelectionSource {
  /** Every id in the current result set, in grid order. */
  allIds(): Promise<number[]>
}

export function useSelection(source: SelectionSource): Selection {
  const [ids, setIds] = useState<ReadonlySet<number>>(() => new Set())
  const [pending, setPending] = useState(false)

  // The anchor is not state: moving it never needs a render of its own, and
  // reading a fresh value inside a callback matters more than re-rendering.
  const anchor = useRef<number | null>(null)

  const toggle = useCallback((mediaId: number, index: number): void => {
    anchor.current = index
    setIds((current) => {
      const next = new Set(current)
      if (next.has(mediaId)) next.delete(mediaId)
      else next.add(mediaId)
      return next
    })
  }, [])

  const extendTo = useCallback(
    (index: number): void => {
      const from = anchor.current
      // Nothing to extend from yet — treat it as the anchor and wait for the
      // next shift-click rather than guessing what range was meant.
      if (from === null) {
        anchor.current = index
        return
      }

      setPending(true)
      void source
        .allIds()
        .then((all) => {
          const span = rangeBetween(all, from, index)
          setIds((current) => new Set([...current, ...span]))
        })
        .catch(() => {
          // The grid surfaces query failures already; a range that could not be
          // resolved simply leaves the selection as it was.
        })
        .finally(() => setPending(false))
    },
    [source],
  )

  const selectAll = useCallback((): void => {
    setPending(true)
    void source
      .allIds()
      .then((all) => setIds(new Set(all)))
      .catch(() => {})
      .finally(() => setPending(false))
  }, [source])

  const clear = useCallback((): void => {
    anchor.current = null
    setIds(new Set())
  }, [])

  const has = useCallback((mediaId: number): boolean => ids.has(mediaId), [ids])

  return useMemo(
    () => ({ ids, size: ids.size, pending, has, toggle, extendTo, selectAll, clear }),
    [ids, pending, has, toggle, extendTo, selectAll, clear],
  )
}
