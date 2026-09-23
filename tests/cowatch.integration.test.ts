/**
 * The whole guest path, for real: knock, wait, get approved, then browse and
 * stream over HTTP the way a browser actually would.
 *
 * Electron is stubbed rather than booted — the session server only needs it for
 * two path lookups and the keychain — so this exercises the genuine routing,
 * cookie handling and range streaming without an app window.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const workspace = await mkdtemp(join(tmpdir(), 'goonlib-cowatch-e2e-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => workspace,
    getVersion: () => '0.6.0',
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}))

const { initDb, closeDb } = await import('../src/main/db')
const { addRoot } = await import('../src/main/db/queries')
const { upsertMediaBatch } = await import('../src/main/db/media')
const { Room } = await import('../src/main/cowatch/room')
const { SessionServer } = await import('../src/main/cowatch/server')

/** 4096 predictable bytes standing in for a video file. */
const CLIP = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256))

let origin: string
let server: InstanceType<typeof SessionServer>
let room: InstanceType<typeof Room>
let mediaId: number

const INVITE = 'ABCDEFGHJKMNPQRS'

beforeAll(async () => {
  const library = join(workspace, 'library')
  await writeFile(join(workspace, 'placeholder'), '')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(library, { recursive: true })
  await writeFile(join(library, 'clip.mp4'), CLIP)

  initDb(join(workspace, 'test.db'))
  const root = addRoot(library)

  upsertMediaBatch(
    root.id,
    [
      {
        relPath: 'clip.mp4',
        name: 'clip.mp4',
        ext: '.mp4',
        kind: 'video',
        size: CLIP.length,
        mtime: 1,
      },
    ],
    Date.now(),
  )

  const { getDb } = await import('../src/main/db')
  // Native tier so the server streams the original rather than reaching for
  // ffmpeg, which is not what this test is about.
  getDb().prepare("UPDATE media SET playback_tier = 'native', probe_state = 'done'").run()
  mediaId = (getDb().prepare('SELECT id FROM media').get() as { id: number }).id

  room = new Room()
  server = new SessionServer(room, INVITE)
  const address = await server.listen()
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await server.close()
  room.close()
  closeDb()
  await rm(workspace, { recursive: true, force: true })
})

/** Completes the handshake and returns the cookie a guest would then hold. */
async function joinAsGuest(name: string): Promise<string> {
  const knocked = await fetch(`${origin}/api/knock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite: INVITE, name }),
  })
  const { id } = (await knocked.json()) as { id: string }

  const admitted = room.approve(id)
  server.offerCookie(id, admitted!.cookie)

  const collected = await fetch(`${origin}/api/knock?id=${id}`)
  const setCookie = collected.headers.get('set-cookie') ?? ''
  return setCookie.split(';')[0] ?? ''
}

describe('before the host says yes', () => {
  it('turns away a knock carrying the wrong invite', async () => {
    const res = await fetch(`${origin}/api/knock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invite: 'WRONGWRONGWRONGW', name: 'Nobody' }),
    })

    expect(res.status).toBe(403)
  })

  it('serves no library and no bytes to an unapproved visitor', async () => {
    for (const path of ['/', '/api/library', `/stream/${mediaId}`, `/thumb/${mediaId}`]) {
      const res = await fetch(origin + path)
      expect(res.status).toBe(403)
    }
  })

  it('serves nothing to a made-up cookie', async () => {
    const res = await fetch(`${origin}/api/library`, {
      headers: { Cookie: 'goonlib_cowatch=not-a-real-credential' },
    })

    expect(res.status).toBe(403)
  })

  it('hands out the join page without a credential, and nothing else', async () => {
    const res = await fetch(`${origin}/j/${INVITE}`)

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Join the session')
  })
})

