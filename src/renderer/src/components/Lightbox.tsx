import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Collection,
  MediaAnnotations,
  MediaItem,
  MediaLabel,
  PlaybackPrefs,
  Tag,
  ToyPlayback,
} from '@shared/types'
import { formatBytes, formatDuration } from '../format'
import { trace } from '../trace'
import { AddToCollection } from './AddToCollection'
import { ImageViewer } from './ImageViewer'
import { MediaInfo } from './MediaInfo'
import { ToyChip } from './ToyChip'
import { UpNext } from './UpNext'
import { actionOf } from '../keys'
import { CameraIcon, DescriptionIcon, InfoIcon, LoopIcon } from './SidebarIcons'
import { HeartIcon, ShuffleToggle } from './Toolbar'
import { ToyBar } from './ToyBar'
import { VideoPlayer } from './VideoPlayer'
import type { PlayerCoWatch, VideoPlayerHandle } from './VideoPlayer'
import type { ToyView } from '../state/useToy'

export interface LightboxProps {
  item: MediaItem
  index: number
  total: number
  collections: Collection[]
  /** Set when the lightbox is showing a collection, enabling "remove from". */
  activeCollectionId: number | null
  onClose: () => void
  onNavigate: (delta: number) => void
  onAddToCollection: (target: { id: number } | { name: string }, mediaId: number) => Promise<void> | void
  /** Takes the item out of one collection, from the viewer's own menu. */
  onLeaveCollection: (collectionId: number, mediaId: number) => Promise<void> | void
  /** The session's Up next, while sharing. */
  upNext?: {
    queue: number[]
    canPlay: boolean
    onPlay: (mediaId: number) => void
    onRemove: (index: number) => void
  }
  onRemoveFromCollection: (mediaId: number) => void
  tags: Tag[]
  /** Resolves once the change has landed, so the label strip can re-read it. */
  onToggleTag: (
    target: { id: number } | { name: string },
    mediaId: number,
    attached: boolean,
  ) => Promise<void>
  shuffle: boolean
  onShuffleChange: (shuffle: boolean) => void
  /** What shuffle and Random pick from. Chosen by right-clicking shuffle. */
  onRandomKind: (kind: PlaybackPrefs['randomKind']) => void
  onRandom: () => void
  /** Raises the native item menu for whatever is on screen. */
  onContextMenu?: (mediaId: number, x: number, y: number) => void
  /** Moves the item being viewed to the Trash. */
  onTrash?: (mediaId: number) => void
  /** Flips the heart on the item being viewed. */
  onToggleFavorite?: (item: MediaItem) => void
  playback: PlaybackPrefs
  onPlaybackChange: (patch: Partial<PlaybackPrefs>) => void
  onVolumeChange: (volume: number, muted: boolean) => void
  /** Set while a co-watching session is running; the player then follows it. */
  coWatch?: PlayerCoWatch
  /** Whose machine the room is currently held for, if anyone's. */
  waitingFor?: string[]
  toy: ToyView
}

/**
 * Which sidebar tags this item currently carries.
 *
 * Labels come back by name, not id, because they are read through the labels
 * view — matching back to the tag list is case-insensitive for the same reason
 * the tag table is: 'Portrait' and 'portrait' are one tag.
 */
function attachedTagIds(tags: Tag[], labels: MediaLabel[]): number[] {
  const names = new Set(labels.map((label) => label.label.toLowerCase()))
  return tags.filter((tag) => names.has(tag.name.toLowerCase())).map((tag) => tag.id)
}

function hasTag(tags: Tag[], labels: MediaLabel[], tagId: number): boolean {
  return attachedTagIds(tags, labels).includes(tagId)
}

/** How often a playing video's place is written. See notePosition. */
const POSITION_EVERY_MS = 5_000

