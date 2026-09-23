import type { ScanProgress } from '@shared/types'
import { formatCount } from '../format'

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

  if (!active && progress.phase !== 'error') return null

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
