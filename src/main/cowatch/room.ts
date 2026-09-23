/**
 * The room: who is in the session, what it is watching, and what has been said.
 *
 * Holds no sockets and no HTTP. It emits `change` when the snapshot moves and
 * `reaction` when something transient flies past; the server decides how to put
 * that on a wire. Keeping the two apart is what lets the join/approve/kick
 * sequence be tested without opening a port.
 *
 * The host is a peer in here like anybody else — same ready gate, and the same
 * rule for who drives — because the host's own machine may be the one still
 * transcoding, and a room that starts without waiting for it is just as broken.
 *
 * Exactly one peer is in control at a time. Everyone else can watch, talk and
 * react, and ask for control; only the controller can hand it over. Control
 * starts with the host and falls back to the host whenever the controller
 * leaves, so a session can never be left with nobody able to drive.
 */

import { EventEmitter } from 'node:events'
import { COWATCH_REACTIONS } from '@shared/types'
import type {
  CoWatchControl,
  CoWatchGuest,
  CoWatchIntent,
  CoWatchKnock,
  CoWatchMessage,
  CoWatchPlayback,
  CoWatchReaction,
} from '@shared/types'
import { Credentials, fingerprint, newId } from './auth'
import { initialState, positionAt, reduce, stragglers } from './sync'
import type { SyncState } from './sync'

/** The host's own peer id. Reserved, so no guest can impersonate it. */
export const HOST = 'host'

/** Concurrent approved guests. Small on purpose: this is a private session. */
export const MAX_GUESTS = 4

/** Knocks waiting at once, so an open invite cannot flood the approval list. */
const MAX_KNOCKS = 8

/** Chat kept in memory for the session and never written to disk. */
const CHAT_LIMIT = 200

/** A knock nobody answered stops cluttering the prompt after this. */
const KNOCK_TTL_MS = 5 * 60_000

/**
 * How long a reaction stays in the snapshot.
 *
 * Reactions are pushed the instant they happen, but a client whose event stream
 * is being buffered by something in the path only ever sees snapshots. Holding
 * them for a few seconds lets that client show them too, while staying far too
 * short to replay anything at someone who joins later.
 */
const REACTION_TTL_MS = 6_000

/** The allow-list, taken from the one place both sides of the app read it. */
const ALLOWED_REACTIONS = new Set(COWATCH_REACTIONS.map((reaction) => reaction.id))

export function isReaction(value: unknown): value is string {
  return typeof value === 'string' && ALLOWED_REACTIONS.has(value)
}

/** A message as stored: the author, not what any particular screen calls them. */
interface ChatEntry {
  id: string
  fromId: string
  text: string
  at: number
}

interface GuestRecord {
  id: string
  name: string
  address: string
  joinedAt: number
  latencyMs: number | null
  /** Event streams currently open for this guest. */
  streams: number
  /** Host clock of their last request of any kind. */
  lastSeen: number
  /** Counted by the ready gate. False once they have been silent for PRESENCE_MS. */
  present: boolean
}

/**
 * How long a guest can go without any request before the room stops waiting for
 * them.
 *
 * Every client polls or streams continuously, so silence this long means the tab
 * is closed, the phone is asleep, or the network is gone. They stay in the room
 * with their credential intact — coming back is just another request — but
 * nobody is held up for a player that is not there.
 */
export const PRESENCE_MS = 12_000

/** A reaction before anybody's name has been put on it. */
export interface RawReaction {
  id: string
  fromId: string
  emoji: string
  at: number
}

export interface RoomSnapshot {
  guests: CoWatchGuest[]
  /** What the host is called, from Settings -> Watch Together. */
  hostName: string
  /** Reactions from the last few seconds, for clients that cannot be pushed to. */
  reactions: CoWatchReaction[]
  /** Whether the host's own machine can play the current item. */
  hostReady: boolean
  knocking: CoWatchKnock[]
  playback: CoWatchPlayback
  control: CoWatchControl
  chat: CoWatchMessage[]
  queue: number[]
}

export class Room extends EventEmitter {
  private sync: SyncState
  private readonly guests = new Map<string, GuestRecord>()
  private readonly knocks = new Map<string, CoWatchKnock>()
  private readonly credentials = new Credentials()
  private chat: ChatEntry[] = []
  private queue: number[] = []
  private recent: RawReaction[] = []
  /** The one peer whose intents are applied. */
  private controller: string = HOST
  /** peerId -> when they asked for control. */
  private readonly requests = new Map<string, number>()

