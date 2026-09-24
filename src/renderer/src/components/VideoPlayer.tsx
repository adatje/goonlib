import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type {
  CoWatchIntent,
  CoWatchPlayback,
  MediaItem,
  PreparedMedia,
  ToyPlayback,
} from '@shared/types'
import { correct, isRunning, projectPosition } from '@shared/drift'
import { clamp } from '@shared/num'
import { trace } from '../trace'
import { formatDuration } from '../format'

export interface VideoPlayerHandle {
  togglePlay(): void
  seekBy(seconds: number): void
  stepFrame(direction: 1 | -1): void
  /** A step up or down the speeds, for playing something over or skimming it. */
  adjustRate(direction: 1 | -1): void
  adjustVolume(delta: number): void
  toggleMute(): void
  toggleFullscreen(): void
}

/**
 * Wiring for a co-watching session.
 *
 * When present, this player stops being in charge of itself: the controls
 * propose changes to the room and the room decides, which is the only way this
 * screen and everyone else's stay showing the same frame.
 */
export interface PlayerCoWatch {
  playback: CoWatchPlayback
  /** Whether this screen is the one driving. Controls do nothing otherwise. */
  inControl: boolean
  onIntent: (intent: CoWatchIntent) => void
  onReady: (mediaId: number, ready: boolean) => void
}

export interface VideoPlayerProps {
  item: MediaItem
  handleRef: React.RefObject<VideoPlayerHandle | null>
  /** Start playing on open, rather than waiting to be told. */
  autoplay?: boolean
  /** Repeat this video rather than ending, so nothing moves on. */
  loop?: boolean
  /**
   * Where to carry on from, in milliseconds. Applied once, as the video
   * becomes playable, and only when it is far enough in to be worth it.
   */
  startAtMs?: number | null
  /** Set while a co-watching session is running. */
  coWatch?: PlayerCoWatch
  /**
   * Fired when the video reaches its end. Whether that should move anywhere is
   * the viewer's decision, not the player's — this just reports the fact.
   */
  onEnded?: () => void
  /**
   * Where the video is and whether it is moving, reported on every change and
   * once a second while playing. The toy follows the video from these.
   */
  onReport?: (report: ToyPlayback) => void
  /** Where the volume was last left. Applied when the video opens, never after. */
  volume?: number
  muted?: boolean
  /** Fired when the user moves the volume, so the next video can open at it. */
  onVolumeChange?: (volume: number, muted: boolean) => void
  /**
   * Anything to show on its own row beneath the transport controls, drawn
   * against the player's clock — the toy's pattern bar, today.
   */
  underControls?: (clock: PlayerClock) => React.ReactNode
}

/** Where a player is, for things drawn alongside it. */
export interface PlayerClock {
  currentTime: number
  duration: number
  /** Goes through the same path as the scrub bar, co-watching included. */
  seek: (seconds: number) => void
}

/** The speeds the keys step through. */
const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]

/** The listed speed nearest the one playing, so a step always lands on the list. */
function nearestRate(rate: number): number {
  return RATES.reduce((best, entry) => (Math.abs(entry - rate) < Math.abs(best - rate) ? entry : best), 1)
}

/** How often a playing video re-states its position, so followers cannot drift. */
const REPORT_MS = 1_000

/**
 * How close to the end counts as the end, when the element has stopped moving.
 *
 * Wide enough to cover a file whose declared duration overshoots its last sample
 * by a few frames, narrow enough that it can only mean the end.
 */
const END_SLACK_S = 0.5

type Status =
  | { kind: 'preparing'; percent: number; message: string }
  | { kind: 'ready'; media: PreparedMedia }
  | { kind: 'error'; message: string }

