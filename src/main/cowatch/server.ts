/**
 * The session server: the one door guests come through.
 *
 * A browser guest and a GoonLib guest are the same client to this file — both
 * get an authenticated video stream and an event stream, and the only thing
 * that differs is who renders it. That is deliberate: two front doors onto one
 * server is a feature, two servers is a maintenance problem.
 *
 * Transport is Server-Sent Events downstream and ordinary POSTs upstream,
 * rather than a WebSocket. It needs no dependency, it reconnects by itself, and
 * it survives every tunnel and proxy in the path without negotiation.
 */

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { spritePathFor, thumbPathFor } from '../cache'
import { listCollections } from '../db/collections'
import { listChildFolders } from '../db/folders'
import { listAnnotations } from '../db/labels'
import { getMedia, listMedia, listMediaIds } from '../db/media'
import { libraryStats, listRoots } from '../db/queries'
import { listTags } from '../db/tags'
import { playablePathFor, preparer } from '../media/prepare'
import { contentTypeFor, serveFile } from '../protocol/serve'
import { readCookie, tokensMatch } from './auth'
import { guestView, idFrom, lanUrlsFor, queryFrom, safeMs, toRequest } from './protocol'
import type { GuestView, ToyOffer } from './protocol'
import { appPage, joinPage } from './client'
import { addressOf, html, json, readJson, respondWith, text } from './http'
import { Room } from './room'
import type { RawReaction } from './room'

const COOKIE = 'goonlib_cowatch'

/** Keeps the event stream from being closed by an idle proxy mid-film. */
const HEARTBEAT_MS = 15_000

/**
 * How often the room is ticked. Short, because the tick is what notices a guest
 * has gone quiet and stops the ready gate waiting for them.
 */
const TICK_MS = 2_000

/**
 * How long a guest's credential lasts in their browser. Only an upper bound: the
 * session ending revokes it server-side regardless. It exists so a phone that
 * throws away session cookies when the tab is backgrounded can still come back.
 */
const COOKIE_MAX_AGE_S = 12 * 60 * 60

/**
 * Requests per minute per address, before we stop answering.
 *
 * Set well above what a working client needs. This exists so a leaked invite
 * cannot be hammered, not to police normal use — and a limit tight enough to
 * trip during an ordinary session breaks the feature far more reliably than it
 * protects it.
 */
const RATE_LIMIT = 900

/**
 * Answers a guest's buzz. Supplied by whoever owns the toy; the server only
 * carries the request and the answer, and never decides anything about it.
 */
export type BuzzHandler = (guestId: string, body: unknown) => string

interface Subscriber {
  guestId: string
  res: ServerResponse
}

export interface ServerAddress {
  port: number
  /** Every address a guest on the local network could use to reach us. */
  lanUrls: string[]
}

/**
 * Wraps one HTTP server bound to one room. Constructing it does nothing; the
 * port is only opened by `listen`, and `close` is a full teardown rather than a
 * pause — there is no state left behind that could still answer a request.
 */
export class SessionServer {
  private server: Server | null = null
  private readonly subscribers = new Set<Subscriber>()
  private readonly hits = new Map<string, { count: number; resetAt: number }>()
  /** Cookies minted by an approval, waiting for the guest's next poll to collect. */
  private readonly pendingCookies = new Map<string, string>()
  private heartbeat: NodeJS.Timeout | null = null
  private toyOffer: ToyOffer | null = null
  /** Null until the host's side wires one up, which answers every buzz 'off'. */
  onBuzz: BuzzHandler | null = null

  constructor(
    readonly room: Room,
    private readonly invite: string,
  ) {
    this.room.on('change', () => this.broadcastState())
    this.room.on('reaction', (raw: RawReaction) => {
      // Resolved per recipient, so a reaction reads as "You" to whoever sent it.
      for (const subscriber of this.subscribers) {
        this.write(subscriber, 'reaction', this.room.resolveReaction(raw, subscriber.guestId))
      }
    })
    // Kicking someone has to reach through to their socket, or they keep
    // receiving the stream they were just removed from.
    this.room.on('evict', (guestId: string) => this.dropSubscribers(guestId))
  }

