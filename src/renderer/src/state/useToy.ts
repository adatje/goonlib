import { useCallback, useEffect, useRef, useState } from 'react'
import connectedSound from '../assets/connected.mp3'
import disconnectedSound from '../assets/disconnected.mp3'
import type { CustomPatternDraft, ToyManual, ToyPrefs, ToyStatus } from '@shared/types'
import type { CustomPattern } from '@shared/toy'

function idle(): ToyStatus {
  return {
    engine: 'off',
    server: null,
    installed: false,
    supported: true,
    progress: null,
    message: null,
    scanning: false,
    devices: [],
    armed: false,
    level: 0,
    script: { kind: 'none', mediaId: null },
    manual: null,
    patterns: [],
    guests: { open: false, playing: null, waiting: 0 },
  }
}

export interface ToyView {
  status: ToyStatus
  /** Null until read, so the panel never shows a default as if it were stored. */
  prefs: ToyPrefs | null
  /** Connected with at least one toy found — the only state worth lighting up for. */
  live: boolean
  connect: () => void
  disconnect: () => void
  scan: () => void
  stop: () => void
  resume: () => void
  manual: (manual: ToyManual | null) => void
  setPrefs: (patch: Partial<ToyPrefs>) => void
  /** Resolves with the pattern as stored, so the editor can carry on from it. */
  savePattern: (draft: CustomPatternDraft) => Promise<CustomPattern>
  deletePattern: (id: number) => void
}

/**
 * The toy as the interface sees it: whatever the main process last pushed.
 *
 * Every action stores the status it gets back rather than guessing, the same
 * as the co-watching hook, so a button never shows a state the toy is not in.
 */
export function useToy(): ToyView {
  const [status, setStatus] = useState<ToyStatus>(idle)
  // The placeholder shown before the main process has answered, which says
  // nothing about which toys are actually known.
  const initial = useRef(status)
  const [prefs, setPrefsState] = useState<ToyPrefs | null>(null)

  useEffect(() => {
    void window.goonlib.toy.status().then(setStatus).catch(() => undefined)
    void window.goonlib.toy.prefs().then(setPrefsState).catch(() => undefined)
    return window.goonlib.toy.onUpdate(setStatus)
  }, [])

  // A chime when a toy joins, and a power-down when one leaves, Disconnect
  // included. Only for changes seen here: the toys already there when the
  // window opens, or reloads, are taken as known.
  const known = useRef<Set<number> | null>(null)
  useEffect(() => {
    if (status === initial.current) return
    const ids = new Set(status.devices.map((device) => device.index))
    const previous = known.current
    known.current = ids
    if (previous === null) return
    if ([...ids].some((id) => !previous.has(id))) playToySound(connectedSound)
    else if ([...previous].some((id) => !ids.has(id))) playToySound(disconnectedSound)
  }, [status])

  const apply = useCallback((pending: Promise<ToyStatus>) => {
    void pending.then(setStatus).catch(() => undefined)
  }, [])

  const connect = useCallback(() => apply(window.goonlib.toy.connect()), [apply])
  const disconnect = useCallback(() => apply(window.goonlib.toy.disconnect()), [apply])
  const scan = useCallback(() => apply(window.goonlib.toy.scan()), [apply])
  const stop = useCallback(() => apply(window.goonlib.toy.stop()), [apply])
  const resume = useCallback(() => apply(window.goonlib.toy.resume()), [apply])
  const manual = useCallback(
    (next: ToyManual | null) => apply(window.goonlib.toy.manual(next)),
    [apply],
  )
  const setPrefs = useCallback((patch: Partial<ToyPrefs>) => {
    void window.goonlib.toy.setPrefs(patch).then(setPrefsState).catch(() => undefined)
  }, [])

  const savePattern = useCallback(
    (draft: CustomPatternDraft) => window.goonlib.toy.savePattern(draft),
    [],
  )
  const deletePattern = useCallback(
    (id: number) => apply(window.goonlib.toy.deletePattern(id)),
    [apply],
  )

  const live = status.engine === 'ready' && status.devices.length > 0

  /**
   * X stops the toy from anywhere in the app, whatever has focus.
   *
   * A stop that first needs the right panel open, or the pointer on the right
   * button, is not a stop. Ignored while typing, so a chat message with an x
   * in it does not cut someone off mid-scene.
   */
  useEffect(() => {
    if (status.engine !== 'ready') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'x' && event.key !== 'X') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      // A slider keeps focus after it is dragged — the seek bar, the strength
      // slider — and that must not be what stops Stop from working.
      const textual =
        target instanceof HTMLInputElement &&
        !['range', 'checkbox', 'radio', 'button'].includes(target.type)
      const typing = textual || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true
      if (typing) return
      stop()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [status.engine, stop])

  return {
    status,
    prefs,
    live,
    connect,
    disconnect,
    scan,
    stop,
    resume,
    manual,
    setPrefs,
    savePattern,
    deletePattern,
  }
}

let toyAudio: HTMLAudioElement | null = null

/** One toy sound at a time: a new one cuts off one still playing. */
function playToySound(url: string): void {
  toyAudio?.pause()
  toyAudio = new Audio(url)
  toyAudio.volume = 0.7
  void toyAudio.play().catch(() => undefined)
}
