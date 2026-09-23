/**
 * Every keyboard shortcut, in one list.
 *
 * The keys used to be written into the handlers that answer them, which meant
 * nothing could show them and nothing could change them. Here each one is an
 * action with a default, the handlers ask this what an event means, and the
 * Shortcuts page both lists them and sets them.
 *
 * A binding is written the way it is read: "Space", "Shift+ArrowLeft",
 * "Mod+Z" — Mod being Cmd on a Mac and Ctrl everywhere else.
 */

/** Where a shortcut applies. A viewer one is dead while the viewer is closed. */
export type KeyContext = 'library' | 'viewer'

export interface KeyAction {
  id: string
  label: string
  context: KeyContext
  /** Bindings this action answers to unless it has been changed. */
  defaults: string[]
  /** Grouped under this heading on the Shortcuts page. */
  group: string
}

export const KEY_ACTIONS: KeyAction[] = [
  // --- the library
  { id: 'library.search', label: 'Search the library', context: 'library', defaults: ['Mod+F'], group: 'Library' },
  { id: 'library.filters', label: 'Open Filters', context: 'library', defaults: ['F'], group: 'Library' },
  { id: 'library.kindAll', label: 'Show everything', context: 'library', defaults: ['1'], group: 'Library' },
  { id: 'library.kindImages', label: 'Show images only', context: 'library', defaults: ['2'], group: 'Library' },
  { id: 'library.kindVideos', label: 'Show videos only', context: 'library', defaults: ['3'], group: 'Library' },
  { id: 'library.selectAll', label: 'Select everything', context: 'library', defaults: ['Mod+A'], group: 'Library' },
  { id: 'library.trash', label: 'Move selection to Trash', context: 'library', defaults: ['Backspace', 'Delete'], group: 'Library' },
  { id: 'library.undo', label: 'Undo a delete', context: 'library', defaults: ['Mod+Z'], group: 'Library' },
  { id: 'library.redo', label: 'Redo a delete', context: 'library', defaults: ['Mod+Shift+Z', 'Mod+Y'], group: 'Library' },

  // --- the viewer
  { id: 'viewer.close', label: 'Close the viewer', context: 'viewer', defaults: ['Escape'], group: 'Viewer' },
  { id: 'viewer.next', label: 'Next item', context: 'viewer', defaults: ['ArrowRight', ']'], group: 'Viewer' },
  { id: 'viewer.previous', label: 'Previous item', context: 'viewer', defaults: ['ArrowLeft', '['], group: 'Viewer' },
  { id: 'viewer.favorite', label: 'Favorite', context: 'viewer', defaults: ['H'], group: 'Viewer' },
  { id: 'viewer.trash', label: 'Move to Trash', context: 'viewer', defaults: ['Backspace', 'Delete'], group: 'Viewer' },
  { id: 'viewer.shuffle', label: 'Shuffle on or off', context: 'viewer', defaults: ['S'], group: 'Viewer' },
  { id: 'viewer.random', label: 'Open something at random', context: 'viewer', defaults: ['R'], group: 'Viewer' },
  { id: 'viewer.loop', label: 'Loop this item', context: 'viewer', defaults: ['O'], group: 'Viewer' },
  { id: 'viewer.details', label: 'Show or hide the details', context: 'viewer', defaults: ['I'], group: 'Viewer' },

  // --- playing
  { id: 'player.playPause', label: 'Play or pause', context: 'viewer', defaults: ['Space', 'K'], group: 'Playing' },
  { id: 'player.back', label: 'Back ten seconds', context: 'viewer', defaults: ['J'], group: 'Playing' },
  { id: 'player.forward', label: 'On ten seconds', context: 'viewer', defaults: ['L'], group: 'Playing' },
  { id: 'player.backShort', label: 'Back five seconds', context: 'viewer', defaults: ['Shift+ArrowLeft'], group: 'Playing' },
  { id: 'player.forwardShort', label: 'On five seconds', context: 'viewer', defaults: ['Shift+ArrowRight'], group: 'Playing' },
  { id: 'player.frameBack', label: 'A frame back', context: 'viewer', defaults: [','], group: 'Playing' },
  { id: 'player.frameForward', label: 'A frame on', context: 'viewer', defaults: ['.'], group: 'Playing' },
  { id: 'player.slower', label: 'Play slower', context: 'viewer', defaults: ['Shift+,'], group: 'Playing' },
  { id: 'player.faster', label: 'Play faster', context: 'viewer', defaults: ['Shift+.'], group: 'Playing' },
  { id: 'player.volumeUp', label: 'Louder', context: 'viewer', defaults: ['ArrowUp'], group: 'Playing' },
  { id: 'player.volumeDown', label: 'Quieter', context: 'viewer', defaults: ['ArrowDown'], group: 'Playing' },
  { id: 'player.mute', label: 'Mute', context: 'viewer', defaults: ['M'], group: 'Playing' },
  { id: 'player.fullscreen', label: 'Fullscreen', context: 'viewer', defaults: ['F'], group: 'Playing' },

  // --- the toy, wherever you are
  { id: 'toy.stop', label: 'Stop the toy', context: 'library', defaults: ['X'], group: 'Toy' },

  // --- this list
  { id: 'app.shortcuts', label: 'Show the shortcuts', context: 'library', defaults: ['?'], group: 'Help' },
]

