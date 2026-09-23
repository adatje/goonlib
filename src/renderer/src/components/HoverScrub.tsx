import { useCallback, useState } from 'react'
import type { MediaItem } from '@shared/types'
import { cellPosition, sheetSize } from '../sprite'

export interface HoverScrubProps {
  item: MediaItem
}

/**
 * Scrub through a video's preview frames by moving the cursor across its card.
 *
 * The whole sheet is one image, positioned with percentages rather than pixels:
 * `background-size: ${columns * 100}%` makes each cell exactly one card wide
 * whatever the card's actual size, so the same sheet works at any grid density
 * without measuring anything. Moving between frames is then a single
 * `background-position` change — no image loading, no decoding, no I/O.
 */
export function HoverScrub({ item }: HoverScrubProps): React.JSX.Element | null {
  const [frame, setFrame] = useState<number | null>(null)

  const sprite = item.sprite

  const onMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!sprite) return

      const rect = event.currentTarget.getBoundingClientRect()
      if (rect.width <= 0) return

      const ratio = (event.clientX - rect.left) / rect.width
      const index = Math.floor(ratio * sprite.frames)

      setFrame(Math.min(sprite.frames - 1, Math.max(0, index)))
    },
    [sprite],
  )

  const onLeave = useCallback(() => setFrame(null), [])

  // Nothing to scrub: an image, a clip too short to bother with, or a sheet that
  // hasn't been generated yet.
  if (!sprite || item.kind !== 'video') return null

  const rows = Math.ceil(sprite.frames / sprite.columns)

  return (
    <div className="scrub" onMouseMove={onMove} onMouseLeave={onLeave}>
      {frame === null ? null : (
        <div
          className="scrub__frame"
          style={{
            backgroundImage: `url("media://sprite/${item.id}?m=${item.mtime}")`,
            backgroundSize: sheetSize(sprite.columns, rows),
            backgroundPosition: cellPosition(frame, sprite.columns, rows),
          }}
        />
      )}

      {frame === null ? null : (
        <div className="scrub__track" aria-hidden="true">
          <div
            className="scrub__progress"
            style={{ width: `${((frame + 1) / sprite.frames) * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}
