import { describe, expect, it } from 'vitest'
import { cleanName, cleanText, HOST, MAX_GUESTS, PRESENCE_MS, Room } from '../src/main/cowatch/room'

const T0 = 1_000_000

/** An escape sequence of the kind a hostile display name would try to smuggle in. */
const ESCAPE = String.fromCharCode(27) + '[31m'
const NUL = String.fromCharCode(0)

/** Approves a knock and hands back the pieces a test needs to act as that guest. */
function admit(room: Room, name: string, now = T0): { id: string; cookie: string } {
  const knock = room.knock(name, '10.0.0.2', now)
  if (!knock) throw new Error('room refused the knock')
  const approved = room.approve(knock.id, now)
  if (!approved) throw new Error('room refused the approval')
  return { id: approved.guest.id, cookie: approved.cookie }
}

describe('getting in', () => {
  it('serves nothing to a knock until the host approves it', () => {
    const room = new Room(T0)
    const knock = room.knock('Sam', '10.0.0.2', T0)

    expect(knock).not.toBeNull()
    expect(room.snapshot(T0).knocking).toHaveLength(1)
    // The decisive part: no guest exists, so no cookie exists to authorise anything.
    expect(room.snapshot(T0).guests).toHaveLength(0)
  })

  it('turns a knock into a guest with a working credential on approval', () => {
    const room = new Room(T0)
    const { id, cookie } = admit(room, 'Sam')

    expect(room.guestFor(cookie)).toBe(id)
    expect(room.snapshot(T0).knocking).toHaveLength(0)
    expect(room.snapshot(T0).guests[0]?.name).toBe('Sam')
  })

  it('shows the same fingerprint the host approved, so it can be read aloud', () => {
    const room = new Room(T0)
    const knock = room.knock('Sam', '10.0.0.2', T0)

    expect(knock?.fingerprint).toMatch(/^[a-z]+ [a-z]+$/)
    // The guest keeps the knock's identity, so the words the host confirmed
    // belong to the person who actually got in.
    expect(room.approve(knock!.id, T0)?.guest.id).toBe(knock!.id)
  })

  it('a denied knock can never be approved afterwards', () => {
    const room = new Room(T0)
    const knock = room.knock('Sam', '10.0.0.2', T0)!

    room.deny(knock.id)

    expect(room.approve(knock.id, T0)).toBeNull()
    expect(room.snapshot(T0).guests).toHaveLength(0)
  })

  it('forgets a knock nobody answered', () => {
    const room = new Room(T0)
    const knock = room.knock('Sam', '10.0.0.2', T0)!

    room.tick(T0 + 10 * 60_000)

    expect(room.snapshot(T0).knocking).toHaveLength(0)
    expect(room.approve(knock.id, T0)).toBeNull()
  })

  it('stops admitting once the room is full', () => {
    const room = new Room(T0)
    for (let i = 0; i < MAX_GUESTS; i += 1) admit(room, `Guest ${i}`)

    expect(room.knock('One too many', '10.0.0.9', T0)).toBeNull()
  })
})

describe('being thrown out', () => {
  it('kicking revokes the credential immediately', () => {
    const room = new Room(T0)
    const sam = admit(room, 'Sam')
    const ada = admit(room, 'Ada')

    room.kick(sam.id, T0)

    expect(room.guestFor(sam.cookie)).toBeNull()
    // And leaves everyone else's alone.
    expect(room.guestFor(ada.cookie)).toBe(ada.id)
  })

  it('ending the session invalidates every credential at once', () => {
    const room = new Room(T0)
    const { cookie } = admit(room, 'Sam')

    room.close()

    expect(room.guestFor(cookie)).toBeNull()
  })
})

/** Hands control from the host to a guest the only way there is: asked, then granted. */
function handTo(room: Room, id: string): void {
  room.requestControl(id, T0)
  room.answerControl(HOST, id, true)
}