export type KeyBindings = Record<string, string[]>

/** The bindings as they come out of the box. */
export function defaultBindings(): KeyBindings {
  const out: KeyBindings = {}
  for (const action of KEY_ACTIONS) out[action.id] = [...action.defaults]
  return out
}

/** Stored bindings laid over the defaults, dropping anything unreadable. */
export function mergeBindings(stored: unknown): KeyBindings {
  const bindings = defaultBindings()
  if (!stored || typeof stored !== 'object') return bindings

  for (const [id, value] of Object.entries(stored as Record<string, unknown>)) {
    if (!KEY_ACTIONS.some((action) => action.id === id)) continue
    const keys = (Array.isArray(value) ? value : [value])
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
      .map(normalizeBinding)
    bindings[id] = keys
  }
  return bindings
}

/**
 * One binding, written the way this file writes them: modifiers in a fixed
 * order, then the key, with single letters upper-cased.
 */
export function normalizeBinding(binding: string): string {
  const parts = binding.split('+').map((part) => part.trim()).filter(Boolean)
  const key = parts.pop() ?? ''
  const mods = new Set(parts.map((part) => part.toLowerCase()))

  const order = ['mod', 'alt', 'shift']
  const prefix = order.filter((mod) => mods.has(mod)).map((mod) => (mod === 'mod' ? 'Mod' : mod === 'alt' ? 'Alt' : 'Shift'))
  return [...prefix, key.length === 1 ? key.toUpperCase() : key].join('+')
}

/** What a keyboard event would be written as, or null for a modifier on its own. */
export function bindingFromEvent(event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return null

  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('Mod')
  if (event.altKey) parts.push('Alt')
  // Shift is part of the key for printable characters — Shift+/ is "?" — so it
  // is only named for the keys where it is not.
  const named = event.key === ' ' ? 'Space' : event.key
  if (event.shiftKey && (named.length > 1 || parts.length > 0)) parts.push('Shift')

  parts.push(named.length === 1 ? named.toUpperCase() : named)
  return parts.join('+')
}

/** How a binding should be read out: ⌘ on a Mac, Ctrl elsewhere. */
export function describeBinding(binding: string, mac: boolean): string {
  return binding
    .split('+')
    .map((part) => {
      if (part === 'Mod') return mac ? '⌘' : 'Ctrl'
      if (part === 'Shift') return mac ? '⇧' : 'Shift'
      if (part === 'Alt') return mac ? '⌥' : 'Alt'
      if (part === 'ArrowLeft') return '←'
      if (part === 'ArrowRight') return '→'
      if (part === 'ArrowUp') return '↑'
      if (part === 'ArrowDown') return '↓'
      return part
    })
    .join(mac ? '' : '+')
}

/** The action a keyboard event triggers in one context, or null. */
export function actionFor(
  bindings: KeyBindings,
  context: KeyContext,
  event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean },
): string | null {
  const pressed = bindingFromEvent(event)
  if (pressed === null) return null

  for (const action of KEY_ACTIONS) {
    if (action.context !== context) continue
    if ((bindings[action.id] ?? []).includes(pressed)) return action.id
  }
  return null
}

/** Actions already answering to a binding, for warning about a clash. */
export function clashesWith(bindings: KeyBindings, context: KeyContext, binding: string, exceptId: string): string[] {
  return KEY_ACTIONS.filter(
    (action) =>
      action.id !== exceptId && action.context === context && (bindings[action.id] ?? []).includes(binding),
  ).map((action) => action.id)
}