describe('once the host says yes', () => {
  let cookie: string

  beforeAll(async () => {
    cookie = await joinAsGuest('Sam')
  })

  it('mints a credential that actually opens the library', async () => {
    const res = await fetch(`${origin}/api/library?limit=10`, { headers: { Cookie: cookie } })

    expect(res.status).toBe(200)
    const page = (await res.json()) as { items: Array<{ name: string }>; total: number }
    expect(page.total).toBe(1)
    expect(page.items[0]?.name).toBe('clip.mp4')
  })

  it('marks the cookie HttpOnly, so page script can never read it', async () => {
    const knocked = await fetch(`${origin}/api/knock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invite: INVITE, name: 'Ada' }),
    })
    const { id } = (await knocked.json()) as { id: string }
    const admitted = room.approve(id)
    server.offerCookie(id, admitted!.cookie)

    const collected = await fetch(`${origin}/api/knock?id=${id}`)
    const header = collected.headers.get('set-cookie') ?? ''

    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
  })

  it('streams the file with range support, so the guest can seek', async () => {
    const res = await fetch(`${origin}/stream/${mediaId}`, {
      headers: { Cookie: cookie, Range: 'bytes=1000-1099' },
    })

    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 1000-1099/${CLIP.length}`)
    expect(Buffer.from(await res.arrayBuffer()).equals(CLIP.subarray(1000, 1100))).toBe(true)
  })

  it('refuses an id that is not a real row rather than guessing', async () => {
    const res = await fetch(`${origin}/stream/999999`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(503)
  })

  it('will not take a path in place of an id', async () => {
    // A guest only ever names a row. Even if they send a path, there is no
    // route that would resolve one.
    const res = await fetch(`${origin}/stream/..%2F..%2Fetc%2Fpasswd`, {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(400)
  })

  it('sends a returning guest straight back in, rather than knocking again', async () => {
    const res = await fetch(`${origin}/j/${INVITE}`, { headers: { Cookie: cookie }, redirect: 'manual' })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/')
  })

  it('looks up an item the guest has not browsed to', async () => {
    const res = await fetch(`${origin}/api/item?id=${mediaId}`, { headers: { Cookie: cookie } })

    expect(res.status).toBe(200)
    expect(((await res.json()) as { kind: string }).kind).toBe('video')
  })

  it('refuses a guest\'s intent until control is handed to them', async () => {
    const refused = await fetch(`${origin}/api/intent`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'open', mediaId }),
    })
    expect(refused.status).toBe(409)
    expect(room.snapshot().playback.mediaId).toBeNull()

    await fetch(`${origin}/api/control`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request' }),
    })
    const [request] = room.snapshot().control.requests
    expect(request?.name).toBe('Sam')
    room.answerControl('host', request!.id, true)
  })

  it('lets the guest in control drive playback and talk', async () => {
    await fetch(`${origin}/api/intent`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'open', mediaId }),
    })
    await fetch(`${origin}/api/say`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'start here' }),
    })

    const snapshot = room.snapshot()
    expect(snapshot.playback.mediaId).toBe(mediaId)
    expect(snapshot.playback.actor).toBe('Sam')
    expect(snapshot.chat.at(-1)).toMatchObject({ from: 'Sam', text: 'start here' })
  })

  it('never exposes a way to change the host library', async () => {
    // The session is read-only against the library by construction: these are
    // the destructive IPC verbs, and none of them has a route.
    for (const path of ['/api/trash', '/api/move', '/api/tags/assign', '/api/roots/remove']) {
      const res = await fetch(origin + path, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: '{}',
      })
      expect(res.status).toBe(404)
    }
  })
})

describe('being removed', () => {
  it('kills the credential the moment the host kicks them', async () => {
    const cookie = await joinAsGuest('Temporary')
    expect((await fetch(`${origin}/api/library`, { headers: { Cookie: cookie } })).status).toBe(200)

    const guest = room.snapshot().guests.find((g) => g.name === 'Temporary')
    room.kick(guest!.id)

    expect((await fetch(`${origin}/api/library`, { headers: { Cookie: cookie } })).status).toBe(403)
    expect((await fetch(`${origin}/stream/${mediaId}`, { headers: { Cookie: cookie } })).status).toBe(403)
  })
})

describe("buzzing the host's toy", () => {
  const post = (cookie: string, body: unknown): Promise<Response> =>
    fetch(`${origin}/api/buzz`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('is refused outright without a credential', async () => {
    const res = await fetch(`${origin}/api/buzz`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(403)
  })

  it('is answered "off", and not offered, until the host wires a toy up', async () => {
    const cookie = await joinAsGuest('Early')
    const state = (await (await fetch(`${origin}/api/state`, { headers: { Cookie: cookie } })).json()) as {
      room: { toy: unknown }
    }
    expect(state.room.toy).toBeNull()
    expect(await (await post(cookie, { pattern: 'pulse', intensity: 1, seconds: 2 })).json()).toEqual({
      outcome: 'off',
    })
  })

  it("carries the guest's own id and body to the host, and the answer back", async () => {
    const cookie = await joinAsGuest('Buzzer')
    const guestId = room.snapshot().guests.find((g) => g.name === 'Buzzer')!.id
    const seen: Array<{ guestId: string; body: unknown }> = []

    server.onBuzz = (from, body) => {
      seen.push({ guestId: from, body })
      return 'cooling'
    }
    const patterns = [{ id: 'pulse', label: 'Pulse' }]
    server.setToyOffer({ maxIntensity: 0.5, maxSeconds: 8, patterns })

    const state = (await (await fetch(`${origin}/api/state`, { headers: { Cookie: cookie } })).json()) as {
      room: { toy: unknown }
    }
    expect(state.room.toy).toEqual({ maxIntensity: 0.5, maxSeconds: 8, patterns })

    const res = await post(cookie, { pattern: 'wave', intensity: 0.4, seconds: 3 })
    expect(await res.json()).toEqual({ outcome: 'cooling' })
    // The id comes from the credential, never from anything the guest wrote.
    expect(seen).toEqual([{ guestId, body: { pattern: 'wave', intensity: 0.4, seconds: 3 } }])

    server.onBuzz = null
    server.setToyOffer(null)
  })
})