describe('one person in control', () => {
  it('starts with the host, and refuses anyone else\'s intents', () => {
    const room = new Room(T0)
    const { id } = admit(room, 'Sam')

    expect(room.apply(id, { kind: 'open', mediaId: 7, autoplay: true }, T0)).toBe(false)
    expect(room.snapshot(T0).playback.mediaId).toBeNull()
    expect(room.snapshot(T0).control).toMatchObject({ controller: 'You', inControl: true })
    expect(room.snapshot(T0, id).control).toMatchObject({ controller: 'host', inControl: false })
  })

  it('shows a request only to the controller, and hands over when they agree', () => {
    const room = new Room(T0)
    const { id } = admit(room, 'Sam')

    room.requestControl(id, T0)
    expect(room.snapshot(T0).control.requests).toEqual([{ id, name: 'Sam', at: T0 }])
    expect(room.snapshot(T0, id).control).toMatchObject({ requested: true, requests: [] })

    room.answerControl(HOST, id, true)

    expect(room.controllerId).toBe(id)
    expect(room.apply(HOST, { kind: 'open', mediaId: 7, autoplay: true }, T0)).toBe(false)
    expect(room.apply(id, { kind: 'open', mediaId: 7, autoplay: true }, T0)).toBe(true)
  })

  it('keeps control where it is when the controller says no', () => {
    const room = new Room(T0)
    const { id } = admit(room, 'Sam')

    room.requestControl(id, T0)
    room.answerControl(HOST, id, false)

    expect(room.controllerId).toBe(HOST)
    expect(room.snapshot(T0, id).control.requested).toBe(false)
  })

  it('makes the host ask too, once control has moved', () => {
    const room = new Room(T0)
    const { id } = admit(room, 'Sam')
    handTo(room, id)

    // Asking is all the host can do; there is no override.
    room.requestControl(HOST, T0)
    expect(room.controllerId).toBe(id)
    expect(room.snapshot(T0, id).control.requests.map((r) => r.name)).toEqual(['host'])

    room.answerControl(id, HOST, true)
    expect(room.controllerId).toBe(HOST)
  })

  it('lets nobody but the controller answer, so nobody can grant themselves control', () => {
    const room = new Room(T0)
    const sam = admit(room, 'Sam')
    const ada = admit(room, 'Ada')

    room.requestControl(sam.id, T0)

    expect(room.answerControl(sam.id, sam.id, true)).toBe(false)
    expect(room.answerControl(ada.id, sam.id, true)).toBe(false)
    expect(room.controllerId).toBe(HOST)
  })

  it('gives control back to the host when the controller is kicked', () => {
    const room = new Room(T0)
    const { id } = admit(room, 'Sam')
    handTo(room, id)

    room.kick(id, T0)

    expect(room.controllerId).toBe(HOST)
  })

  it('lets the controller drive, and attributes what they did', () => {
    const room = new Room(T0)
    const { id } = admit(room, 'Sam')
    handTo(room, id)

    room.apply(id, { kind: 'open', mediaId: 7, autoplay: true }, T0)
    room.ready(id, 7, true, T0)
    room.ready(HOST, 7, true, T0)
    room.apply(id, { kind: 'pause', positionMs: 12_000 }, T0 + 1_000)

    const snapshot = room.snapshot(T0 + 5_000)
    expect(snapshot.playback.paused).toBe(true)
    expect(snapshot.playback.positionMs).toBe(12_000)
    // Attributed, so the interface can say who did it rather than the video
    // appearing to stop by itself.
    expect(snapshot.playback.actor).toBe('Sam')
  })

  it('waits for a guest who cannot play yet, and names them', () => {
    const room = new Room(T0)
    const { id } = admit(room, 'Sam')

    room.apply(HOST, { kind: 'open', mediaId: 7, autoplay: true }, T0)
    room.ready(HOST, 7, true, T0)

    const waiting = room.snapshot(T0 + 3_000)
    expect(waiting.playback.waiting).toBe(true)
    expect(waiting.playback.waitingFor).toEqual(['Sam'])
    expect(waiting.playback.positionMs).toBe(0)

    room.ready(id, 7, true, T0 + 4_000)

    const running = room.snapshot(T0 + 9_000)
    expect(running.playback.waiting).toBe(false)
    expect(running.playback.positionMs).toBe(5_000)
  })
})

describe('coming and going', () => {
  it('stops holding the room for a guest who has gone quiet', () => {
    const room = new Room(T0)
    admit(room, 'Sam')

    room.apply(HOST, { kind: 'open', mediaId: 7, autoplay: true }, T0)
    room.ready(HOST, 7, true, T0)
    expect(room.snapshot(T0).playback.waitingFor).toEqual(['Sam'])

    // Their tab closed: no requests, no stream.
    room.tick(T0 + PRESENCE_MS + 1)

    const snapshot = room.snapshot(T0 + PRESENCE_MS + 1)
    expect(snapshot.playback.waiting).toBe(false)
    expect(snapshot.guests[0]?.connected).toBe(false)
  })

  it('does not wait on a guest who left before the next thing was opened', () => {
    const room = new Room(T0)
    admit(room, 'Sam')
    room.tick(T0 + PRESENCE_MS + 1)

    room.apply(HOST, { kind: 'open', mediaId: 7, autoplay: true }, T0 + PRESENCE_MS + 2)

    expect(room.snapshot(T0 + PRESENCE_MS + 2).playback.waitingFor).toEqual(['You'])
  })

  it('counts a returning guest again, with the same credential', () => {
    const room = new Room(T0)
    const { id, cookie } = admit(room, 'Sam')
    room.tick(T0 + PRESENCE_MS + 1)

    expect(room.guestFor(cookie)).toBe(id)
    room.touch(id, T0 + PRESENCE_MS + 5)

    expect(room.snapshot(T0 + PRESENCE_MS + 5).guests[0]?.connected).toBe(true)
  })

  it('keeps a guest with an open event stream present however long they are quiet', () => {
    const room = new Room(T0)
    const { id } = admit(room, 'Sam')
    room.setConnected(id, true, T0)

    room.tick(T0 + 10 * PRESENCE_MS)

    expect(room.snapshot(T0 + 10 * PRESENCE_MS).guests[0]?.connected).toBe(true)
  })

  it('hands control back to the host when the controller goes quiet', () => {
    const room = new Room(T0)
    const { id } = admit(room, 'Sam')
    handTo(room, id)

    room.tick(T0 + PRESENCE_MS + 1)

    expect(room.controllerId).toBe(HOST)
  })
})

