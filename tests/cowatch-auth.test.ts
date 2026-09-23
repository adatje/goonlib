import { describe, expect, it } from 'vitest'
import {
  Credentials,
  fingerprint,
  newInvite,
  readCookie,
  tokensMatch,
} from '../src/main/cowatch/auth'

describe('invite tokens', () => {
  it('avoids characters that are misread when spoken or typed', () => {
    const alphabet = new Set('ABCDEFGHJKMNPQRSTUVWXYZ23456789')
    for (let i = 0; i < 200; i += 1) {
      for (const char of newInvite()) expect(alphabet.has(char)).toBe(true)
    }
  })

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 500 }, () => newInvite()))
    expect(seen.size).toBe(500)
  })

  it('compares without leaking the prefix through an early exit', () => {
    const token = newInvite()
    expect(tokensMatch(token, token)).toBe(true)
    expect(tokensMatch(token, token.slice(0, -1) + '?')).toBe(false)
    expect(tokensMatch(token, token.slice(0, -1))).toBe(false)
    expect(tokensMatch('', '')).toBe(true)
  })
})

describe('fingerprints', () => {
  it('is stable for a seed, so both screens show the same words', () => {
    expect(fingerprint('abc123')).toBe(fingerprint('abc123'))
  })

  it('is two readable words', () => {
    expect(fingerprint(newInvite())).toMatch(/^[a-z]+ [a-z]+$/)
  })

  it('spreads across the space rather than collapsing onto a few pairs', () => {
    const seen = new Set(Array.from({ length: 400 }, () => fingerprint(newInvite())))
    // 32x32 = 1024 possible pairs; 400 draws should land on plenty of them.
    expect(seen.size).toBeGreaterThan(200)
  })
})

describe('credentials', () => {
  it('hands back the guest a cookie was issued to', () => {
    const credentials = new Credentials()
    const cookie = credentials.issue('guest-1', 0)

    expect(credentials.guestFor(cookie)).toBe('guest-1')
  })

  it('refuses anything it did not issue', () => {
    const credentials = new Credentials()
    credentials.issue('guest-1', 0)

    expect(credentials.guestFor('made-up')).toBeNull()
    expect(credentials.guestFor(null)).toBeNull()
    expect(credentials.guestFor('')).toBeNull()
  })

  it('revoking one guest leaves the others alone', () => {
    const credentials = new Credentials()
    const first = credentials.issue('guest-1', 0)
    const second = credentials.issue('guest-2', 0)

    credentials.revoke('guest-1')

    expect(credentials.guestFor(first)).toBeNull()
    expect(credentials.guestFor(second)).toBe('guest-2')
  })

  it('revokes every cookie a reconnecting guest accumulated', () => {
    const credentials = new Credentials()
    const first = credentials.issue('guest-1', 0)
    const second = credentials.issue('guest-1', 1)

    credentials.revoke('guest-1')

    expect(credentials.guestFor(first)).toBeNull()
    expect(credentials.guestFor(second)).toBeNull()
  })

  it('ending the session invalidates everything at once', () => {
    const credentials = new Credentials()
    const cookie = credentials.issue('guest-1', 0)
    credentials.issue('guest-2', 0)

    credentials.clear()

    expect(credentials.guestFor(cookie)).toBeNull()
    expect(credentials.size).toBe(0)
  })
})

describe('cookie parsing', () => {
  it('finds the cookie among others', () => {
    expect(readCookie('theme=dark; goonlib_session=abc; other=1', 'goonlib_session')).toBe('abc')
  })

  it('will not answer for a name that merely starts the same', () => {
    // A decoy named with our cookie as its prefix must not be mistaken for it.
    expect(readCookie('goonlib_session_decoy=evil', 'goonlib_session')).toBeNull()
  })

  it('tolerates the header being absent or empty', () => {
    expect(readCookie(undefined, 'goonlib_session')).toBeNull()
    expect(readCookie('', 'goonlib_session')).toBeNull()
    expect(readCookie('nonsense', 'goonlib_session')).toBeNull()
  })
})
