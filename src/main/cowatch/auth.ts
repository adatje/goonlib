/**
 * Session credentials for co-watching.
 *
 * The threat this file exists for: an invite link grants a stranger a view of
 * the entire library, so possession of the link must never be enough on its
 * own. It buys you the right to knock. The host approving you is what actually
 * opens the door, and what you get for it is a cookie that dies with the
 * session — not a URL that keeps working after you have paste-forwarded it.
 *
 * No signing, no JWTs: credentials are server-side rows keyed by an
 * unguessable random string, so revoking one is a delete rather than a
 * question about expiry claims.
 */

import { randomBytes, randomInt } from 'node:crypto'

/** Bytes behind every session cookie. */
const COOKIE_BYTES = 32

/**
 * Length of the invite token in the URL. Sixteen characters of this alphabet is
 * ~74 bits — far past guessing, still short enough to read off a screen when
 * someone is joining over the local network.
 */
const INVITE_LENGTH = 16

/** No 0/O, no 1/I/L. These get read aloud and typed by hand. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function newInvite(): string {
  let out = ''
  for (let i = 0; i < INVITE_LENGTH; i += 1) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

export function newCookieValue(): string {
  return randomBytes(COOKIE_BYTES).toString('base64url')
}

export function newId(): string {
  return randomBytes(8).toString('hex')
}

/**
 * Two words derived from a seed, shown to the host on the approval prompt and
 * to the guest on their own screen.
 *
 * This is the part that makes approval mean something. "Someone from
 * 203.0.113.9 wants in" is unanswerable — you cannot tell your partner from an
 * attacker who found the link. "Do you see 'amber otter'?" is answerable over
 * any voice call in two seconds.
 */
export function fingerprint(seed: string): string {
  let a = 0
  let b = 0
  for (let i = 0; i < seed.length; i += 1) {
    // Two different rolling hashes, so the halves cannot collapse to one word.
    a = (a * 31 + seed.charCodeAt(i)) >>> 0
    b = (b * 131 + seed.charCodeAt(i) * (i + 1)) >>> 0
  }
  return `${ADJECTIVES[a % ADJECTIVES.length]} ${NOUNS[b % NOUNS.length]}`
}

const ADJECTIVES = [
  'amber', 'brisk', 'calm', 'dusty', 'eager', 'faint', 'glad', 'hazy',
  'ivory', 'jolly', 'keen', 'lucky', 'mellow', 'noble', 'olive', 'plush',
  'quiet', 'rapid', 'sunny', 'tidy', 'upbeat', 'vivid', 'warm', 'zesty',
  'bright', 'cosy', 'dapper', 'even', 'fresh', 'gentle', 'humble', 'idle',
]

const NOUNS = [
  'otter', 'falcon', 'maple', 'harbor', 'lantern', 'meadow', 'pebble', 'quill',
  'raven', 'summit', 'thicket', 'valley', 'willow', 'anchor', 'beacon', 'cedar',
  'dune', 'ember', 'fern', 'grove', 'hollow', 'inlet', 'juniper', 'kettle',
  'ledge', 'marsh', 'nectar', 'orchard', 'prairie', 'quarry', 'ridge', 'sable',
]

/** One approved guest's credential. */
interface Credential {
  guestId: string
  issuedAt: number
}

/**
 * The live credential table for one session. Emptied wholesale when the session
 * ends, which is what makes "stop sharing" an actual guarantee rather than a
 * request.
 */
export class Credentials {
  private readonly byCookie = new Map<string, Credential>()

  issue(guestId: string, now: number): string {
    const value = newCookieValue()
    this.byCookie.set(value, { guestId, issuedAt: now })
    return value
  }

  /** The guest this cookie belongs to, or null if it was never issued or has been revoked. */
  guestFor(cookie: string | null | undefined): string | null {
    if (!cookie) return null
    return this.byCookie.get(cookie)?.guestId ?? null
  }

  revoke(guestId: string): void {
    for (const [value, credential] of this.byCookie) {
      if (credential.guestId === guestId) this.byCookie.delete(value)
    }
  }

  clear(): void {
    this.byCookie.clear()
  }

  get size(): number {
    return this.byCookie.size
  }
}

/**
 * Reads one cookie out of a request header.
 *
 * Deliberately strict about the name: a prefix match would let a cookie called
 * `goonlib_session_decoy` answer for `goonlib_session`.
 */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null

  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

/**
 * Constant-time-ish comparison for the invite token.
 *
 * The token is compared on every join attempt, and an early-exit compare leaks
 * its prefix to anyone willing to time a few thousand requests.
 */
export function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
