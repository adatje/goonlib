/**
 * Player tracing.
 *
 * The player narrates itself - mount, stall, suspend, the end arriving without
 * an event - which is how every awkward file has been diagnosed, and which the
 * built app has no reason to be doing on every video. The main process has had
 * a switch for this all along (GOONLIB_TRACE_MEDIA); this is the same idea on
 * this side, on in development and turned on in a shipped build by running
 * `localStorage.goonlib_trace = 'on'` and reloading.
 */

function asked(): boolean {
  try {
    return localStorage.getItem('goonlib_trace') === 'on'
  } catch {
    // Storage can be unavailable; tracing is never worth an error.
    return false
  }
}

export const TRACING: boolean = import.meta.env.DEV || asked()

export function trace(...parts: unknown[]): void {
  if (TRACING) console.log(...parts)
}