  async listen(port = 0): Promise<ServerAddress> {
    const server = createServer((req, res) => {
      void this.route(req, res).catch(() => {
        if (!res.headersSent) res.statusCode = 500
        res.end()
      })
    })

    // Bound to every interface on purpose: a guest on the local network is the
    // simplest case this feature has, and a tunnel reaches us over loopback
    // either way.
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '0.0.0.0', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })

    this.server = server
    const address = server.address()
    const boundPort = typeof address === 'object' && address ? address.port : port

    let lastPing = Date.now()
    this.heartbeat = setInterval(() => {
      this.room.tick()
      if (Date.now() - lastPing >= HEARTBEAT_MS) {
        lastPing = Date.now()
        this.ping()
      }
    }, TICK_MS)

    return { port: boundPort, lanUrls: lanUrlsFor(boundPort, this.invite) }
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null

    /*
     * Tell every guest the session is over before the socket goes.
     *
     * A stream that simply ends looks exactly like a stream that broke, so
     * without this a guest sat under a "connection lost" banner, polling a
     * host that was never coming back, with a stale library still on screen.
     * One event is the difference between "this ended" and "this is broken".
     */
    for (const subscriber of this.subscribers) {
      this.write(subscriber, 'ended', null)
      subscriber.res.end()
    }
    this.subscribers.clear()

    const server = this.server
    this.server = null
    if (!server) return

    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      // Anyone mid-download would otherwise hold the server open indefinitely.
      server.closeAllConnections()
    })
  }

  // --- routing --------------------------------------------------------------

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname

    // Only the control plane. A seeking <video> issues range requests in
    // bursts, and throttling those would show up as stuttering playback rather
    // than as the abuse protection it was meant to be.
    const metered = path.startsWith('/api/') || path.startsWith('/j/')
    if (metered && !this.allow(addressOf(req))) {
      await respondWith(res, text('Slow down', 429))
      return
    }

    // --- unauthenticated: the join handshake, and nothing else ---
    if (path.startsWith('/j/')) {
      // Someone already let in, reopening the link — a new tab, a phone that
      // slept, a bookmark. They go straight back to the session rather than
      // knocking again and leaving a ghost of themselves in the room.
      if (this.room.guestFor(readCookie(req.headers.cookie, COOKIE))) {
        await respondWith(res, new Response(null, { status: 302, headers: { Location: '/' } }))
        return
      }

      // A wrong invite gets the same page a right one does, so the response
      // cannot be used to test tokens. The knock is what actually fails, and
      // the page reads the token it should send out of its own URL.
      await respondWith(res, html(joinPage()))
      return
    }

    if (path === '/api/knock' && req.method === 'POST') {
      await this.knock(req, res)
      return
    }

    if (path === '/api/knock' && req.method === 'GET') {
      await this.knockStatus(req, res, url)
      return
    }

    // --- everything past here needs a credential the host granted ---
    const guestId = this.room.guestFor(readCookie(req.headers.cookie, COOKIE))
    if (!guestId) {
      await respondWith(res, path.startsWith('/api/') ? json({ error: 'not-approved' }, 403) : html(deniedPage(), 403))
      return
    }

    // Any request at all is proof of life, including a polling client that
    // never holds an event stream open.
    this.room.touch(guestId)

    switch (true) {
      case path === '/':
        await respondWith(res, html(appPage()))
        return

      case path === '/api/events':
        this.subscribe(guestId, res)
        return

      case path === '/api/state':
        // The same payload the event stream pushes. A client that cannot be
        // pushed to polls this instead, which keeps the session working through
        // any proxy that mangles streaming.
        await respondWith(res, json(this.stateFor(guestId)))
        return

      case path === '/api/time':
        // Two clocks, one round trip. The guest works out the offset itself.
        await respondWith(res, json({ sent: Number(url.searchParams.get('t') ?? 0), host: Date.now() }))
        return

      case path === '/api/intent' && req.method === 'POST':
        await this.intent(guestId, req, res)
        return

      case path === '/api/ready' && req.method === 'POST':
        await this.ready(guestId, req, res)
        return

      case path === '/api/say' && req.method === 'POST':
        await this.act(req, res, (body) => void this.room.say(guestId, body['text']))
        return

      case path === '/api/react' && req.method === 'POST':
        await this.act(req, res, (body) => void this.room.react(guestId, body['emoji']))
        return

      case path === '/api/buzz' && req.method === 'POST': {
        const body = await readJson(req)
        const outcome = this.onBuzz?.(guestId, body) ?? 'off'
        await respondWith(res, json({ outcome }))
        return
      }

      case path === '/api/control' && req.method === 'POST':
        await this.control(guestId, req, res)
        return

      case path === '/api/item': {
        const item = getMedia(idFrom(url.searchParams.get('id')) ?? 0)
        await respondWith(res, item ? json(item) : json({ error: 'not-found' }, 404))
        return
      }

      case path === '/api/queue' && req.method === 'POST':
        await this.act(req, res, (body) => this.room.setQueue(body['mediaIds']))
        return

      case path === '/api/prepare' && req.method === 'POST':
        await this.prepare(req, res)
        return

      case path === '/api/library':
        await respondWith(res, json(listMedia(queryFrom(url))))
        return

      case path === '/api/ids':
        await respondWith(res, json(listMediaIds(queryFrom(url))))
        return

      case path === '/api/folders': {
        // A source switched off in the app is not browsable here either.
        const rootId = Number(url.searchParams.get('rootId') ?? 0)
        const enabled = listRoots().some((root) => root.id === rootId && root.enabled)
        await respondWith(res, json(enabled ? listChildFolders(rootId, url.searchParams.get('path') ?? '') : []))
        return
      }

      case path === '/api/roots':
        await respondWith(
          res,
          json({ roots: listRoots().filter((root) => root.enabled), stats: libraryStats() }),
        )
        return

      case path === '/api/collections':
        await respondWith(res, json(listCollections()))
        return

      case path === '/api/tags':
        await respondWith(res, json(listTags()))
        return

      case path === '/api/annotations':
        await respondWith(res, json(listAnnotations(idFrom(url.searchParams.get('id')) ?? 0)))
        return

      case path.startsWith('/thumb/'):
        await this.serveDerived(req, res, path.slice(7), thumbPathFor)
        return

      case path.startsWith('/sprite/'):
        await this.serveDerived(req, res, path.slice(8), spritePathFor)
        return

      case path.startsWith('/stream/'):
        await this.stream(req, res, path.slice(8))
        return

      default:
        await respondWith(res, json({ error: 'not-found' }, 404))
    }
  }

  // --- the join handshake ---------------------------------------------------

  private async knock(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req)
    if (!body || !tokensMatch(String(body['invite'] ?? ''), this.invite)) {
      await respondWith(res, json({ error: 'bad-invite' }, 403))
      return
    }

    const knock = this.room.knock(body['name'], addressOf(req))
    if (!knock) {
      await respondWith(res, json({ error: 'full' }, 429))
      return
    }

    // The fingerprint goes back so the guest can read it to the host. It is not
    // a secret — it is the thing being compared out loud.
    await respondWith(res, json({ id: knock.id, fingerprint: knock.fingerprint }))
  }

  /**
   * Polled by the join page while it waits. The cookie is minted here, at the
   * moment the host says yes, and never before.
   */
  private async knockStatus(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const id = String(url.searchParams.get('id') ?? '')
    const pending = this.room.snapshot().knocking.some((knock) => knock.id === id)
    if (pending) {
      await respondWith(res, json({ status: 'waiting' }))
      return
    }

    const cookie = this.pendingCookies.get(id)
    if (!cookie) {
      // Either denied, expired, or never existed. All three look the same, and
      // should: a rejected stranger learns nothing about which.
      await respondWith(res, json({ status: 'denied' }))
      return
    }

    this.pendingCookies.delete(id)
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''

    await respondWith(
      res,
      new Response(JSON.stringify({ status: 'approved' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          // HttpOnly: the page never needs to read this, and script that can
          // read it is script that can exfiltrate it.
          'Set-Cookie': `${COOKIE}=${cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE_S}${secure}`,
        },
      }),
    )
  }

  /** Called by the host side when it approves a knock. */
  offerCookie(knockId: string, cookie: string): void {
    this.pendingCookies.set(knockId, cookie)
  }

  // --- guest actions --------------------------------------------------------

  private async intent(guestId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req)
    const kind = String(body?.['kind'] ?? '')
    const positionMs = Number(body?.['positionMs'] ?? 0)
    let applied = false

    switch (kind) {
      case 'open': {
        const mediaId = idFrom(body?.['mediaId'])
        if (mediaId === null) break
        applied = this.room.apply(guestId, { kind: 'open', mediaId, autoplay: true })
        break
      }
      case 'play':
        applied = this.room.apply(guestId, { kind: 'play' })
        break
      case 'pause':
        applied = this.room.apply(guestId, { kind: 'pause', positionMs: safeMs(positionMs) })
        break
      case 'seek':
        applied = this.room.apply(guestId, { kind: 'seek', positionMs: safeMs(positionMs) })
        break
      case 'close':
        applied = this.room.apply(guestId, { kind: 'close' })
        break
      default:
        break
    }

    await respondWith(res, applied ? json({ ok: true }) : json({ error: 'not-in-control' }, 409))
  }

  /** Asking for control, withdrawing the ask, or answering one while in control. */
  private async control(guestId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req)

    switch (body?.['action']) {
      case 'request':
        this.room.requestControl(guestId)
        break
      case 'cancel':
        this.room.cancelControlRequest(guestId)
        break
      case 'answer':
        this.room.answerControl(guestId, String(body['peer'] ?? ''), body['allow'] === true)
        break
      default:
        break
    }

    await respondWith(res, json({ ok: true }))
  }

  private async ready(guestId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req)
    const mediaId = idFrom(body?.['mediaId'])
    if (mediaId !== null) this.room.ready(guestId, mediaId, body?.['ready'] === true)

    const latency = Number(body?.['latencyMs'])
    if (Number.isFinite(latency)) this.room.setLatency(guestId, latency)

    await respondWith(res, json({ ok: true }))
  }

  private async act(
    req: IncomingMessage,
    res: ServerResponse,
    apply: (body: Record<string, unknown>) => void,
  ): Promise<void> {
    const body = await readJson(req)
    if (body) apply(body)
    await respondWith(res, json({ ok: true }))
  }

  /**
   * Materialises a playable rendition before the guest asks for the bytes.
   *
   * Same two-step the host's own player uses: prepare, then point at the
   * stream. Doing it inside the video request instead would leave a browser
   * waiting on a first byte that is minutes of transcoding away.
   */
  private async prepare(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req)
    const mediaId = idFrom(body?.['mediaId'])
    if (mediaId === null) {
      await respondWith(res, json({ error: 'bad-id' }, 400))
      return
    }

    try {
      const prepared = await preparer.prepare(mediaId)
      await respondWith(res, json({ ok: true, tier: prepared.tier, reason: prepared.reason }))
    } catch (err) {
      await respondWith(res, json({ error: (err as Error).message }, 500))
    }
  }

  // --- bytes ----------------------------------------------------------------

  private async serveDerived(
    req: IncomingMessage,
    res: ServerResponse,
    raw: string,
    pathFor: (id: number) => string,
  ): Promise<void> {
    const id = idFrom(raw)
    if (id === null) {
      await respondWith(res, json({ error: 'bad-id' }, 400))
      return
    }

    await respondWith(res, await serveFile(pathFor(id), toRequest(req), 'image/webp', 'private, max-age=3600'))
  }

  private async stream(req: IncomingMessage, res: ServerResponse, raw: string): Promise<void> {
    const id = idFrom(raw)
    if (id === null) {
      await respondWith(res, json({ error: 'bad-id' }, 400))
      return
    }

    // Resolved from the row and confined to a registered root by the same code
    // media:// uses. A guest sends an id and never a path, and could not use one
    // if they sent it.
    const path = await playablePathFor(id)
    if (!path) {
      await respondWith(res, json({ error: 'not-prepared' }, 503))
      return
    }

    await respondWith(res, await serveFile(path, toRequest(req), contentTypeFor(path)))
  }

  // --- the event stream -----------------------------------------------------

  private subscribe(guestId: string, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      // `no-transform` is the part that matters: it tells intermediaries not to
      // compress the stream, and compressing it means buffering it.
      'Cache-Control': 'no-cache, no-store, no-transform',
      // Says explicitly that this body is not encoded, for proxies that would
      // otherwise decide to encode it themselves.
      'Content-Encoding': 'identity',
      // nginx-specific, ignored elsewhere, free to send.
      'X-Accel-Buffering': 'no',
    })

    // Cloudflare holds a small first chunk rather than passing it on, so the
    // opening event never arrives and the guest sits there having learned
    // nothing. Two kilobytes of comment is below any sane buffer threshold and
    // is discarded by every SSE parser, being a comment.
    res.write(':' + ' '.repeat(2048) + '\n\n')

    const subscriber: Subscriber = { guestId, res }
    this.subscribers.add(subscriber)
    this.room.setConnected(guestId, true)

    const drop = (): void => {
      this.subscribers.delete(subscriber)
      // Only mark them gone if this was their last stream; a reconnect races
      // the old socket's close and would otherwise flap them offline.
      const stillHere = [...this.subscribers].some((s) => s.guestId === guestId)
      if (!stillHere) this.room.setConnected(guestId, false)
    }

    res.on('close', drop)
    res.on('error', drop)

    this.write(subscriber, 'state', this.stateFor(guestId))
  }

  private dropSubscribers(guestId: string): void {
    for (const subscriber of [...this.subscribers]) {
      if (subscriber.guestId !== guestId) continue
      this.write(subscriber, 'evicted', null)
      subscriber.res.end()
      this.subscribers.delete(subscriber)
    }
  }

  private broadcastState(): void {
    for (const subscriber of this.subscribers) {
      this.write(subscriber, 'state', this.stateFor(subscriber.guestId))
    }
  }

  /** A bare SSE comment, which keeps an idle proxy from closing the stream. */
  private ping(): void {
    for (const subscriber of this.subscribers) subscriber.res.write(': ping\n\n')
  }

  private write(subscriber: Subscriber, event: string, data: unknown): void {
    try {
      subscriber.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    } catch {
      this.subscribers.delete(subscriber)
    }
  }

  private stateFor(viewer: string): { room: GuestView; now: number } {
    const now = Date.now()
    return { room: guestView(this.room.snapshot(now, viewer), this.toyOffer), now }
  }

  /** Changes what guests are offered of the toy, telling them only if it moved. */
  setToyOffer(offer: ToyOffer | null): void {
    const same =
      offer === this.toyOffer ||
      (offer !== null &&
        this.toyOffer !== null &&
        offer.maxIntensity === this.toyOffer.maxIntensity &&
        offer.maxSeconds === this.toyOffer.maxSeconds &&
        JSON.stringify(offer.patterns) === JSON.stringify(this.toyOffer.patterns))
    if (same) return
    this.toyOffer = offer
    this.broadcastState()
  }

  // --- rate limiting --------------------------------------------------------

  private allow(address: string): boolean {
    const now = Date.now()
    const record = this.hits.get(address)

    if (!record || now > record.resetAt) {
      this.hits.set(address, { count: 1, resetAt: now + 60_000 })
      return true
    }

    record.count += 1
    return record.count <= RATE_LIMIT
  }
}

function deniedPage(): string {
  return `<!doctype html><meta charset="utf-8"><title>Not in this session</title>
<style>body{background:#0b0b0f;color:#e7e7ee;font:15px/1.6 system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;text-align:center}</style>
<div><h1>You're not in this session</h1><p>Ask for a fresh invite link.</p></div>`
}