  /** What guests call the host. Read each time, so a rename shows at once. */
  hostName: () => string = () => 'host'

  constructor(now: number = Date.now()) {
    super()
    // The host is present from the first moment and is gated like everyone else.
    this.sync = reduce(initialState(now), { type: 'peer-join', peer: HOST }, now)
  }

  // --- membership -----------------------------------------------------------

  /**
   * Records someone holding a valid invite. Returns null when the room is full
   * or the queue of unanswered knocks is — an invite that leaked should not be
   * able to keep the approval prompt permanently occupied.
   */
  knock(name: unknown, address: string, now: number = Date.now()): CoWatchKnock | null {
    this.expireKnocks(now)
    if (this.guests.size >= MAX_GUESTS || this.knocks.size >= MAX_KNOCKS) return null

    const id = newId()
    const knock: CoWatchKnock = {
      id,
      name: cleanName(name),
      address,
      // Seeded from the knock id, so the two words are unpredictable and appear
      // on both screens without either side having to send them to the other.
      fingerprint: fingerprint(id),
      at: now,
    }

    this.knocks.set(id, knock)
    this.changed()
    return knock
  }

  /** Lets a knock in and mints its credential. Null if the knock has expired. */
  approve(
    knockId: string,
    now: number = Date.now(),
  ): { guest: CoWatchGuest; cookie: string } | null {
    const knock = this.knocks.get(knockId)
    if (!knock) return null
    if (this.guests.size >= MAX_GUESTS) return null

    this.knocks.delete(knockId)

    const record: GuestRecord = {
      // The knock id becomes the guest id, so the fingerprint the host approved
      // stays attached to the person who was approved.
      id: knock.id,
      name: knock.name,
      address: knock.address,
      joinedAt: now,
      latencyMs: null,
      streams: 0,
      // They are polling the knock endpoint right now, so they count as here.
      lastSeen: now,
      present: true,
    }

    this.guests.set(record.id, record)
    const cookie = this.credentials.issue(record.id, now)
    this.sync = reduce(this.sync, { type: 'peer-join', peer: record.id }, now)
    this.changed()

    return { guest: this.viewOf(record), cookie }
  }

  deny(knockId: string): void {
    if (this.knocks.delete(knockId)) this.changed()
  }

  /** Removes a guest and tears up their credential in the same breath. */
  kick(guestId: string, now: number = Date.now()): void {
    if (!this.guests.delete(guestId)) return
    this.credentials.revoke(guestId)
    this.sync = reduce(this.sync, { type: 'peer-leave', peer: guestId }, now)
    this.releaseControl(guestId)
    this.emit('evict', guestId)
    this.changed()
  }

  /** Counts a guest's event streams opening and closing, without removing them. */
  setConnected(guestId: string, connected: boolean, now: number = Date.now()): void {
    const guest = this.guests.get(guestId)
    if (!guest) return
    guest.streams = Math.max(0, guest.streams + (connected ? 1 : -1))
    // A closing stream starts the grace period rather than ending presence
    // outright: a reconnect is usually a second away.
    guest.lastSeen = now
    this.updatePresence(guest, now)
  }

  /** Records that a guest made a request, which is proof they are still here. */
  touch(guestId: string, now: number = Date.now()): void {
    const guest = this.guests.get(guestId)
    if (!guest) return
    guest.lastSeen = now
    if (!guest.present) this.updatePresence(guest, now)
  }

  setLatency(guestId: string, latencyMs: number): void {
    const guest = this.guests.get(guestId)
    if (!guest) return
    guest.latencyMs = Math.max(0, Math.round(latencyMs))
  }

  guestFor(cookie: string | null | undefined): string | null {
    const id = this.credentials.guestFor(cookie)
    return id !== null && this.guests.has(id) ? id : null
  }

  /**
   * What `peerId` should be called on `viewer`'s screen.
   *
   * Resolved when read rather than when written, because the same message has
   * to read as "You" to its author and as a name to everyone else. Baking the
   * label in at write time is how the host ends up telling a guest that the
   * room is waiting for "You".
   */
  nameOf(peerId: string, viewer: string = HOST): string {
    if (peerId === viewer) return 'You'
    if (peerId === HOST) return this.hostName()
    return this.guests.get(peerId)?.name ?? 'Someone'
  }

  // --- what we are watching -------------------------------------------------

