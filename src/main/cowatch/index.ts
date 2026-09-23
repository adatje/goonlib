/**
 * Co-watching, as the rest of the app sees it.
 *
 * Owns the lifetime of one session: the room, the server bound to it, and the
 * tunnel in front of it. Starting is allowed to half-fail — a session whose
 * tunnel would not come up is still perfectly usable over the local network, so
 * that case reports the problem and keeps running rather than tearing
 * everything down.
 *
 * Stopping is deliberately total. There is no pause: the port closes, every
 * credential is destroyed, and the tunnel process is killed, so "stop sharing"
 * is a fact rather than a request.
 */

import { EventEmitter } from 'node:events'
import type {
  CoWatchIntent,
  CoWatchReach,
  CoWatchSession,
  CoWatchTunnelProvider,
  CoWatchTunnelState,
} from '@shared/types'
import { hostName } from '../db/settings'
import { newInvite } from './auth'
import { HOST, Room } from './room'
import type { RawReaction } from './room'
import type { ToyOffer } from './protocol'
import { SessionServer } from './server'
import { availableTunnels, startTunnel } from './tunnel'
import type { Tunnel } from './tunnel'

function emptySession(): CoWatchSession {
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

class CoWatch extends EventEmitter {
  private room: Room | null = null
  private server: SessionServer | null = null
  private tunnel: Tunnel | null = null
  private invite: string | null = null
  private reach: CoWatchReach = 'lan'
  private tunnelState: CoWatchTunnelState = 'off'
  private tunnelMessage: string | null = null
  private provider: CoWatchTunnelProvider = 'auto'
  /** Cached between panel opens; refreshed by `tunnels()`. */
  private available: string[] = []
  private lanUrls: string[] = []
  private error: string | null = null
  /** Guards against two starts racing each other into two open ports. */
  private starting = false
  /** Kept here so a session started later still offers the toy. */
  private toyOffer: ToyOffer | null = null
  private buzzHandler: ((guestId: string, name: string, body: unknown) => string) | null = null

  get active(): boolean {
    return this.room !== null
  }

  /** Rescans for installed tunnel binaries and remembers what it found. */
  async tunnels(): Promise<string[]> {
    this.available = await availableTunnels()
    return this.available
  }

  status(): CoWatchSession {
    const room = this.room
    if (!room || !this.invite) {
      return { ...emptySession(), provider: this.provider, available: this.available }
    }

    const snapshot = room.snapshot()

    return {
      active: true,
      url: this.inviteUrl(),
      invite: this.invite,
      reach: this.reach,
      tunnel: this.tunnelState,
      tunnelMessage: this.tunnelMessage,
      provider: this.provider,
      tunnelKind: this.tunnel?.kind ?? null,
      available: this.available,
      guests: snapshot.guests,
      knocking: snapshot.knocking,
      playback: snapshot.playback,
      control: snapshot.control,
      chat: snapshot.chat,
      queue: snapshot.queue,
      error: this.error,
    }
  }

  async start(
    reach: CoWatchReach,
    provider: CoWatchTunnelProvider = 'auto',
  ): Promise<CoWatchSession> {
    if (this.room) return this.status()
    if (this.starting) return this.status()
    this.starting = true

    try {
      const room = new Room()
      room.hostName = hostName
      const invite = newInvite()
      const server = new SessionServer(room, invite)
      server.setToyOffer(this.toyOffer)
      // Names are resolved as the host sees them, since it is the host's panel
      // that says who is buzzing.
      server.onBuzz = (guestId, body) =>
        this.buzzHandler?.(guestId, room.nameOf(guestId), body) ?? 'off'

      const address = await server.listen()

      this.room = room
      this.server = server
      this.invite = invite
      this.reach = reach
      this.provider = provider
      this.lanUrls = address.lanUrls
      this.error = null
      this.tunnelState = 'off'
      this.tunnelMessage = null

      // Anything that moves the room moves the host's interface too.
      room.on('change', () => this.emit('change'))
      room.on('reaction', (raw: RawReaction) => this.emit('reaction', room.resolveReaction(raw)))

      if (reach === 'tunnel') {
        this.tunnelState = 'starting'
        this.emit('change')
        await this.openTunnel(address.port, provider)
      }

      this.emit('change')
      return this.status()
    } catch (err) {
      // Nothing half-open survives a failed start.
      await this.stop()
      this.error = (err as Error).message
      this.emit('change')
      return this.status()
    } finally {
      this.starting = false
    }
  }

  /**
   * Brings the tunnel up beside an already-listening server.
   *
   * A failure here is reported, not thrown: the local-network URL still works,
   * and losing the whole session because cloudflared is not installed would be
   * a worse answer than saying so.
   */
  private async openTunnel(port: number, provider: CoWatchTunnelProvider): Promise<void> {
    try {
      this.tunnel = await startTunnel(port, provider)
      this.tunnelState = 'up'
      this.tunnelMessage = null
    } catch (err) {
      this.tunnel = null
      this.tunnelState = 'error'
      this.tunnelMessage = (err as Error).message
    }
  }

  async stop(): Promise<CoWatchSession> {
    this.tunnel?.stop()
    this.tunnel = null

    await this.server?.close()
    this.server = null

    this.room?.close()
    this.room = null

    this.invite = null
    this.lanUrls = []
    this.tunnelState = 'off'
    this.tunnelMessage = null

    this.emit('change')
    return this.status()
  }

  approve(knockId: string, allow: boolean): CoWatchSession {
    const room = this.room
    if (!room) return this.status()

    if (!allow) {
      room.deny(knockId)
      return this.status()
    }

    const admitted = room.approve(knockId)
    // The cookie is parked for the guest's next poll rather than pushed: the
    // knocking browser has no connection we could push down yet.
    if (admitted) this.server?.offerCookie(knockId, admitted.cookie)

    return this.status()
  }

  kick(guestId: string): CoWatchSession {
    this.room?.kick(guestId)
    return this.status()
  }

  /** The host acting, under the same rule as any guest: only while in control. */
  intent(intent: CoWatchIntent): void {
    this.room?.apply(HOST, intent)
  }

  requestControl(): void {
    this.room?.requestControl(HOST)
  }

  cancelControlRequest(): void {
    this.room?.cancelControlRequest(HOST)
  }

  answerControl(peerId: string, allow: boolean): void {
    this.room?.answerControl(HOST, peerId, allow)
  }

  ready(mediaId: number, ready: boolean): void {
    this.room?.ready(HOST, mediaId, ready)
  }

  say(text: string): void {
    this.room?.say(HOST, text)
  }

  react(emoji: string): void {
    this.room?.react(HOST, emoji)
  }

  /** Re-sends the room to everyone, after something outside it changed how it reads. */
  refresh(): void {
    this.room?.touchAll()
  }

  setQueue(mediaIds: number[]): void {
    this.room?.setQueue(mediaIds)
  }

  /** Who answers guests' buzzes. Set once, by whatever owns the toy. */
  setBuzzHandler(handler: (guestId: string, name: string, body: unknown) => string): void {
    this.buzzHandler = handler
  }

  /** What guests are offered of the toy right now; null offers nothing. */
  setToyOffer(offer: ToyOffer | null): void {
    this.toyOffer = offer
    this.server?.setToyOffer(offer)
  }

  /** The link to hand someone: the tunnel's if it came up, the LAN's otherwise. */
  private inviteUrl(): string | null {
    if (!this.invite) return null
    if (this.tunnel) return `${this.tunnel.url}/j/${this.invite}`
    return this.lanUrls[0] ?? null
  }

  /** Every address that would work, for the host to pick from. */
  allUrls(): string[] {
    const urls = [...this.lanUrls]
    if (this.tunnel && this.invite) urls.unshift(`${this.tunnel.url}/j/${this.invite}`)
    return urls
  }
}

export const cowatch = new CoWatch()
