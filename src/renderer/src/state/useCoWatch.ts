import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CoWatchIntent,
  CoWatchReach,
  CoWatchReaction,
  CoWatchSession,
  CoWatchTunnelProvider,
} from '@shared/types'

/** How long a reaction stays on screen. Matches the CSS animation. */
const REACTION_MS = 2_300

function idle(): CoWatchSession {
  return {
    active: false,
    url: null,
    invite: null,
    reach: 'lan',
    tunnel: 'off',
    tunnelMessage: null,
    provider: 'auto',
    tunnelKind: null,
    available: [],
    guests: [],
    knocking: [],
    playback: {
      mediaId: null,
      paused: true,
      positionMs: 0,
      updatedAt: Date.now(),
      actor: 'You',
      waiting: false,
      waitingFor: [],
    },
    control: { controller: 'You', inControl: true, requested: false, requests: [] },
    chat: [],
    queue: [],
    error: null,
  }
}

export interface CoWatchView {
  session: CoWatchSession
  /** Reactions currently in flight, for the overlay. */
  reactions: CoWatchReaction[]
  busy: boolean
  start: (reach: CoWatchReach, provider?: CoWatchTunnelProvider) => void
  /** Rescans for installed tunnel binaries. */
  refreshTunnels: () => void
  stop: () => void
  approve: (knockId: string, allow: boolean) => void
  kick: (guestId: string) => void
  say: (text: string) => void
  react: (emoji: string) => void
  intent: (intent: CoWatchIntent) => void
  requestControl: () => void
  cancelControlRequest: () => void
  answerControl: (peerId: string, allow: boolean) => void
  ready: (mediaId: number, ready: boolean) => void
  setQueue: (mediaIds: number[]) => void
  copyInvite: () => Promise<boolean>
}

/**
 * The host's view of a co-watching session.
 *
 * Every mutation returns the session as it now stands and that is what lands in
 * state, so the panel always shows what is true rather than what was asked for.
 * Between calls the main process pushes, because the session moves for reasons
 * the host never touched — someone knocking, a guest finishing a transcode.
 */
export function useCoWatch(): CoWatchView {
  const [session, setSession] = useState<CoWatchSession>(idle)
  const [reactions, setReactions] = useState<CoWatchReaction[]>([])
  const [busy, setBusy] = useState(false)

  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  useEffect(() => {
    void window.goonlib.cowatch.status().then(setSession).catch(() => undefined)

    const offUpdate = window.goonlib.cowatch.onUpdate(setSession)
    const offReaction = window.goonlib.cowatch.onReaction((reaction) => {
      setReactions((current) => [...current, reaction])
      const timer = setTimeout(
        () => setReactions((current) => current.filter((r) => r.id !== reaction.id)),
        REACTION_MS,
      )
      timers.current.push(timer)
    })

    return () => {
      offUpdate()
      offReaction()
      for (const timer of timers.current) clearTimeout(timer)
      timers.current = []
    }
  }, [])

  const run = useCallback(async (action: () => Promise<CoWatchSession>) => {
    setBusy(true)
    try {
      setSession(await action())
    } catch {
      // The push will correct us; a failed call is not worth its own banner.
    } finally {
      setBusy(false)
    }
  }, [])

  return useMemo(
    () => ({
      session,
      reactions,
      busy,
      start: (reach, provider) => void run(() => window.goonlib.cowatch.start(reach, provider)),
      refreshTunnels: () =>
        void window.goonlib.cowatch
          .tunnels()
          .then(() => window.goonlib.cowatch.status())
          .then(setSession)
          .catch(() => undefined),
      stop: () => void run(() => window.goonlib.cowatch.stop()),
      approve: (knockId, allow) =>
        void run(() => window.goonlib.cowatch.approve(knockId, allow)),
      kick: (guestId) => void run(() => window.goonlib.cowatch.kick(guestId)),
      say: (text) => void window.goonlib.cowatch.say(text).catch(() => undefined),
      react: (emoji) => void window.goonlib.cowatch.react(emoji).catch(() => undefined),
      intent: (intent) => void window.goonlib.cowatch.intent(intent).catch(() => undefined),
      requestControl: () => void window.goonlib.cowatch.requestControl().catch(() => undefined),
      cancelControlRequest: () =>
        void window.goonlib.cowatch.cancelControlRequest().catch(() => undefined),
      answerControl: (peerId, allow) =>
        void window.goonlib.cowatch.answerControl(peerId, allow).catch(() => undefined),
      ready: (mediaId, ready) =>
        void window.goonlib.cowatch.ready(mediaId, ready).catch(() => undefined),
      setQueue: (mediaIds) =>
        void window.goonlib.cowatch.setQueue(mediaIds).catch(() => undefined),
      copyInvite: () => window.goonlib.cowatch.copyInvite().catch(() => false),
    }),
    [session, reactions, busy, run],
  )
}