export function Lightbox(props: LightboxProps): React.JSX.Element {
  const { item, onClose, onNavigate } = props
  const playerRef = useRef<VideoPlayerHandle | null>(null)
  /** The open video's length, for deciding whether a position is worth keeping. */
  const durationRef = useRef(0)
  /** The last place seen, and when one was last written. See notePosition. */
  const placeRef = useRef<{ mediaId: number; positionMs: number } | null>(null)
  const wroteAtRef = useRef(0)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [labels, setLabels] = useState<MediaLabel[]>([])
  const [caption, setCaption] = useState<string | null>(null)

  // An image has nothing to buffer, so it is ready the moment it is on screen.
  // Said again while the room is holding for this screen, since the room
  // resets everyone's readiness whenever something is opened.
  const heldForUs =
    props.coWatch?.playback.waiting === true && props.coWatch.playback.waitingFor.includes('You')
  useEffect(() => {
    if (item.kind === 'image' && props.coWatch) props.coWatch.onReady(item.id, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the session object changes every render
  }, [item.id, item.kind, props.coWatch !== undefined, heldForUs])

  // Autoplay moves on from an image after the timer set in Settings → App, the
  // way it moves on from a video when it ends. In a session only whoever is in
  // control moves everyone along; watching along, the room decides.
  const imageSeconds = props.playback.imageSeconds
  const drivesRoom = !props.coWatch || props.coWatch.inControl
  // Where this video was left, asked for once as it opens. Null while the
  // answer is still coming, which is why the player waits for it.
  const [startAt, setStartAt] = useState<number | null>(null)
  useEffect(() => {
    setStartAt(null)
    if (item.kind !== 'video') return
    let live = true
    void window.goonlib.media
      .position(item.id)
      .then((position) => {
        if (live) setStartAt(props.coWatch && !props.playback.resumeInSessions ? null : position)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the session object changes every render
  }, [item.id, item.kind, props.coWatch !== undefined, props.playback.resumeInSessions])

  // Held in a ref: the parent hands down a new navigate on most renders, and
  // the timer must not start over every time it does.
  const navigateRef = useRef(onNavigate)
  navigateRef.current = onNavigate

  // The item the viewer was opened on. Every item after it is a "next" one,
  // however it was reached, and while autoplay is on those always start, so
  // autoplay and Play on open never disagree mid-run.
  const firstItem = useRef(item.id)
  const advance = useCallback(() => navigateRef.current(1), [])

  /**
   * Keeps the place in a playing video, every few seconds rather than every
   * report.
   *
   * The player says where it is once a second, which the toy needs; the place
   * does not - a resume that is a few seconds out is the same resume, and a
   * write a second for the length of a film is a great deal of database for
   * that. Stopping - pausing, seeking to the end, leaving - writes at once, so
   * what is stored is never more than a moment old by the time it matters.
   */
  const notePosition = useCallback((report: ToyPlayback): void => {
    const write = (): void => {
      const place = placeRef.current
      if (!place) return
      window.goonlib.media.setPosition(place.mediaId, place.positionMs, durationRef.current)
      placeRef.current = null
      wroteAtRef.current = Date.now()
    }

    // The viewer has left the video: keep wherever it was last seen.
    if (report.mediaId === null) {
      write()
      return
    }

    placeRef.current = { mediaId: report.mediaId, positionMs: report.positionMs }
    if (!report.playing || Date.now() - wroteAtRef.current >= POSITION_EVERY_MS) write()
  }, [])
  // Decided once per item, when it opens, and held: the player only reads it
  // as the video loads, and a redraw in between must not change its mind.
  const startFor = useRef<{ id: number; play: boolean } | null>(null)
  if (startFor.current?.id !== item.id) {
    startFor.current = {
      id: item.id,
      play: props.playback.playOnOpen || (props.playback.autoplay && item.id !== firstItem.current),
    }
  }
  const startPlaying = startFor.current.play
  useEffect(() => {
    // Looping holds on what is open, so an image stays put.
    if (item.kind !== 'image' || !props.playback.autoplay || props.playback.loop || !drivesRoom) return
    const timer = setTimeout(advance, imageSeconds * 1000)
    return () => clearTimeout(timer)
  }, [item.id, item.kind, props.playback.autoplay, props.playback.loop, imageSeconds, drivesRoom, advance])

  // An item on screen for at least a second counts as a view, and the time
  // it stayed is added to its total when the viewer moves on or closes. The
  // second keeps a quick skip past something from counting as watching it.
  useEffect(() => {
    const openedAt = Date.now()
    const id = item.id
    return () => {
      const watched = Date.now() - openedAt
      if (watched >= 1000) window.goonlib.media.recordView(id, watched)
    }
  }, [item.id])

  // Take focus so the overlay reads as modal to assistive tech.
  useEffect(() => {
    shellRef.current?.focus()
  }, [])

  // Fetched per item rather than carried on MediaItem: the grid pages hundreds
  // of rows at a time and joining labels into that query would cost every one of
  // them for a strip only the viewer shows.
  const loadAnnotations = useCallback(async (): Promise<MediaAnnotations> => {
    try {
      return await window.goonlib.media.annotations(item.id)
    } catch {
      return { labels: [], caption: null }
    }
  }, [item.id])

  useEffect(() => {
    let live = true
    setLabels([])
    setCaption(null)

    void loadAnnotations().then((next) => {
      if (!live) return
      setLabels(next.labels)
      setCaption(next.caption)
    })

    return () => {
      live = false
    }
  }, [loadAnnotations])

  // Which collections this item is in, so the menu can tick them and take it
  // back out of one. Re-read after every change the menu makes.
  const [memberOf, setMemberOf] = useState<ReadonlySet<number>>(new Set())
  const loadMembership = useCallback(async () => {
    try {
      setMemberOf(new Set(await window.goonlib.collections.of(item.id)))
    } catch {
      setMemberOf(new Set())
    }
  }, [item.id])
  useEffect(() => {
    setMemberOf(new Set())
    void loadMembership()
  }, [loadMembership])

  const toggleTag = useCallback(
    async (target: { id: number } | { name: string }, attached: boolean) => {
      await props.onToggleTag(target, item.id, attached)
      setLabels((await loadAnnotations()).labels)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- props read fresh each render
    [item.id, loadAnnotations, props.onToggleTag],
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const player = playerRef.current
      const isVideo = item.kind === 'video'

      // Never steal keys from a field the user is typing or dragging in — the
      // seek slider, a collection name box, anything editable.
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true

      if (typing && event.key !== 'Escape') return

      switch (actionOf('viewer', event) ?? '') {
        case 'viewer.close':
          // One press closes the item, fullscreen or not. It used to take two
          // from fullscreen — the first only left it — which read as Escape
          // not working at all.
          event.preventDefault()
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
          onClose()
          break

        case 'player.playPause':
          if (isVideo) {
            event.preventDefault()
            player?.togglePlay()
          }
          break

        case 'viewer.previous':
          // Arrows move between items, for video as much as for stills — going
          // to the next thing is what you reach for far more often than nudging
          // the playhead. Shift with them scrubs instead, and j / l still seek.
          event.preventDefault()
          onNavigate(-1)
          break

        case 'viewer.next':
          event.preventDefault()
          onNavigate(1)
          break

        case 'player.backShort':
          if (isVideo) {
            event.preventDefault()
            player?.seekBy(-5)
          }
          break

        case 'player.forwardShort':
          if (isVideo) {
            event.preventDefault()
            player?.seekBy(5)
          }
          break

        case 'player.back':
          if (isVideo) player?.seekBy(-10)
          break

        case 'player.forward':
          if (isVideo) player?.seekBy(10)
          break

        // Both delete keys. The typing guard above means neither can fire while
        // a tag or collection name is being typed.
        case 'viewer.trash':
          event.preventDefault()
          props.onTrash?.(item.id)
          break

        case 'player.volumeUp':
          if (isVideo) {
            event.preventDefault()
            player?.adjustVolume(0.1)
          }
          break

        case 'player.volumeDown':
          if (isVideo) {
            event.preventDefault()
            player?.adjustVolume(-0.1)
          }
          break

        case 'player.mute':
          if (isVideo) player?.toggleMute()
          break

        case 'player.frameBack':
          if (isVideo) player?.stepFrame(-1)
          break

        case 'player.frameForward':
          if (isVideo) player?.stepFrame(1)
          break

        case 'player.slower':
          if (isVideo) player?.adjustRate(-1)
          break

        case 'player.faster':
          if (isVideo) player?.adjustRate(1)
          break

        case 'player.fullscreen':
          if (isVideo) player?.toggleFullscreen()
          break

        case 'viewer.shuffle':
          props.onShuffleChange(!props.shuffle)
          break

        case 'viewer.random':
          props.onRandom()
          break

        case 'viewer.loop':
          props.onPlaybackChange({ loop: !props.playback.loop })
          break

        case 'viewer.details':
          props.onPlaybackChange({ showMetadata: !props.playback.showMetadata })
          break

        case 'viewer.favorite':
          props.onToggleFavorite?.(item)
          break

        default:
          break
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- props read fresh each render
    [
      // id, not just kind: this closure names the item it deletes, and stepping
      // from one video to the next changes nothing else in this list. Leaving it
      // out means Delete acts on whatever was on screen when the handler was
      // built, which is the item you just navigated away from.
      item.id,
      item.kind,
      // And the heart, which `h` reads to decide which way to flip.
      item.favoritedAt,
      props.onToggleFavorite,
      onClose,
      onNavigate,
      props.shuffle,
      props.onShuffleChange,
      props.onRandom,
      props.onTrash,
    ],
  )

  // Listen at the window rather than on the overlay element. Binding to the div
  // only works while focus is inside it, and the <video> element, the control
  // buttons, or a stray click on the backdrop all move focus elsewhere — which
  // silently killed every shortcut, Escape included.
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  return (
    <div
      className="lightbox"
      ref={shellRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
    >
      <header className="lightbox__bar">
        {/* Three columns, so the controls sit in the middle of the bar whatever
            the filename is. */}
        <div className="lightbox__side">
          <div className="lightbox__title" title={item.relPath}>
            {item.name}
          </div>
          <div className="lightbox__meta">
            {item.width && item.height ? `${item.width}×${item.height}` : null}
            {item.durationMs ? ` · ${formatDuration(item.durationMs)}` : ''}
            {` · ${formatBytes(item.size)}`}
            {item.playbackTier && item.playbackTier !== 'native'
              ? ` · ${item.playbackTier === 'remux' ? 'repackaged' : 'converted'}`
              : ''}
          </div>
        </div>

        <div className="lightbox__actions">
          {/* What the details panel shows, switched from here as well as from
              Settings → App. */}
          <button
            type="button"
            className={props.playback.showMetadata ? 'icon-button icon-button--toggled' : 'icon-button'}
            onClick={() => props.onPlaybackChange({ showMetadata: !props.playback.showMetadata })}
            aria-pressed={props.playback.showMetadata}
            title={props.playback.showMetadata ? 'Hide details' : 'Show details'}
          >
            <InfoIcon />
            <span className="visually-hidden">Details</span>
          </button>
          <button
            type="button"
            className={props.playback.showExif ? 'icon-button icon-button--toggled' : 'icon-button'}
            onClick={() => props.onPlaybackChange({ showExif: !props.playback.showExif })}
            aria-pressed={props.playback.showExif}
            title={props.playback.showExif ? 'Hide EXIF data' : 'Show EXIF data'}
          >
            <CameraIcon />
            <span className="visually-hidden">EXIF data</span>
          </button>

          <button
            type="button"
            className={props.playback.showDescription ? 'icon-button icon-button--toggled' : 'icon-button'}
            onClick={() => props.onPlaybackChange({ showDescription: !props.playback.showDescription })}
            aria-pressed={props.playback.showDescription}
            title={
              props.playback.showDescription
                ? 'Hide the description and tags'
                : 'Show the description and tags'
            }
          >
            <DescriptionIcon />
            <span className="visually-hidden">Description and tags</span>
          </button>

          <span className="lightbox__divider" aria-hidden="true" />

          {/* Playback preference lives here rather than in Settings: this is the
              only place it means anything, and reaching for a settings sheet
              mid-video to stop it rolling on is the wrong shape of gesture.
              Shown for stills too, so landing on an image after an autoplay
              hop is not a dead end for turning it back off. */}
          <button
            type="button"
            className={
              props.playback.autoplay ? 'addto__trigger addto__trigger--on' : 'addto__trigger'
            }
            onClick={() => props.onPlaybackChange({ autoplay: !props.playback.autoplay })}
            aria-pressed={props.playback.autoplay}
            title={
              props.playback.autoplay
                ? `Moves on by itself: when a video ends, and after ${props.playback.imageSeconds}s on an image`
                : 'Stays on each item until you move on'
            }
          >
            {props.playback.autoplay ? 'Autoplay ✓' : 'Autoplay'}
          </button>

          <AddToCollection
            label="Add to Collection"
            collections={props.collections}
            activeIds={memberOf}
            onAdd={(target) =>
              void Promise.resolve(props.onAddToCollection(target, item.id)).then(loadMembership)
            }
            onRemove={(id) =>
              void Promise.resolve(props.onLeaveCollection(id, item.id)).then(loadMembership)
            }
          />

          <AddToCollection
            label="Add to Tag"
            placeholder="New tag…"
            emptyText="No tags yet."
            collections={props.tags}
            activeIds={new Set(attachedTagIds(props.tags, labels))}
            // A multi-select: a ticked tag comes off, an unticked one goes on.
            onAdd={(target) =>
              void toggleTag(target, 'id' in target && hasTag(props.tags, labels, target.id))
            }
            onRemove={(id) => void toggleTag({ id }, true)}
          />
          {props.activeCollectionId !== null ? (
            <button
              type="button"
              className="addto__trigger"
              onClick={() => props.onRemoveFromCollection(item.id)}
              title="Remove from this collection (the file itself is untouched)"
            >
              Remove
            </button>
          ) : null}

          <span className="lightbox__divider" aria-hidden="true" />

          {props.onToggleFavorite ? (
            <button
              type="button"
              className={
                item.favoritedAt !== null
                  ? 'icon-button icon-button--fav icon-button--on icon-button--heart'
                  : 'icon-button icon-button--fav'
              }
              onClick={() => props.onToggleFavorite?.(item)}
              aria-pressed={item.favoritedAt !== null}
              title={item.favoritedAt !== null ? 'Unfavorite (H)' : 'Favorite (H)'}
            >
              <HeartIcon filled={item.favoritedAt !== null} />
              <span className="visually-hidden">Favorite</span>
            </button>
          ) : null}

          {/* Repeats what is open instead of moving on, whatever autoplay says. */}
          <button
            type="button"
            className={props.playback.loop ? 'icon-button icon-button--toggled' : 'icon-button'}
            onClick={() => props.onPlaybackChange({ loop: !props.playback.loop })}
            aria-pressed={props.playback.loop}
            title={props.playback.loop ? 'Looping this item' : 'Loop this item'}
          >
            <LoopIcon />
            <span className="visually-hidden">Loop</span>
          </button>

          <ShuffleToggle
            shuffle={props.shuffle}
            onShuffleChange={props.onShuffleChange}
            kind={props.playback.randomKind}
            onKind={props.onRandomKind}
            shortcut="S"
          />

          {props.toy.live ? (
            <>
              <span className="lightbox__divider" aria-hidden="true" />
              <ToyChip toy={props.toy} />
            </>
          ) : null}
        </div>

        <div className="lightbox__side lightbox__side--end">
          {props.coWatch ? (
            <div className="lightbox__actor" title="Everyone in the session sees this too">
              {props.coWatch.inControl ? 'You’re in control' : 'Watching along'}
            </div>
          ) : null}

          {/* A negative index is an item the room is on that this grid is not
              showing, so there is no position in it to report. */}
          {props.index >= 0 ? (
            <div className="lightbox__position">
              {props.index + 1} of {props.total}
            </div>
          ) : null}
          <button
            type="button"
            className="lightbox__close"
            onClick={onClose}
            aria-label="Close viewer"
          >
            ×
          </button>
        </div>
      </header>

      <button
        type="button"
        className="lightbox__nav lightbox__nav--prev"
        onClick={() => onNavigate(-1)}
        aria-label="Previous item"
      >
        ‹
      </button>

      {props.waitingFor && props.waitingFor.length > 0 ? (
        <div className="lightbox__holding" role="status" aria-live="polite">
          Holding for {props.waitingFor.join(', ')} to catch up…
        </div>
      ) : null}

      {/* Beside the item, on the left, while Settings → App asks for it. */}
      {/* Up next down the right, while a session has anything queued. */}
      {props.upNext ? (
        <UpNext
          queue={props.upNext.queue}
          canPlay={props.upNext.canPlay}
          onPlay={props.upNext.onPlay}
          onRemove={props.upNext.onRemove}
          className="lightbox__upnext"
        />
      ) : null}

      {props.playback.showMetadata || props.playback.showExif ? (
        <MediaInfo
          item={item}
          labels={labels}
          caption={caption}
          details={props.playback.showMetadata}
          exif={props.playback.showExif}
          location={props.playback.showLocation}
          className="lightbox__info"
        />
      ) : null}

      <div
        className="lightbox__stage"
        // The same menu the grid raises, on the item you are actually looking
        // at. preventDefault matters more here than on a card: Chromium puts its
        // own media menu on a <video>, and without this that one wins.
        onContextMenu={(event) => {
          event.preventDefault()
          props.onContextMenu?.(item.id, event.clientX, event.clientY)
        }}
      >
        {item.kind === 'video' ? (
          <VideoPlayer
            key={item.id}
            item={item}
            handleRef={playerRef}
            coWatch={props.coWatch}
            autoplay={startPlaying}
            loop={props.playback.loop}
            volume={props.playback.volume}
            muted={props.playback.muted}
            onVolumeChange={props.onVolumeChange}
            // Reaching the end is the player's news; deciding to move on is the
            // viewer's. Navigation already stops at the last item, so the run
            // ends there rather than wrapping around to the start.
            onEnded={() => {
              trace('[viewer] video ended; autoplay is', props.playback.autoplay)
              if (props.playback.autoplay) advance()
            }}
            startAtMs={startAt}
            onReport={(report) => {
              window.goonlib.toy.playback(report)
              notePosition(report)
            }}
            underControls={(clock) => {
              // The length is only known once the video has loaded, and a
              // position is judged against it.
              durationRef.current = Math.round(clock.duration * 1000)
              return props.toy.live ? <ToyBar toy={props.toy} mediaId={item.id} clock={clock} /> : null
            }}
          />
        ) : (
          <ImageViewer
            key={item.id}
            item={item}
            timerSeconds={props.playback.autoplay && !props.playback.loop && drivesRoom ? imageSeconds : null}
          />
        )}
      </div>

      {caption && props.playback.showDescription && props.playback.showCaption ? (
        <p className="caption" title={caption}>
          {caption}
        </p>
      ) : null}

      {labels.length > 0 && props.playback.showDescription && props.playback.showTags ? (
        <div className="labels" aria-label="Tags on this item">
          {labels.map((label) => (
            <span
              key={`${label.source}:${label.label}`}
              className={label.source === 'ai' ? 'label label--ai' : 'label'}
              title={
                label.confidence === null
                  ? 'Tagged by you'
                  : `${Math.round(label.confidence * 100)}% confident - suggested by AI`
              }
            >
              {label.label}
              {label.confidence === null ? null : (
                <span className="label__score">{Math.round(label.confidence * 100)}</span>
              )}
              <button
                type="button"
                className="label__remove"
                onClick={() => void toggleTag({ name: label.label }, true)}
                aria-label={`Remove the tag ${label.label}`}
                title="Remove from this item"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className="lightbox__nav lightbox__nav--next"
        onClick={() => onNavigate(1)}
        aria-label="Next item"
      >
        ›
      </button>
    </div>
  )
}

/**
 * The toy, from inside the viewer: what it is following, how hard it is going,
 * and one click to stop it. Only shown while a toy is connected.
 */
