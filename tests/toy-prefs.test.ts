/**
 * The toy's preferences, round-tripped through the database.
 *
 * The clamping is the point: a hand-edited row must never be able to leave a
 * toy with no ceiling, or guests switched on without the host choosing it.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = await mkdtemp(join(tmpdir(), 'goonlib-toyprefs-'))

vi.mock('electron', () => ({ app: { getPath: () => workspace } }))

const { initDb, closeDb, getDb } = await import('../src/main/db')
const { setSetting, setToyPrefs, toyPrefs, SETTING_TOY } = await import('../src/main/db/settings')
const { TOY_DEFAULTS } = await import('../src/main/toy/prefs')

beforeAll(() => {
  initDb(join(workspace, 'test.db'))
})

beforeEach(() => {
  getDb().prepare("DELETE FROM settings WHERE key LIKE 'toy%'").run()
})

afterAll(async () => {
  closeDb()
  await rm(workspace, { recursive: true, force: true })
})

describe('toy preferences', () => {
  it('start with guests off and nothing connecting by itself', () => {
    expect(toyPrefs()).toEqual(TOY_DEFAULTS)
    expect(toyPrefs().guests).toBe(false)
    expect(toyPrefs().autoConnect).toBe(false)
    expect(toyPrefs().lovenseConnect).toBe(false)
  })

  it('never lets guests have more than the toy is allowed at all', () => {
    setToyPrefs({ maxIntensity: 1, guestMaxIntensity: 0.7 })
    setToyPrefs({ maxIntensity: 0.4 })
    expect(toyPrefs().guestMaxIntensity).toBe(0.4)
    setToyPrefs({ guestMaxIntensity: 0.9 })
    expect(toyPrefs().guestMaxIntensity).toBe(0.4)
  })

  it('remember a change and keep the rest', () => {
    setToyPrefs({ maxIntensity: 0.8 })
    expect(toyPrefs()).toEqual({ ...TOY_DEFAULTS, maxIntensity: 0.8 })
  })

  it('clamp whatever is out of range', () => {
    const stored = setToyPrefs({ maxIntensity: 7, leadMs: -99_999, guestMaxSeconds: 3600 })
    expect(stored.maxIntensity).toBe(1)
    expect(stored.leadMs).toBe(-500)
    expect(stored.guestMaxSeconds).toBe(30)
  })

  it('fall back to the defaults when the stored row is nonsense', () => {
    setSetting(SETTING_TOY, '{"maxIntensity":"loud","guests":"yes please"')
    expect(toyPrefs()).toEqual(TOY_DEFAULTS)

    setSetting(SETTING_TOY, JSON.stringify({ maxIntensity: 'loud', guests: 'yes please' }))
    expect(toyPrefs().maxIntensity).toBe(TOY_DEFAULTS.maxIntensity)
    expect(toyPrefs().guests).toBe(false)
  })
})
