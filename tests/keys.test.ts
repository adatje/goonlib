/**
 * The shortcut map: what a key press means, and what happens to a binding that
 * has been changed, cleared or written oddly.
 */

import { describe, expect, it } from 'vitest'
import {
  actionFor,
  bindingFromEvent,
  clashesWith,
  defaultBindings,
  describeBinding,
  KEY_ACTIONS,
  mergeBindings,
  normalizeBinding,
} from '../src/shared/keys'

const press = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe('reading a key press', () => {
  it('writes one the way the list writes them', () => {
    expect(bindingFromEvent(press('k'))).toBe('K')
    expect(bindingFromEvent(press(' '))).toBe('Space')
    expect(bindingFromEvent(press('a', { metaKey: true }))).toBe('Mod+A')
    expect(bindingFromEvent(press('ArrowLeft', { shiftKey: true }))).toBe('Shift+ArrowLeft')
    // Shift is part of a printable character, not a modifier of it.
    expect(bindingFromEvent(press('?', { shiftKey: true }))).toBe('?')
    expect(bindingFromEvent(press('Shift'))).toBeNull()
  })

  it('takes Ctrl and Cmd as the same modifier', () => {
    expect(bindingFromEvent(press('z', { ctrlKey: true }))).toBe('Mod+Z')
    expect(bindingFromEvent(press('z', { metaKey: true }))).toBe('Mod+Z')
  })
})

describe('what a press does', () => {
  const bindings = defaultBindings()

  it('finds the action for the context it happened in', () => {
    expect(actionFor(bindings, 'viewer', press(' '))).toBe('player.playPause')
    expect(actionFor(bindings, 'library', press(' '))).toBeNull()
    expect(actionFor(bindings, 'library', press('a', { metaKey: true }))).toBe('library.selectAll')
  })

  it('answers to every key an action lists', () => {
    expect(actionFor(bindings, 'viewer', press('ArrowRight'))).toBe('viewer.next')
    expect(actionFor(bindings, 'viewer', press(']'))).toBe('viewer.next')
  })

  it('says nothing for a key nobody claims', () => {
    expect(actionFor(bindings, 'viewer', press('q'))).toBeNull()
  })
})

describe('changing them', () => {
  it('lays stored keys over the defaults and drops nonsense', () => {
    const merged = mergeBindings({ 'viewer.favorite': ['Mod+B'], 'nothing.here': ['Z'], 'viewer.random': 4 })
    expect(merged['viewer.favorite']).toEqual(['Mod+B'])
    expect(merged['nothing.here']).toBeUndefined()
    expect(merged['viewer.random']).toEqual([])
    // Everything untouched still stands.
    expect(merged['player.mute']).toEqual(['M'])
  })

  it('writes a binding the one way', () => {
    expect(normalizeBinding('shift+mod+k')).toBe('Mod+Shift+K')
    expect(normalizeBinding('space')).toBe('space')
  })

  it('reports a clash, and only within the same context', () => {
    const bindings = defaultBindings()
    expect(clashesWith(bindings, 'viewer', 'M', 'viewer.loop')).toEqual(['player.mute'])
    expect(clashesWith(bindings, 'library', 'M', 'viewer.loop')).toEqual([])
    // An action is never told it clashes with itself.
    expect(clashesWith(bindings, 'player' as never, 'M', 'player.mute')).toEqual([])
  })

  it('reads out for the platform in hand', () => {
    expect(describeBinding('Mod+Shift+Z', true)).toBe('⌘⇧Z')
    expect(describeBinding('Mod+Shift+Z', false)).toBe('Ctrl+Shift+Z')
    expect(describeBinding('ArrowLeft', true)).toBe('←')
  })

  it('gives every action somewhere to live and something to say', () => {
    for (const action of KEY_ACTIONS) {
      expect(action.label.length).toBeGreaterThan(0)
      expect(action.group.length).toBeGreaterThan(0)
    }
  })
})
