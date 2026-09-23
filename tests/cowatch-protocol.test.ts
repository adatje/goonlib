import { describe, expect, it } from 'vitest'
import { Room } from '../src/main/cowatch/room'
import {
  guestView,
  idFrom,
  lanUrlsFor,
  MAX_PAGE,
  queryFrom,
  safeMs,
  toRequest,
} from '../src/main/cowatch/protocol'

function query(search: string): ReturnType<typeof queryFrom> {
  return queryFrom(new URL(`http://host/api/library${search}`))
}

describe('what a guest may ask the library for', () => {
  it('narrows to favorites only when asked in exactly the expected form', () => {
    expect(query('?favorite=1').favorite).toBe(true)
    expect(query('?favorite=true').favorite).toBe(false)
    expect(query('').favorite).toBe(false)
  })

  it('caps the page size however large a number is sent', () => {
    expect(query('?limit=100000').limit).toBe(MAX_PAGE)
    expect(query('?limit=1e9').limit).toBe(MAX_PAGE)
  })

  it('falls back to a sane page rather than trusting junk', () => {
    expect(query('?limit=abc').limit).toBe(60)
    expect(query('?limit=-5').limit).toBe(60)
    expect(query('?limit=0').limit).toBe(60)
    expect(query('').limit).toBe(60)
  })

  it('never produces a negative offset', () => {
    expect(query('?offset=-40').offset).toBe(0)
    expect(query('?offset=nonsense').offset).toBe(0)
    expect(query('?offset=120').offset).toBe(120)
  })

  it('only honours sorts the query layer actually understands', () => {
    expect(query('?sort=name').sort).toBe('name')
    // Anything else would reach the SQL builder as an unrecognised branch.
    expect(query('?sort=; DROP TABLE media').sort).toBe('added')
    expect(query('?sort=').sort).toBe('added')
  })

  it('only honours the two real kinds', () => {
    expect(query('?kind=video').kind).toBe('video')
    expect(query('?kind=image').kind).toBe('image')
    expect(query('?kind=everything').kind).toBe('all')
  })

  it('drops ids that are not ids', () => {
    expect(query('?rootId=0').rootId).toBeUndefined()
    expect(query('?rootId=-3').rootId).toBeUndefined()
    expect(query('?collectionId=1.5').collectionId).toBeUndefined()
    expect(query('?tagId=9').tagId).toBe(9)
  })
})

describe('media ids', () => {
  it('accepts only positive whole numbers', () => {
    expect(idFrom('12')).toBe(12)
    expect(idFrom(12)).toBe(12)
    expect(idFrom('0')).toBeNull()
    expect(idFrom('-1')).toBeNull()
    expect(idFrom('1.5')).toBeNull()
    expect(idFrom('../../etc/passwd')).toBeNull()
    expect(idFrom(null)).toBeNull()
    expect(idFrom({})).toBeNull()
    expect(idFrom(Number.MAX_VALUE)).toBeNull()
  })
})

describe('positions', () => {
  it('refuses to produce a negative or non-finite playhead', () => {
    expect(safeMs(1200)).toBe(1200)
    expect(safeMs('1200.7')).toBe(1200)
    expect(safeMs(-5)).toBe(0)
    expect(safeMs(Number.NaN)).toBe(0)
    expect(safeMs(Number.POSITIVE_INFINITY)).toBe(0)
    expect(safeMs('nope')).toBe(0)
  })
})

describe('what a guest is shown of the room', () => {
  it('strips the other guests addresses', () => {
    const room = new Room(0)
    const knock = room.knock('Sam', '203.0.113.9', 0)!
    room.approve(knock.id, 0)

    const view = guestView(room.snapshot(0))

    expect(view.guests.map((guest) => guest.name)).toContain('Sam')
    expect(JSON.stringify(view)).not.toContain('203.0.113.9')
  })

  it('includes the host, who is not in the room list but is in the room', () => {
    const room = new Room(0)
    const knock = room.knock('Sam', '203.0.113.9', 0)!
    const guestId = room.approve(knock.id, 0)!.guest.id

    room.apply('host', { kind: 'open', mediaId: 7, autoplay: true }, 0)
    room.ready(guestId, 7, true, 0)

    const view = guestView(room.snapshot(0, guestId))

    // The host is usually the person holding everyone up while something
    // transcodes, so a guest seeing an empty room would be actively misleading.
    const host = view.guests.find((guest) => guest.name === 'host')
    expect(host).toBeDefined()
    expect(host?.ready).toBe(false)
    expect(view.guests.find((guest) => guest.name === 'You')?.ready).toBe(true)
  })

  it('carries recent reactions, so a polling client still sees them', () => {
    const room = new Room(0)
    const knock = room.knock('Sam', '10.0.0.2', 0)!
    const guestId = room.approve(knock.id, 0)!.guest.id
    room.react(guestId, 'fire', 0)

    // Pushed reactions never reach a client whose event stream is being
    // buffered by something in the path; the snapshot is how they arrive.
    const view = guestView(room.snapshot(0, guestId))
    expect(view.reactions.map((r) => r.emoji)).toEqual(['fire'])
    expect(view.reactions[0]?.from).toBe('You')
  })

  it('drops reactions once they are no longer recent', () => {
    const room = new Room(0)
    const knock = room.knock('Sam', '10.0.0.2', 0)!
    const guestId = room.approve(knock.id, 0)!.guest.id
    room.react(guestId, 'fire', 0)

    // Short-lived on purpose: a snapshot must not replay somebody's reaction
    // at a guest who arrives a minute later.
    expect(guestView(room.snapshot(30_000, guestId)).reactions).toEqual([])
  })

  it('never shows who else is at the door', () => {
    const room = new Room(0)
    room.knock('Someone else', '198.51.100.4', 0)

    const view = guestView(room.snapshot(0)) as unknown as Record<string, unknown>

    expect(view['knocking']).toBeUndefined()
    expect(JSON.stringify(view)).not.toContain('198.51.100.4')
  })
})

describe('bridging node requests into the fetch shape', () => {
  it('carries the range header through, which is what makes seeking work', () => {
    const request = toRequest({
      method: 'GET',
      headers: { range: 'bytes=200-299' },
    } as never)

    expect(request.headers.get('range')).toBe('bytes=200-299')
  })

  it('preserves HEAD, so a probe does not pull the whole file', () => {
    expect(toRequest({ method: 'HEAD', headers: {} } as never).method).toBe('HEAD')
  })

  it('treats anything else as a GET', () => {
    expect(toRequest({ method: 'DELETE', headers: {} } as never).method).toBe('GET')
  })
})

describe('local addresses', () => {
  it('builds a joinable url per interface, and never a loopback one', () => {
    for (const url of lanUrlsFor(8787, 'ABCD')) {
      expect(url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:8787\/j\/ABCD$/)
      expect(url).not.toContain('127.0.0.1')
    }
  })
})
