/**
 * Request shaping for the session server.
 *
 * Split out for the same reason `protocol/serve.ts` is: this is the code that
 * decides what a stranger's parameters are allowed to mean, and it should be
 * verifiable without booting an app, a database, or a port.
 */

import { networkInterfaces } from 'node:os'
import type { IncomingMessage } from 'node:http'
import type { MediaKind, MediaQuery, MediaSort } from '@shared/types'
import type { RoomSnapshot } from './room'

/** Largest page a guest may pull, mirroring the ceiling the IPC layer applies. */
export const MAX_PAGE = 200

/** Rows a guest gets when they ask for nothing in particular. */
const DEFAULT_PAGE = 60

/**
 * What a guest is allowed to see of the room.
 *
 * Addresses are stripped and knocks are omitted entirely: who else is trying to
 * get in, and from where, is the host's business. A guest sees the people
 * actually in the room with them, and nothing about the door.
 */
export interface GuestView {
  guests: Array<{ name: string; ready: boolean; connected: boolean }>
  playback: RoomSnapshot['playback']
  control: RoomSnapshot['control']
  chat: RoomSnapshot['chat']
  /** Recent reactions, so a client that only polls still sees them. */
  reactions: RoomSnapshot['reactions']
  queue: number[]
  /**
   * The host's toy, when they have offered it: the ceilings to show on the
   * buzz controls. Null hides the controls entirely — a guest is never told
   * there is a toy they are not being offered.
   */
  toy: ToyOffer | null
}

export interface ToyOffer {
  maxIntensity: number
  maxSeconds: number
  /** Every pattern a guest may pick, the host's saved ones included. */
  patterns: Array<{ id: string; label: string }>
}

export function guestView(snapshot: RoomSnapshot, toy: ToyOffer | null = null): GuestView {
  return {
    // The host never appears in the room's guest list, but from a guest's side
    // they are the other person in the room — and the one most likely to be
    // holding everybody up while something transcodes.
    guests: [
      { name: snapshot.hostName, ready: snapshot.hostReady, connected: true },
      ...snapshot.guests.map((guest) => ({
        name: guest.name,
        ready: guest.ready,
        connected: guest.connected,
      })),
    ],
    playback: snapshot.playback,
    control: snapshot.control,
    chat: snapshot.chat,
    reactions: snapshot.reactions,
    queue: snapshot.queue,
    toy,
  }
}

/** Bridges node's request into the Fetch shape `serveFile` expects. */
export function toRequest(req: IncomingMessage): Request {
  const headers = new Headers()
  const range = req.headers.range
  if (typeof range === 'string') headers.set('range', range)

  return new Request('http://localhost/', {
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    headers,
  })
}

/**
 * A media id, or null for anything that is not one.
 *
 * Every id a guest sends passes through here before it reaches a query. Row ids
 * only: a guest never sends a path, and could not use one if they did.
 */
export function idFrom(value: unknown): number | null {
  const id = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function safeMs(value: unknown): number {
  const ms = Number(value)
  return Number.isFinite(ms) && ms >= 0 ? Math.floor(ms) : 0
}

const SORTS = new Set<MediaSort>(['added', 'name', 'size', 'duration', 'manual', 'shuffle'])

/** Builds a library query from a guest's parameters, clamped at every edge. */
export function queryFrom(url: URL): MediaQuery {
  const params = url.searchParams
  const kind = params.get('kind')
  const sort = params.get('sort')
  const limit = Number(params.get('limit'))
  const offset = Number(params.get('offset'))

  return {
    kind: kind === 'image' || kind === 'video' ? (kind as MediaKind) : 'all',
    search: params.get('search') ?? undefined,
    rootId: idFrom(params.get('rootId')) ?? undefined,
    pathPrefix: params.get('pathPrefix') ?? undefined,
    directOnly: params.get('directOnly') === '1',
    collectionId: idFrom(params.get('collectionId')) ?? undefined,
    tagId: idFrom(params.get('tagId')) ?? undefined,
    favorite: params.get('favorite') === '1',
    sort: sort !== null && SORTS.has(sort as MediaSort) ? (sort as MediaSort) : 'added',
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    seed: idFrom(params.get('seed')) ?? undefined,
    limit: Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), MAX_PAGE) : DEFAULT_PAGE,
    offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
  }
}

/** Every address on this machine a guest on the same network could reach. */
export function lanUrlsFor(port: number, invite: string): string[] {
  const urls: string[] = []

  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4') continue
      urls.push(`http://${entry.address}:${port}/j/${invite}`)
    }
  }

  return urls
}