  /**
   * Applies a proposed change, if `actor` is the one in control. Anyone else's
   * intent is refused, host included, and false says so.
   */
  apply(actor: string, intent: CoWatchIntent, now: number = Date.now()): boolean {
    if (actor !== this.controller) return false
    const before = this.sync

    switch (intent.kind) {
      case 'open':
        this.sync = reduce(
          this.sync,
          {
            type: 'open',
            mediaId: intent.mediaId,
            positionMs: intent.positionMs,
            autoplay: intent.autoplay ?? true,
            actor,
          },
          now,
        )
        break
      case 'play':
        this.sync = reduce(this.sync, { type: 'play', actor }, now)
        break
      case 'pause':
        this.sync = reduce(this.sync, { type: 'pause', positionMs: intent.positionMs, actor }, now)
        break
      case 'seek':
        this.sync = reduce(this.sync, { type: 'seek', positionMs: intent.positionMs, actor }, now)
        break
      case 'close':
        this.sync = reduce(this.sync, { type: 'close', actor }, now)
        break
    }

    if (this.sync !== before) this.changed()
    return true
  }

  // --- who is driving -------------------------------------------------------

  get controllerId(): string {
    return this.controller
  }

  /** Asks the controller for control. False if there is nothing to ask. */
  requestControl(peer: string, now: number = Date.now()): boolean {
    if (!this.isMember(peer) || peer === this.controller || this.requests.has(peer)) return false
    this.requests.set(peer, now)
    this.changed()
    return true
  }

  cancelControlRequest(peer: string): void {
    if (this.requests.delete(peer)) this.changed()
  }

  /**
   * The controller's answer to a request. Only the controller may answer, and
   * only a request that is actually open — so nobody can hand control to
   * themselves by answering on the controller's behalf.
   */
  answerControl(answerer: string, peer: string, allow: boolean): boolean {
    if (answerer !== this.controller || !this.requests.has(peer)) return false
    this.requests.delete(peer)
    if (allow && this.isMember(peer)) this.controller = peer
    this.changed()
    return true
  }

  ready(peer: string, mediaId: number, ready: boolean, now: number = Date.now()): void {
    const before = this.sync
    this.sync = reduce(this.sync, { type: 'ready', peer, mediaId, ready }, now)
    if (this.sync !== before) this.changed()
  }

  /** Lets the ready gate time out even when nobody sends anything. */
  tick(now: number = Date.now()): void {
    this.expireKnocks(now)
    for (const guest of this.guests.values()) this.updatePresence(guest, now)
    const before = this.sync
    this.sync = reduce(this.sync, { type: 'tick' }, now)
    if (this.sync !== before) this.changed()
  }

  get mediaId(): number | null {
    return this.sync.mediaId
  }

  // --- talking --------------------------------------------------------------

  say(from: string, text: unknown, now: number = Date.now()): boolean {
    const clean = cleanText(text)
    if (!clean) return false

    this.chat = [...this.chat, { id: newId(), fromId: from, text: clean, at: now }].slice(
      -CHAT_LIMIT,
    )
    this.changed()
    return true
  }

  react(from: string, emoji: unknown, now: number = Date.now()): RawReaction | null {
    if (!isReaction(emoji)) return null

    const reaction: RawReaction = { id: newId(), fromId: from, emoji, at: now }
    this.recent = [...this.recent, reaction].filter((r) => now - r.at < REACTION_TTL_MS).slice(-20)
    // Transient by design: a reaction is a moment, not a record, so it never
    // enters the snapshot and nothing replays it for a late joiner.
    this.emit('reaction', reaction)
    return reaction
  }

  /** Puts a viewer's own name on a reaction on its way out to them. */
  resolveReaction(raw: RawReaction, viewer: string = HOST): CoWatchReaction {
    return { id: raw.id, from: this.nameOf(raw.fromId, viewer), emoji: raw.emoji, at: raw.at }
  }

  setQueue(mediaIds: unknown): void {
    const list = Array.isArray(mediaIds) ? mediaIds : []
    const next = list
      .filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
      .slice(0, 500)

    if (sameOrder(next, this.queue)) return
    this.queue = next
    this.changed()
  }

  // --- reading --------------------------------------------------------------