export function VideoPlayer({
  item,
  handleRef,
  autoplay = true,
  loop = false,
  startAtMs = null,
  onEnded,
  onReport,
  volume: savedVolume = 1,
  muted: savedMuted = false,
  onVolumeChange,
  underControls,
  coWatch,
}: VideoPlayerProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)

  // Read through a ref rather than a dependency: the parent rebuilds this
  // object every render, and depending on it would tear down and re-arm the
  // correction timer several times a second.
  const coWatchRef = useRef(coWatch)
  coWatchRef.current = coWatch
  const inSession = coWatch !== undefined

  const [status, setStatus] = useState<Status>({
    kind: 'preparing',
    percent: 0,
    message: 'Opening…',
  })
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(savedMuted)
  const [volume, setVolume] = useState(savedVolume)

  // Read once, at open: the saved volume is where a video starts, not something
  // to keep re-applying while the user is changing it.
  const initialVolume = useRef({ volume: savedVolume, muted: savedMuted })
  const onVolumeChangeRef = useRef(onVolumeChange)
  onVolumeChangeRef.current = onVolumeChange

  /**
   * Set while the autoplay fallback mutes the video to get it started.
   *
   * That mute is Chromium's condition, not the user's choice, and saving it
   * would open every video after it silent.
   */
  const autoMuting = useRef(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)

  // The last readiness this player told the room, so the timer below only
  // speaks up when something changed.
  const reportedReady = useRef<boolean | null>(null)

  /**
   * Reports the end of the video exactly once per playthrough.
   *
   * Once, because the fallback below and the element's own `ended` event can
   * both arrive for the same one, and "move to the next item" is not a thing to
   * do twice. Per playthrough, because watching the same video again — pressing
   * play at the end, or scrubbing back — has to be able to end again; latching
   * it for the life of the element silently swallowed every end after the first.
   */
  const ended = useRef(false)
  const finish = useCallback(() => {
    if (ended.current) return
    ended.current = true
    onEnded?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onEnded is read fresh
  }, [onEnded])

  // Read through a ref for the same reason as coWatch: the parent passes a
  // fresh function every render.
  const onReportRef = useRef(onReport)
  onReportRef.current = onReport

  /**
   * Tells whoever is following where the video is.
   *
   * Buffering counts as stopped: the element is un-paused but the picture is
   * not moving, and a toy that ran on through a stall would be ahead of it
   * when it resumed.
   */
  const stalled = useRef(false)
  const report = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    onReportRef.current?.({
      mediaId: item.id,
      playing: !video.paused && !video.ended && !stalled.current,
      positionMs: Math.round(video.currentTime * 1000),
      rate: video.playbackRate,
    })
  }, [item.id])

  // Leaving says so too, so nothing carries on playing a video that is gone.
  useEffect(
    () => () => onReportRef.current?.({ mediaId: null, playing: false, positionMs: 0, rate: 1 }),
    [item.id],
  )

  /**
   * Starts playback when the viewer is set to autoplay.
   *
   * The `autoplay` attribute alone is not enough: it is only honoured for a
   * fresh element under Chromium's own conditions, and the element that opens
   * the *next* video after one finishes routinely misses them — which left the
   * next video sitting on its first frame waiting to be clicked. Asking
   * explicitly, and falling back to muted if sound is what was refused, is what
   * makes "autoplay next" need no input at all.
   */
  // Carrying on where it was left. Done once per video, and only before
  // anything else has moved the playhead — a seek of your own wins.
  const resumed = useRef(false)
  useEffect(() => {
    resumed.current = false
  }, [item.id])
  useEffect(() => {
    const video = videoRef.current
    if (!video || resumed.current || startAtMs === null || status.kind !== 'ready') return

    const seek = (): void => {
      if (resumed.current) return
      const seconds = startAtMs / 1000
      if (!Number.isFinite(video.duration) || seconds >= video.duration) return
      resumed.current = true
      video.currentTime = seconds
    }

    if (video.readyState >= 1) seek()
    else video.addEventListener('loadedmetadata', seek, { once: true })
    return () => video.removeEventListener('loadedmetadata', seek)
  }, [item.id, startAtMs, status.kind])

  const started = useRef(false)
  const start = useCallback(() => {
    const video = videoRef.current
    if (!video || started.current || !autoplay || inSession) return
    started.current = true

    void video.play().catch(() => {
      autoMuting.current = true
      video.muted = true
      void video
        .play()
        .catch(() => {
          // Even muted was refused. Leave it on its first frame rather than
          // silently muting a video nobody managed to start.
          video.muted = initialVolume.current.muted
          trace('[player] autoplay refused for', item.id)
        })
        // Cleared a turn later, after the volumechange events it caused.
        .finally(() => setTimeout(() => (autoMuting.current = false), 0))
    })
  }, [autoplay, inSession, item.id])

  /**
   * Notices a video that has reached its end without saying so.
   *
   * Chromium does not always fire `ended`: a file whose container declares a
   * duration a few frames longer than its last sample stalls on the final frame
   * instead, still un-paused, and the viewer sits there forever with autoplay
   * next never happening.
   *
   * Only un-paused playback counts, which is what keeps this from firing when
   * someone has deliberately paused on the last second of a video.
   */
  useEffect(() => {
    // A looping video has no end to find: it runs on until something else stops it.
    if (status.kind !== 'ready' || loop) return

    let previous = -1
    const timer = setInterval(() => {
      const video = videoRef.current
      if (!video || ended.current) return

      // The element's own flag, which is true whenever the playhead is at the
      // end — including the cases where Chromium never fired the event for it,
      // such as arriving there by seeking rather than by playing.
      if (video.ended) {
        trace('[player] found at the end without an ended event')
        finish()
        return
      }

      if (video.paused) return

      const total = video.duration
      if (!Number.isFinite(total) || total <= 0) return

      const stuck = video.currentTime === previous
      previous = video.currentTime
      if (stuck && total - video.currentTime <= END_SLACK_S) {
        trace('[player] stalled on the last frame at', video.currentTime, 'of', total)
        finish()
      }
    }, 400)

    return () => clearInterval(timer)
  }, [status.kind, finish, loop])

  useEffect(() => {
    if (status.kind !== 'ready') return
    const timer = setInterval(() => {
      const video = videoRef.current
      if (video && !video.paused) report()
    }, REPORT_MS)
    return () => clearInterval(timer)
  }, [status.kind, report])

  const reportReady = useCallback(
    (ready: boolean) => {
      const session = coWatchRef.current
      if (!session) return
      // The room resets everyone's readiness whenever an item is opened, so a
      // "ready" it is still holding for has to be said again, not deduplicated.
      const heldForUs = session.playback.waiting && session.playback.waitingFor.includes('You')
      if (reportedReady.current === ready && !(ready && heldForUs)) return
      reportedReady.current = ready
      session.onReady(item.id, ready)
    },
    [item.id],
  )

  // Ask the main process for a playable rendition. Native files come back
  // instantly; a remux or transcode reports progress while it works.
  useEffect(() => {
    trace('[player] mount', item.id)
    let cancelled = false

    setStatus({ kind: 'preparing', percent: 0, message: 'Opening…' })

    const unsubscribe = window.goonlib.playback.onProgress((progress) => {
      if (cancelled || progress.id !== item.id) return
      setStatus((current) =>
        current.kind === 'preparing'
          ? { kind: 'preparing', percent: progress.percent, message: progress.message }
          : current,
      )
    })

    window.goonlib.playback
      .prepare(item.id)
      .then((media) => {
        if (!cancelled) setStatus({ kind: 'ready', media })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
        }
      })

    return () => {
      trace('[player] unmount', item.id)
      cancelled = true
      unsubscribe()
      // Abandon an encode the user navigated away from rather than burning CPU
      // on a file nobody is waiting for.
      void window.goonlib.playback.cancel(item.id).catch(() => undefined)
    }
  }, [item.id])

  /**
   * Follows the room.
   *
   * Runs on a timer rather than on incoming messages because the room's
   * position is a projection from a timestamp, not a value that arrives — so
   * "where should we be" changes continuously even when nothing is being sent.
   */
  useEffect(() => {
    if (!inSession || status.kind !== 'ready') return

    const timer = setInterval(() => {
      const video = videoRef.current
      const session = coWatchRef.current
      if (!video || !session) return

      const playback = session.playback
      // The room may have moved to another item while this one is still mounted.
      if (playback.mediaId !== item.id) return

      // Readiness is read off the element rather than inferred from events.
      // `canplaythrough` fires once and `waiting` fires often, so tracking
      // them left the room holding for a player that was sitting there with
      // plenty buffered.
      reportReady(video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA)

      // Host and room share a process, so their clocks are the same one. A
      // browser guest has to estimate the offset; here there is nothing to
      // estimate.
      const action = correct(projectPosition(playback, Date.now()), video.currentTime * 1000)

      if (action.kind === 'seek') {
        video.currentTime = action.positionMs / 1000
        video.playbackRate = 1
      } else {
        video.playbackRate = action.kind === 'nudge' ? action.rate : 1
      }

      if (isRunning(playback) && video.paused) void video.play().catch(() => undefined)
      else if (!isRunning(playback) && !video.paused) video.pause()
    }, 500)

    return () => clearInterval(timer)
  }, [inSession, item.id, status.kind, reportReady])

  /**
   * Reports "not ready" while a rendition is still being prepared, so the room
   * holds for this machine instead of running on without it. Once it is
   * prepared, the timer above reports from the element itself.
   */
  useEffect(() => {
    if (!inSession || status.kind === 'ready') return
    reportedReady.current = null
    reportReady(false)
  }, [inSession, status.kind, reportReady])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    const session = coWatchRef.current
    if (session) {
      if (!session.inControl) return
      if (isRunning(session.playback)) {
        session.onIntent({ kind: 'pause', positionMs: Math.round(video.currentTime * 1000) })
      } else {
        session.onIntent({ kind: 'play' })
      }
      return
    }

    if (video.paused) void video.play().catch(() => undefined)
    else video.pause()
  }, [])

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current
    if (!video) return

    const bounded = clamp(seconds, 0, Number.isFinite(video.duration) ? video.duration : seconds)

    const session = coWatchRef.current
    if (session) {
      if (session.inControl) {
        session.onIntent({ kind: 'seek', positionMs: Math.round(bounded * 1000) })
      }
      return
    }

    video.currentTime = bounded
  }, [])

  const seekBy = useCallback(
    (seconds: number) => {
      const video = videoRef.current
      if (!video || !Number.isFinite(video.duration)) return
      seekTo(video.currentTime + seconds)
    },
    [seekTo],
  )

  const stepFrame = useCallback(
    (direction: 1 | -1) => {
      const video = videoRef.current
      if (!video) return
      // Without real frame metadata, one frame is the best estimate we have.
      const frame = item.fps && item.fps > 0 ? 1 / item.fps : 1 / 30

      const session = coWatchRef.current
      if (session) {
        if (!session.inControl) return
        // Stepping is a seek like any other, so the room steps with you.
        if (isRunning(session.playback)) {
          session.onIntent({ kind: 'pause', positionMs: Math.round(video.currentTime * 1000) })
        }
        seekTo(video.currentTime + direction * frame)
        return
      }

      video.pause()
      video.currentTime = clamp(video.currentTime + direction * frame, 0, video.duration || 0)
    },
    [item.fps, seekTo],
  )

  const adjustVolume = useCallback((delta: number) => {
    const video = videoRef.current
    if (!video) return
    const next = clamp(video.volume + delta, 0, 1)
    video.volume = next
    video.muted = next === 0
  }, [])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
  }, [])

  const adjustRate = useCallback((direction: 1 | -1) => {
    const video = videoRef.current
    if (!video) return
    const at = RATES.indexOf(nearestRate(video.playbackRate))
    video.playbackRate = RATES[Math.min(RATES.length - 1, Math.max(0, at + direction))] ?? 1
  }, [])

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current
    if (!shell) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void shell.requestFullscreen().catch(() => undefined)
  }, [])

  useImperativeHandle(
    handleRef,
    () => ({ togglePlay, seekBy, stepFrame, adjustRate, adjustVolume, toggleMute, toggleFullscreen }),
    [togglePlay, seekBy, stepFrame, adjustRate, adjustVolume, toggleMute, toggleFullscreen],
  )

  if (status.kind === 'error') {
    return (
      <div className="player player--message" role="alert">
        <p className="player__headline">This video couldn&apos;t be prepared</p>
        <p className="player__detail">{status.message}</p>
      </div>
    )
  }

  if (status.kind === 'preparing') {
    return (
      <div className="player player--message" role="status" aria-live="polite">
        <p className="player__headline">Preparing…</p>
        <p className="player__detail">{status.message}</p>
        {status.percent > 0 ? (
          <>
            <div className="player__progress">
              <div className="player__progress-fill" style={{ width: `${status.percent}%` }} />
            </div>
            <p className="player__detail">{status.percent}%</p>
          </>
        ) : null}
      </div>
    )
  }

  // Watching along with someone else's session: the picture follows them, and
  // the transport controls would only be buttons that do nothing.
  const locked = coWatch !== undefined && !coWatch.inControl

  return (
    <div className="player" ref={shellRef}>
      {/* The frame, not the video, takes part in layout. A <video> brings its
          own intrinsic size, which it gains and changes as metadata arrives,
          and that is how it ended up growing over the controls. Positioned
          inside a frame it can only ever fill the space it was given. */}
      <div className="player__frame">
      <video
        ref={(element) => {
          videoRef.current = element
          // Before anything plays, so there is no burst at the old level first.
          if (element && element.dataset['volumeApplied'] !== '1') {
            element.dataset['volumeApplied'] = '1'
            element.volume = initialVolume.current.volume
            element.muted = initialVolume.current.muted
          }
        }}
        className="player__video"
        src={status.media.url}
        loop={loop}
        // Chromium's default is to fetch metadata and stop, which leaves a
        // paused video unable to start — and in a session every video starts
        // paused, held by the ready gate until it can play.
        preload="auto"
        // In a session the ready gate decides when anyone starts, so the element
        // must not jump the gun on its own.
        autoPlay={autoplay && !inSession}
        // The library is browsed with the keyboard, so the native control bar
        // would only compete with ours for focus.
        controls={false}
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        // Playing again is a new playthrough, and a new end to report.
        onPlay={() => {
          ended.current = false
          setPlaying(true)
          report()
        }}
        onSeeking={() => {
          const video = videoRef.current
          if (!video) return
          const total = video.duration
          if (!Number.isFinite(total) || total - video.currentTime > END_SLACK_S) {
            ended.current = false
          }
        }}
        onPause={() => {
          setPlaying(false)
          report()
        }}
        onSeeked={report}
        onRateChange={report}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onVolumeChange={(event) => {
          const video = event.currentTarget
          setVolume(video.volume)
          setMuted(video.muted)
          if (!autoMuting.current) onVolumeChangeRef.current?.(video.volume, video.muted)
        }}
        onProgress={(event) => {
          const video = event.currentTarget
          setBuffered(video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0)
        }}
        onLoadedData={start}
        onCanPlay={start}
        onCanPlayThrough={() => {
          reportReady(true)
          start()
        }}
        onPlaying={() => {
          reportReady(true)
          stalled.current = false
          report()
        }}
        onStalled={() => trace('[player] stalled at', videoRef.current?.currentTime)}
        onSuspend={() => trace('[player] suspend at', videoRef.current?.currentTime)}
        onWaiting={() => {
          trace('[player] waiting at', videoRef.current?.currentTime)
          // Buffering here should stop the room, not leave everyone else ahead.
          reportReady(false)
          stalled.current = true
          report()
        }}
        onEmptied={() => trace('[player] emptied at', videoRef.current?.currentTime)}
        onAbort={() => trace('[player] abort at', videoRef.current?.currentTime)}
        onEnded={() => {
          trace('[player] ended at', videoRef.current?.currentTime)
          report()
          finish()
        }}
        onError={() => {
          const media = videoRef.current?.error
          trace('[player] error', media?.code, media?.message)
          setStatus({
            kind: 'error',
            message: media?.message
              ? `The player rejected this file: ${media.message}`
              : 'The player rejected this file even after preparing it.',
          })
        }}
      />
      </div>

      <div className="controls">
        <button
          type="button"
          className="controls__button"
          onClick={togglePlay}
          disabled={locked}
          title={locked ? 'Someone else is in control - ask for it to drive' : undefined}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <span className="controls__time">{formatDuration(currentTime * 1000) || '0:00'}</span>

        <div className="controls__scrub">
          <div
            className="controls__buffered"
            style={{ width: duration > 0 ? `${(buffered / duration) * 100}%` : '0%' }}
          />
          <input
            type="range"
            className="controls__range"
            min={0}
            max={duration > 0 ? duration : 0}
            step={0.01}
            value={currentTime}
            onChange={(event) => seekTo(Number(event.target.value))}
            disabled={locked}
            aria-label="Seek"
          />
        </div>

        <span className="controls__time">{formatDuration(duration * 1000) || '0:00'}</span>

        <button
          type="button"
          className="controls__button"
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted || volume === 0 ? '🔇' : '🔊'}
        </button>

        <input
          type="range"
          className="controls__volume"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(event) => {
            const video = videoRef.current
            if (!video) return
            video.volume = Number(event.target.value)
            video.muted = Number(event.target.value) === 0
          }}
          aria-label="Volume"
        />

        <button
          type="button"
          className="controls__button"
          onClick={toggleFullscreen}
          aria-label="Toggle fullscreen"
        >
          ⛶
        </button>
      </div>

      {underControls?.({ currentTime, duration, seek: seekTo })}
    </div>
  )
}

