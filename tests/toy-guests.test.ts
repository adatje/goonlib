/**
 * Guests' buzzes: queued, played one after another, and rationed.
 *
 * Ported from vibe-signal's rate limit, so the behaviour to protect is the
 * same: nobody can hog the toy, and a busy room cannot stack up minutes of
 * buzzing that plays on long after the moment.
 */

import { describe, expect, it } from 'vitest'
import { BuzzQueue, COOLDOWN_BUFFER_MS, MAX_QUEUED_MS } from '../src/main/toy/guests'
import type { QueuedBuzz } from '../src/main/toy/guests'

function buzz(from: string, durationMs = 2000, intensity = 0.5): QueuedBuzz {
  return { from, name: from, pattern: 'steady', intensity, durationMs }
}

describe('guest buzzes', () => {
  it('plays them back to back, then goes quiet', () => {
    const queue = new BuzzQueue()
    expect(queue.enqueue(buzz('a', 1000, 0.4), 0)).toBe('ok')
    expect(queue.enqueue(buzz('b', 1000, 0.9), 0)).toBe('ok')

    expect(queue.levelAt(500)).toBe(0.4)
    expect(queue.levelAt(1500)).toBe(0.9)
    expect(queue.levelAt(2500)).toBe(0)
  })

  it('makes each guest wait out their own buzz and a buffer', () => {
    const queue = new BuzzQueue()
    expect(queue.enqueue(buzz('a'), 0)).toBe('ok')
    expect(queue.enqueue(buzz('a'), 1000)).toBe('cooling')
    // Someone else is not held up by it.
    expect(queue.enqueue(buzz('b'), 1000)).toBe('ok')
    expect(queue.enqueue(buzz('a'), 2000 + COOLDOWN_BUFFER_MS)).toBe('ok')
  })

  it('refuses to queue more than the ceiling', () => {
    const queue = new BuzzQueue()
    const guests = Math.floor(MAX_QUEUED_MS / 10_000)
    for (let i = 0; i < guests; i += 1) expect(queue.enqueue(buzz(`g${i}`, 10_000), 0)).toBe('ok')
    expect(queue.enqueue(buzz('late', 10_000), 0)).toBe('full')
  })

  it('forgets everything, cooldowns included, when cleared', () => {
    const queue = new BuzzQueue()
    queue.enqueue(buzz('a', 5000), 0)
    queue.clear()
    expect(queue.levelAt(100)).toBe(0)
    expect(queue.enqueue(buzz('a'), 200)).toBe('ok')
  })

  it('skips a buzz that ended while nobody was looking rather than playing it late', () => {
    const queue = new BuzzQueue()
    queue.enqueue(buzz('a', 1000, 0.4), 0)
    queue.enqueue(buzz('b', 1000, 0.9), 0)
    expect(queue.levelAt(5000)).toBe(0)
    expect(queue.waitingCount).toBe(0)
  })
})

describe('after a quiet spell', () => {
  it('starts a new buzz now, not in the slot after one that ended long ago', () => {
    const queue = new BuzzQueue()
    queue.enqueue(buzz('a', 1000, 0.4), 0)
    expect(queue.levelAt(500)).toBe(0.4)
    // Nobody asks again until well after it ended.
    expect(queue.enqueue(buzz('b', 1000, 0.9), 60_000)).toBe('ok')
    expect(queue.levelAt(60_500)).toBe(0.9)
  })
})
