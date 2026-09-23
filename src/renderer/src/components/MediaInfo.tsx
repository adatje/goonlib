import { useEffect, useState } from 'react'
import type { MediaExif, MediaItem, MediaLabel, MediaViews } from '@shared/types'
import { formatBytes, formatDuration } from '../format'

/**
 * The open item's details, in up to two sections: Details (the file, and how
 * it has been watched) and EXIF (what a photo records about itself). Each is
 * switched on in Settings → App. Self-contained, so the viewer can place it
 * wherever suits: it needs only the item and what the viewer already has, and
 * fetches the rest itself.
 */
export function MediaInfo(props: {
  item: MediaItem
  labels?: MediaLabel[]
  caption?: string | null
  /** Show the Details section. */
  details: boolean
  /** Show the EXIF section, for images that have any. */
  exif: boolean
  /** Include where a photo was taken in its EXIF. */
  location: boolean
  className?: string
}): React.JSX.Element | null {
  const { item } = props
  const views = useViews(props.details ? item.id : null)
  const exif = useExif(props.exif && item.kind === 'image' ? item.id : null, props.location)

  const details: Row[] = props.details
    ? [
        ['Name', item.name],
        ['Folder', item.relPath.includes('/') ? item.relPath.slice(0, item.relPath.lastIndexOf('/')) : null],
        ['Type', `${item.ext.replace(/^\./, '').toUpperCase()} ${item.kind}`],
        ['Dimensions', item.width && item.height ? `${item.width} × ${item.height}` : null],
        ['Duration', item.durationMs ? formatDuration(item.durationMs) : null],
        // ffprobe gives stills a frame rate and a "codec" too, which mean nothing for them.
        ['Frame rate', item.kind === 'video' && item.fps ? `${Math.round(item.fps * 100) / 100} fps` : null],
        ['Video', item.kind === 'video' ? item.vcodec : null],
        ['Audio', item.kind === 'video' ? item.acodec : null],
        ['Size', formatBytes(item.size)],
        ['Modified', formatDate(item.mtime)],
        ['Added', formatDate(item.addedAt)],
        ['Favorited', item.favoritedAt !== null ? formatDate(item.favoritedAt) : null],
        [
          'Playback',
          item.playbackTier && item.playbackTier !== 'native'
            ? item.playbackTier === 'remux'
              ? 'Repackaged'
              : 'Converted'
            : null,
        ],
        ['Times viewed', views ? views.viewCount.toLocaleString() : null],
        // Time spent on a still is not watching it, so only videos show it.
        ['Time watched', item.kind === 'video' && views && views.watchMs > 0 ? formatWatched(views.watchMs) : null],
        ['Last viewed', views?.lastViewedAt ? formatDate(views.lastViewedAt) : null],
        ['Labels', props.labels && props.labels.length > 0 ? props.labels.map((label) => label.label).join(', ') : null],
        ['Caption', props.caption ?? null],
      ]
    : []

  const camera = exif ? [exif.make, exif.model].filter(Boolean).join(' ') : ''
  const exifRows: Row[] = exif
    ? [
        ['Camera', camera || null],
        ['Lens', exif.lens],
        ['Taken', exif.takenAt ? formatDate(exif.takenAt) : null],
        ['Exposure', exif.exposure],
        ['Aperture', exif.aperture],
        ['ISO', exif.iso !== null ? String(exif.iso) : null],
        ['Focal length', exif.focalLength],
        ['Flash', exif.flash],
        ['Software', exif.software],
        [
          'Location',
          props.location && exif.location
            ? `${exif.location.latitude.toFixed(5)}, ${exif.location.longitude.toFixed(5)}`
            : null,
        ],
      ]
    : []

  const shownDetails = present(details)
  const shownExif = present(exifRows)
  if (shownDetails.length === 0 && shownExif.length === 0) return null

  return (
    <aside className={['mediainfo', props.className].filter(Boolean).join(' ')} aria-label="Details">
      {shownDetails.length > 0 ? <Section title="Meta" rows={shownDetails} /> : null}
      {shownExif.length > 0 ? <Section title="EXIF" rows={shownExif} /> : null}
    </aside>
  )
}

type Row = [string, string | null]

function present(rows: Row[]): Array<[string, string]> {
  return rows.filter((row): row is [string, string] => row[1] !== null && row[1] !== '')
}

function Section(props: { title: string; rows: Array<[string, string]> }): React.JSX.Element {
  return (
    <section className="mediainfo__section">
      <h3 className="mediainfo__title">{props.title}</h3>
      <dl className="mediainfo__list">
        {props.rows.map(([name, value]) => (
          <div key={name} className="mediainfo__row">
            <dt>{name}</dt>
            <dd title={value}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** The item's viewing history, or null while it loads or when not wanted. */
function useViews(mediaId: number | null): MediaViews | null {
  const [views, setViews] = useState<MediaViews | null>(null)
  useEffect(() => {
    setViews(null)
    if (mediaId === null) return
    let current = true
    void window.goonlib.media
      .views(mediaId)
      .then((next) => current && setViews(next))
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [mediaId])
  return views
}

/** A photo's EXIF, or null while it loads, when it has none, or when not wanted. */
function useExif(mediaId: number | null, location: boolean): MediaExif | null {
  const [exif, setExif] = useState<MediaExif | null>(null)
  useEffect(() => {
    setExif(null)
    if (mediaId === null) return
    let current = true
    void window.goonlib.media
      .exif(mediaId)
      .then((next) => current && setExif(next))
      .catch(() => undefined)
    return () => {
      current = false
    }
    // Location is re-read when it is switched, since the main process leaves it out when it is off.
  }, [mediaId, location])
  return exif
}

/** A stored timestamp as a date and time; seconds and milliseconds alike. */
function formatDate(timestamp: number): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null
  const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Total time watched, to the largest sensible unit: "45s", "12m 5s", "3h 20m". */
function formatWatched(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
