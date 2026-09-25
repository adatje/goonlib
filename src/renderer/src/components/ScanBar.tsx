import { useEffect, useRef, useState } from 'react'
import type { ScanProgress } from '@shared/types'
import { formatCount } from '../format'

/** How long "all done" stays up before the bar goes away. */
const SETTLE_MS = 3_000

/**
 * The least time the working bar is shown, however quickly the scan is over.
 *
 * On an indexed library a rescan can finish in a few hundred milliseconds -
 * faster than it can be read, so the bar registered as a flicker rather than as
 * work. Holding it briefly is for the person watching, not for the scan.
 */
const MIN_BUSY_MS = 1_000

export interface ScanBarProps {
  progress: ScanProgress
  onCancel: () => void
}

const ACTIVE_PHASES = new Set<ScanProgress['phase']>([
  'walking',
  'probing',
  'thumbnailing',
  'previewing',
  'hashing',
  'classifying',
])

export function ScanBar({ progress, onCancel }: ScanBarProps): React.JSX.Element | null {
  const active = ACTIVE_PHASES.has(progress.phase)

  /*
   * Two holds, both for the reader rather than the scan: the working bar stays
   * up for a moment even if the work is already over, and what it finished with
   * stays up for a few seconds after that.
   */
  const [held, setHeld] = useState(false)
  const [settling, setSettling] = useState<'done' | 'cancelled' | null>(null)
  const startedAt = useRef(0)

  const { phase } = progress

  useEffect(() => {
    if (!active) return
    startedAt.current = Date.now()
    setHeld(true)
    setSettling(null)
  }, [active])

  useEffect(() => {
    if (active || !held) return
    const remaining = Math.max(0, MIN_BUSY_MS - (Date.now() - startedAt.current))
    const timer = setTimeout(() => {
      setHeld(false)
      if (phase === 'done' || phase === 'cancelled') setSettling(phase)
    }, remaining)
    return () => clearTimeout(timer)
  }, [active, held, phase])

  useEffect(() => {
    if (!settling) return
    const timer = setTimeout(() => setSettling(null), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [settling])

  if (!active && !held && progress.phase !== 'error') {
    if (!settling) return null
    return (
      <div className="scanbar scanbar--done" role="status" aria-live="polite">
        <span className="scanbar__tick" aria-hidden="true">
          ✓
        </span>
        <span className="scanbar__label">
          {settling === 'cancelled' ? 'Scan stopped' : 'All sources scanned'}
        </span>
        <span className="scanbar__detail">{finished(progress)}</span>
      </div>
    )
  }

  if (progress.phase === 'error') {
    return (
      <div className="scanbar scanbar--error" role="alert">
        <span className="scanbar__label">Scan failed</span>
        <span className="scanbar__detail">{progress.message}</span>
      </div>
    )
  }

  return (
    <div className="scanbar" role="status" aria-live="polite">
      <span className="scanbar__spinner" aria-hidden="true" />
      <span className="scanbar__label">{describe(progress)}</span>
      <span className="scanbar__detail">{detail(progress)}</span>
      <button type="button" className="scanbar__cancel" onClick={onCancel}>
        Stop
      </button>
    </div>
  )
}

function describe(progress: ScanProgress): string {
  switch (progress.phase) {
    case 'walking':
      return 'Finding files'
    case 'probing':
      return 'Reading metadata'
    case 'thumbnailing':
      return 'Making thumbnails'
    case 'previewing':
      return 'Building previews'
    case 'hashing':
      return 'Fingerprinting'
    case 'classifying':
      return 'Classification'
    default:
      return 'Scanning'
  }
}

function detail(progress: ScanProgress): string {
  const parts: string[] = []

  switch (progress.phase) {
    case 'walking':
      parts.push(`${formatCount(progress.discovered)} found`)
      if (progress.currentRoot) parts.push(progress.currentRoot)
      break
    case 'probing':
      parts.push(`${formatCount(progress.pendingProbe)} to go`)
      break
    case 'thumbnailing':
      parts.push(`${formatCount(progress.pendingThumb)} to go`)
      break
    case 'previewing':
      parts.push(`${formatCount(progress.pendingSprite)} to go`)
      break
    case 'hashing':
      parts.push(`${formatCount(progress.pendingHash)} to go`)
      break
    case 'classifying':
      parts.push(`${formatCount(progress.pendingClassify)} to go`)
      break
    default:
      break
  }

  if (progress.errors > 0) parts.push(`${formatCount(progress.errors)} skipped`)

  return parts.join(' · ')
}

/** What a finished scan found, in one phrase. */
function finished(progress: ScanProgress): string {
  const parts: string[] = []
  if (progress.discovered > 0) parts.push(`${formatCount(progress.discovered)} found`)
  if (progress.thumbed > 0) parts.push(`${formatCount(progress.thumbed)} thumbnailed`)
  if (progress.errors > 0) parts.push(`${formatCount(progress.errors)} failed`)
  return parts.length > 0 ? parts.join(' · ') : 'Nothing new'
}