describe('what a guest is allowed to send', () => {
  it('keeps chat in memory and attributes it to the sender', () => {
    const room = new Room(T0)
    const { id } = admit(room, 'Sam')

    room.say(id, 'this bit is great', T0)

    expect(room.snapshot(T0).chat[0]).toMatchObject({ from: 'Sam', text: 'this bit is great' })
  })

  it('refuses a reaction that is not one of the known ones', () => {
    const room = new Room(T0)
    const { id } = admit(room, 'Sam')

    // An arbitrary string here would be rendered into every participant's DOM.
    expect(room.react(id, '<img src=x onerror=alert(1)>', T0)).toBeNull()
    expect(room.react(id, 'fire', T0)).not.toBeNull()
  })

  it('keeps a reaction in the snapshot only briefly', () => {
    const room = new Room(T0)
    const { id } = admit(room, 'Sam')
    room.react(id, 'fire', T0)

    // It rides along for a few seconds so a client whose event stream is being
    // buffered still sees it -- Cloudflare's quick tunnels do exactly that.
    expect(room.snapshot(T0).reactions.map((r) => r.emoji)).toEqual(['fire'])

    // And is gone well before anyone joining later could be shown it.
    expect(room.snapshot(T0 + 30_000).reactions).toEqual([])
  })

  it('drops junk out of a queue rather than trusting the sender', () => {
    const room = new Room(T0)

    room.setQueue([4, -1, 0, 1.5, Number.NaN, '9', 12])
    expect(room.snapshot(T0).queue).toEqual([4, 12])

    room.setQueue('not an array')
    expect(room.snapshot(T0).queue).toEqual([])
  })
})

describe('who everyone is called', () => {
  it('calls you "You" and the other person by name', () => {
    const room = new Room(T0)
    const { id } = admit(room, 'Sam')

    room.say(id, 'hello', T0)

    // The host reading it sees Sam. Sam reading the same message sees himself.
    expect(room.snapshot(T0).chat[0]?.from).toBe('Sam')
    expect(room.snapshot(T0, id).chat[0]?.from).toBe('You')
  })

  it('never tells a guest the room is holding for "You"', () => {
    const room = new Room(T0)
    const { id } = admit(room, 'Sam')

    room.apply(HOST, { kind: 'open', mediaId: 7, autoplay: true }, T0)
    room.ready(id, 7, true, T0)

    // The room is waiting on the host's machine. From the host's own screen
    // that is "You"; from Sam's it has to be somebody else.
    expect(room.snapshot(T0).playback.waitingFor).toEqual(['You'])
    expect(room.snapshot(T0, id).playback.waitingFor).toEqual(['host'])
  })

  it('attributes an action to the right side of the conversation', () => {
    const room = new Room(T0)
    const { id } = admit(room, 'Sam')
    handTo(room, id)

    room.apply(id, { kind: 'open', mediaId: 7, autoplay: true }, T0)

    expect(room.snapshot(T0).playback.actor).toBe('Sam')
    expect(room.snapshot(T0, id).playback.actor).toBe('You')
  })

  it('puts the recipient\'s own name on a reaction they sent', () => {
    const room = new Room(T0)
    const { id } = admit(room, 'Sam')

    const raw = room.react(id, 'fire', T0)!

    expect(room.resolveReaction(raw).from).toBe('Sam')
    expect(room.resolveReaction(raw, id).from).toBe('You')
  })
})

describe('sanitising what strangers type', () => {
  it('strips control characters from a display name', () => {
    expect(cleanName(`Sam${ESCAPE}`)).toBe('Sam[31m')
    expect(cleanName(`Sam${NUL}my`)).toBe('Sammy')
  })

  it('falls back to a name rather than rendering an empty one', () => {
    expect(cleanName('   ')).toBe('Guest')
    expect(cleanName(undefined)).toBe('Guest')
    expect(cleanName(42)).toBe('Guest')
  })

  it('caps a name so it cannot overrun the host interface', () => {
    expect(cleanName('x'.repeat(200))).toHaveLength(24)
  })

  it('flattens a multi-line chat message onto one line', () => {
    expect(cleanText('one\ntwo\r\nthree')).toBe('one two three')
  })

  it('caps message length', () => {
    expect(cleanText('y'.repeat(9_999))).toHaveLength(500)
  })
})
