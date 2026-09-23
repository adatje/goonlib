import { useEffect, useState } from 'react'
import { actionFor, defaultBindings, mergeBindings } from '@shared/keys'
import type { KeyBindings, KeyContext } from '@shared/keys'

/**
 * The shortcuts, as the window sees them.
 *
 * Held outside React as well as in it: the handlers that answer keys are set
 * up once and read this when a key arrives, rather than being rebuilt every
 * time a binding changes.
 */
let bindings: KeyBindings = defaultBindings()
const listeners = new Set<() => void>()

void window.goonlib.keys
  .get()
  .then((stored) => accept(stored))
  .catch(() => undefined)

export function accept(next: KeyBindings): void {
  bindings = mergeBindings(next)
  for (const listener of listeners) listener()
}

/** What the current bindings say this event means here, or null. */
export function actionOf(context: KeyContext, event: KeyboardEvent): string | null {
  return actionFor(bindings, context, event)
}

/** The keys one action answers to, for showing on a button or in a tooltip. */
export function keysFor(actionId: string): string[] {
  return bindings[actionId] ?? []
}

/** The same, for anything that should redraw when they change. */
export function useBindings(): KeyBindings {
  const [current, setCurrent] = useState(bindings)
  useEffect(() => {
    const listener = (): void => setCurrent(bindings)
    listeners.add(listener)
    listener()
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return current
}