  /** The room as `viewer` should see it. Defaults to the host's own view. */
  snapshot(now: number = Date.now(), viewer: string = HOST): RoomSnapshot {
    const waitingFor = stragglers(this.sync).map((peer) => this.nameOf(peer, viewer))

    return {
      guests: [...this.guests.values()].map((guest) => this.viewOf(guest, viewer)),
      hostName: this.hostName(),
      hostReady: this.sync.ready[HOST] ?? false,
      knocking: [...this.knocks.values()],
      playback: {
        mediaId: this.sync.mediaId,
        paused: this.sync.paused,
        positionMs: positionAt(this.sync, now),
        updatedAt: now,
        actor: this.nameOf(this.sync.actor, viewer),
        waiting: this.sync.waiting,
        waitingFor,
      },
      control: {
        controller: this.nameOf(this.controller, viewer),
        inControl: this.controller === viewer,
        requested: this.requests.has(viewer),
        // Only the controller can answer, so only the controller is shown them.
        requests:
          this.controller === viewer
            ? [...this.requests].map(([id, at]) => ({ id, name: this.nameOf(id, viewer), at }))
            : [],
      },
      reactions: this.recent
        .filter((raw) => now - raw.at < REACTION_TTL_MS)
        .map((raw) => this.resolveReaction(raw, viewer)),
      chat: this.chat.map(
        (entry): CoWatchMessage => ({
          id: entry.id,
          from: this.nameOf(entry.fromId, viewer),
          text: entry.text,
          at: entry.at,
        }),
      ),
      queue: this.queue,
    }
  }

  /** Ends everything. Every credential dies here, which is the whole guarantee. */
  close(): void {
    this.credentials.clear()
    this.guests.clear()
    this.knocks.clear()
    this.chat = []
    this.queue = []
    this.recent = []
    this.requests.clear()
    this.controller = HOST
    this.removeAllListeners()
  }

  private viewOf(record: GuestRecord, viewer: string = HOST): CoWatchGuest {
    return {
      id: record.id,
      name: this.nameOf(record.id, viewer),
      address: record.address,
      joinedAt: record.joinedAt,
      ready: this.sync.ready[record.id] ?? false,
      latencyMs: record.latencyMs,
      connected: record.present,
    }
  }

  private isMember(peer: string): boolean {
    return peer === HOST || this.guests.get(peer)?.present === true
  }

  /**
   * Brings a guest's presence up to date, and the ready gate with it.
   *
   * Leaving the gate is what stops a closed tab from holding every later video
   * for the full timeout; rejoining it is what makes a returning guest count
   * again. Their record and credential are untouched either way.
   */
  private updatePresence(guest: GuestRecord, now: number): void {
    const present = guest.streams > 0 || now - guest.lastSeen < PRESENCE_MS
    if (present === guest.present) return

    guest.present = present
    this.sync = reduce(this.sync, { type: present ? 'peer-join' : 'peer-leave', peer: guest.id }, now)
    if (!present) this.releaseControl(guest.id)
    this.changed()
  }

  /** Forgets a departing peer's request, and hands control back if it was theirs. */
  private releaseControl(peer: string): void {
    this.requests.delete(peer)
    if (this.controller === peer) this.controller = HOST
  }

  private expireKnocks(now: number): void {
    let dropped = false
    for (const [id, knock] of this.knocks) {
      if (now - knock.at > KNOCK_TTL_MS) {
        this.knocks.delete(id)
        dropped = true
      }
    }
    if (dropped) this.changed()
  }

  /** Tells everyone the room changed, when something it reads from did. */
  touchAll(): void {
    this.changed()
  }

  private changed(): void {
    this.emit('change')
  }
}

/**
 * Replaces every control character in a string.
 *
 * Written as a codepoint scan rather than a regex character class because the
 * class would have to contain literal control bytes to be read, and a source
 * file nobody can safely open in an editor is its own kind of bug.
 */
function stripControls(value: string, replacement: string): string {
  let out = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    out += code < 0x20 || code === 0x7f ? replacement : char
  }
  return out
}

/**
 * A guest picks their own display name, and it is rendered on the host's screen
 * and in everyone's chat. Control characters are stripped rather than escaped
 * because there is no legitimate name containing them.
 */
export function cleanName(name: unknown): string {
  const text = typeof name === 'string' ? name : ''
  return stripControls(text, '').trim().slice(0, 24) || 'Guest'
}

export function cleanText(text: unknown): string {
  const value = typeof text === 'string' ? text : ''
  // Newlines collapse to spaces: chat here is one line per message.
  return stripControls(value, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
}

function sameOrder(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}
