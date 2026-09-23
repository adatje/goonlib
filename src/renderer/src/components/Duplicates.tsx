import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DuplicateGroup, DuplicateReport, MediaItem } from '@shared/types'
import { formatBytes, formatCount, formatDuration } from '../format'
import { REVEAL_LABEL, REVEAL_SHORT, TRASH_NAME } from '../platform'
import { markAllButLargest } from '../selection'
import { HeartIcon } from './Toolbar'

export interface DuplicatesProps {
  onChanged: () => void
}

/**
 * Grouped duplicate review.
 *
 * Nothing is ever selected for you. The app will happily tell you which copy is
 * biggest, but choosing what to delete is the user's call — an automatic
 * "keep the best one" would eventually be wrong about somebody's only copy.
 */
export function Duplicates({ onChanged }: DuplicatesProps): React.JSX.Element {
  const [report, setReport] = useState<DuplicateReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setReport(await window.goonlib.duplicates.find())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = useCallback((id: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const groups = useMemo(
    () => (report ? [...report.exact, ...report.near] : []),
    [report],
  )

  const selectedBytes = useMemo(() => {
    // One file can legitimately appear in more than one group — an exact copy of
    // one thing and a near-copy of another — but it only frees its bytes once.
    const counted = new Set<number>()
    let total = 0

    for (const group of groups) {
      for (const item of group.items) {
        if (!selected.has(item.id) || counted.has(item.id)) continue
        counted.add(item.id)
        total += item.size
      }
    }

    return total
  }, [groups, selected])

  const selectAllButLargest = useCallback(
    (within: DuplicateGroup[]) =>
      setSelected((current) => markAllButLargest(current, within, groups)),
    [groups],
  )

  const trashSelected = useCallback(async () => {
    if (selected.size === 0) return
    setBusy(true)
    try {
      const removed = await window.goonlib.media.trash([...selected])
      if (removed > 0) {
        setSelected(new Set())
        await load()
        onChanged()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [selected, load, onChanged])

  if (loading) {
    return (
      <div className="empty">
        <h2 className="empty__title">Looking for duplicates…</h2>
      </div>
    )
  }

  if (error) {
    return (
      <div className="empty" role="alert">
        <h2 className="empty__title">Couldn&apos;t check for duplicates</h2>
        <p className="empty__body">{error}</p>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="empty">
        <h2 className="empty__title">No duplicates found</h2>
        <p className="empty__body">
          {report && report.pending > 0
            ? `${formatCount(report.pending)} items haven't been fingerprinted yet, so this isn't the whole picture. Run a scan to finish.`
            : 'Every file in the library is distinct.'}
        </p>
        <button type="button" className="button" onClick={() => void load()}>
          Re-scan
        </button>
      </div>
    )
  }

  const reclaimable = groups.reduce((total, group) => total + group.reclaimable, 0)

  return (
    <div className="dupes">
      <div className="dupes__bar">
        <div className="dupes__title">
          <h2 className="dupes__heading">Duplicates</h2>
          <span className="dupes__summary">
            <strong>{formatCount(groups.length)}</strong> duplicates found ·{' '}
            <strong>{formatBytes(reclaimable)}</strong> reclaimable
          </span>
        </div>

        {report && report.pending > 0 ? (
          <span className="dupes__warn">
            {formatCount(report.pending)} not yet fingerprinted
          </span>
        ) : null}

        <span className="dupes__spacer" />

        {selected.size > 0 ? (
          <span className="muted">
            {formatCount(selected.size)} selected · {formatBytes(selectedBytes)}
          </span>
        ) : null}

        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          onClick={() => {
            setSelected(new Set())
            void load()
          }}
          title="Look for duplicates again, for anything added or removed since"
        >
          Re-scan
        </button>

        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          onClick={() => selectAllButLargest(groups)}
          title="Marks every copy except the largest in each group, so one of everything is left behind"
        >
          Select all duplicates
        </button>

        {selected.size > 0 ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        ) : null}

        <button
          type="button"
          className="button"
          disabled={selected.size === 0 || busy}
          onClick={() => void trashSelected()}
          title="Moves the selected files to the system Trash after confirmation"
        >
          {busy ? 'Moving…' : `Move selected to ${TRASH_NAME}`}
        </button>
      </div>

      <div className="dupes__list">
        {groups.map((group) => (
          <Group
            key={group.key}
            group={group}
            selected={selected}
            onToggle={toggle}
            // Keep the largest and mark the rest — the common intent, but still
            // only a suggestion the user has to act on.
            onSelectAllButFirst={() => selectAllButLargest([group])}
          />
        ))}
      </div>
    </div>
  )
}

function Group({
  group,
  selected,
  onToggle,
  onSelectAllButFirst,
}: {
  group: DuplicateGroup
  selected: Set<number>
  onToggle: (id: number) => void
  onSelectAllButFirst: () => void
}): React.JSX.Element {
  return (
    <section className="dupe-group">
      <header className="dupe-group__head">
        <span className={group.kind === 'exact' ? 'tag tag--exact' : 'tag tag--near'}>
          {group.kind === 'exact' ? 'identical' : `similar · ${group.distance} bits`}
        </span>
        <span className="muted">
          {group.items.length} copies · {formatBytes(group.reclaimable)} reclaimable
        </span>
        <span className="dupes__spacer" />
        <button type="button" className="button button--quiet" onClick={onSelectAllButFirst}>
          Select all but the largest
        </button>
      </header>

      <div className="dupe-group__items">
        {group.items.map((item, index) => (
          <Candidate
            key={item.id}
            item={item}
            isLargest={index === 0}
            checked={selected.has(item.id)}
            onToggle={() => onToggle(item.id)}
          />
        ))}
      </div>
    </section>
  )
}

function Candidate({
  item,
  isLargest,
  checked,
  onToggle,
}: {
  item: MediaItem
  isLargest: boolean
  checked: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <div className={checked ? 'candidate candidate--on' : 'candidate'}>
      <label className="candidate__pick">
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </label>

      <div className="candidate__thumb">
        {item.thumbState === 'done' ? (
          <img src={`media://thumb/${item.id}?m=${item.mtime}`} alt="" loading="lazy" />
        ) : null}
      </div>

      <div className="candidate__info">
        <div className="candidate__name" title={item.relPath}>
          {item.favoritedAt !== null ? (
            // Said here because this screen is where copies get trashed.
            <span className="candidate__heart" title="Favorite - never marked for you">
              <HeartIcon filled size={12} />
            </span>
          ) : null}
          {item.name}
        </div>
        <div className="candidate__meta">
          {formatBytes(item.size)}
          {item.width && item.height ? ` · ${item.width}×${item.height}` : ''}
          {item.durationMs ? ` · ${formatDuration(item.durationMs)}` : ''}
          {isLargest ? ' · largest' : ''}
        </div>
        <div className="candidate__path" title={item.relPath}>
          <bdi>{item.relPath}</bdi>
        </div>
      </div>

      <button
        type="button"
        className="button button--quiet"
        onClick={() => void window.goonlib.media.reveal(item.id)}
        title={REVEAL_LABEL}
      >
        {REVEAL_SHORT}
      </button>
    </div>
  )
}
