/**
 * The shape of the toy preferences, and how a stored copy is made safe.
 *
 * Kept free of Electron and the database so the clamping — which is what
 * stands between a hand-edited settings row and a toy stuck at full power —
 * can be tested on its own.
 */

import type { ToyPrefs } from '@shared/types'

export const TOY_DEFAULTS: ToyPrefs = {
  maxIntensity: 1,
  // Lovense toys over Bluetooth land roughly a tenth of a second behind the
  // command, which is enough to feel a beat late.
  leadMs: 100,
  vibrateFrom: 'speed',
  followVideo: true,
  audio: true,
  guests: false,
  guestMaxIntensity: 0.7,
  guestMaxSeconds: 10,
  lovenseConnect: false,
  autoConnect: false,
}

export const LEAD_RANGE = { min: -500, max: 1000 } as const
export const GUEST_SECONDS_RANGE = { min: 1, max: 30 } as const

export function normaliseToyPrefs(input: Partial<ToyPrefs>): ToyPrefs {
  const maxIntensity = number(input.maxIntensity, 0.05, 1, TOY_DEFAULTS.maxIntensity)
  return {
    maxIntensity,
    leadMs: Math.round(number(input.leadMs, LEAD_RANGE.min, LEAD_RANGE.max, TOY_DEFAULTS.leadMs)),
    vibrateFrom: input.vibrateFrom === 'position' ? 'position' : 'speed',
    followVideo: bool(input.followVideo, TOY_DEFAULTS.followVideo),
    audio: bool(input.audio, TOY_DEFAULTS.audio),
    guests: bool(input.guests, TOY_DEFAULTS.guests),
    // Guests never get more than the host allows the toy at all.
    guestMaxIntensity: Math.min(
      maxIntensity,
      number(input.guestMaxIntensity, 0.05, 1, TOY_DEFAULTS.guestMaxIntensity),
    ),
    guestMaxSeconds: Math.round(
      number(
        input.guestMaxSeconds,
        GUEST_SECONDS_RANGE.min,
        GUEST_SECONDS_RANGE.max,
        TOY_DEFAULTS.guestMaxSeconds,
      ),
    ),
    lovenseConnect: bool(input.lovenseConnect, TOY_DEFAULTS.lovenseConnect),
    autoConnect: bool(input.autoConnect, TOY_DEFAULTS.autoConnect),
  }
}

/** Out of range is clamped; not a number at all falls back to the default. */
function number(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
