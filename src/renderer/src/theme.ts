/**
 * Keeps the window in the colours of the active theme.
 *
 * The main process owns the themes and pushes every change; this works out
 * which one is showing — the mode's, or the system's when following it — and
 * writes its colours onto :root. The Appearance page can lay a preview over
 * that, which lasts until it is saved or dropped.
 */

import { useSyncExternalStore } from 'react'
import type { ThemeState } from '@shared/types'
import { activeTheme, CSS_VARS, resolveTheme, type Theme } from '@shared/theme'

let state: ThemeState = window.goonlib.theme.initial
let preview: Theme | null = null
const listeners = new Set<() => void>()

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

/** The theme on screen right now, preview included. */
export function shownTheme(): Theme {
  return preview ?? activeTheme(state.config, darkQuery.matches)
}

function apply(): void {
  const resolved = resolveTheme(shownTheme())
  const root = document.documentElement.style
  for (const name of Object.values(CSS_VARS)) root.setProperty(name, resolved.vars[name] ?? null)
  root.setProperty('color-scheme', resolved.type)
}

function changed(): void {
  apply()
  for (const listener of listeners) listener()
}

/** Shows a theme without keeping it. Null goes back to the active one. */
export function setPreview(theme: Theme | null): void {
  preview = theme
  changed()
}

/** Takes a state the main process just returned, without waiting for its push. */
export function acceptThemeState(next: ThemeState): void {
  state = next
  changed()
}

export function useThemeState(): ThemeState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}

apply()
window.goonlib.theme.onUpdate(acceptThemeState)
// Following the system: flips with it, even while the app is open.
darkQuery.addEventListener('change', changed)
