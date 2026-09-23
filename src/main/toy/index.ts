/**
 * Toys, as the rest of the app sees them.
 *
 * Owns the engine, the connection to it, the devices it found, and one loop
 * that runs twenty times a second deciding how hard each of them should be
 * going. Everything that wants the toy — the video, the panel, a guest — tells
 * this object what it wants and never touches a device itself, which is what
 * lets one Stop mean stop, whoever was driving.
 *
 * Built on vibe-signal's approach: the Intiface engine handles Bluetooth, and
 * this talks the Buttplug protocol to it over a local WebSocket. That makes it
 * work with Lovense toys over Bluetooth or the Lovense USB dongle — and, as a
 * side effect, with most other brands too.
 */

import { EventEmitter } from 'node:events'
import {
  ButtplugClient,
  ButtplugNodeWebsocketClientConnector,
  DeviceOutput,
  InputType,
  OutputType,
} from 'buttplug'
import type { ButtplugClientDevice, DeviceOutputValueConstructor } from 'buttplug'
import type {
  CustomPatternDraft,
  ToyDevice,
  ToyEngineState,
  ToyManual,
  ToyPlayback,
  ToyPrefs,
  ToyScriptState,
  ToyStatus,
} from '@shared/types'
import type { CustomPattern, PatternShape, ToyScript } from '@shared/toy'
import {
  clamp01,
  customIdOf,
  customPatternId,
  curveOf,
  isPattern,
  normaliseShape,
  shapeBuzz,
  TOY_PATTERNS,
  toSteps,
} from '@shared/toy'
import { deletePattern, listPatterns, savePattern } from '../db/patterns'
import { setToyPrefs, toyPrefs } from '../db/settings'
import { mix, positionNow, StrokeFollower } from './driver'
import type { Anchor, RunningManual } from './driver'
import {
  CENTRAL_PORT,
  EngineProcess,
  engineInstalled,
  engineSupported,
  installEngine,
  isListening,
} from './engine'
import { BuzzQueue } from './guests'
import type { BuzzOutcome } from './guests'
import { audioScriptFor, funscriptFor } from './scripts'

/** How often the loop decides what every device should be doing. */
const TICK_MS = 50

/**
 * The shortest gap between two strength changes sent to one device.
 *
 * Lovense toys drop commands that arrive faster than about ten a second, and
 * a dropped command is worse than a late one: the toy sits at whatever it
 * last heard. Going to zero ignores this — stopping is never worth delaying.
 */
const MIN_SEND_GAP_MS = 100

/** How long to look for toys each time a scan is asked for. */
const SCAN_MS = 20_000

/** How often batteries are re-read while connected. */
const BATTERY_MS = 60_000

/** Least time between two status pushes caused only by the level moving. */
const PUSH_GAP_MS = 120

/** Kinds of motor that take a strength. All are driven by the same level. */
const STRENGTH_OUTPUTS = [OutputType.Vibrate, OutputType.Rotate, OutputType.Oscillate] as const

interface DeviceState {
  device: ButtplugClientDevice
  battery: number | null
  /** Last step sent per feature and output, so an unchanged level sends nothing. */
  sent: Map<string, number>
  lastSentAt: number
  /** A command still in flight. The next one waits rather than queueing up. */
  busy: boolean
  follower: StrokeFollower
}

class Toys extends EventEmitter {
  private readonly engine = new EngineProcess()
  private client: ButtplugClient | null = null
  private state: ToyEngineState = 'off'
  private server: ToyStatus['server'] = null
  private message: string | null = null
  private progress: number | null = null
  private scanning = false
  private scanTimer: NodeJS.Timeout | null = null
  private tickTimer: NodeJS.Timeout | null = null
  private batteryTimer: NodeJS.Timeout | null = null
  private readonly devices = new Map<number, DeviceState>()

  private prefsCache: ToyPrefs | null = null
  private patternsCache: CustomPattern[] | null = null
  private armed = false
  private level = 0
  private anchor: Anchor | null = null
  private script: ToyScript | null = null
  private scriptState: ToyScriptState = { kind: 'none', mediaId: null }
  private scriptAbort: AbortController | null = null
  private manualRun: RunningManual | null = null
  private readonly guests = new BuzzQueue()

  private lastPush = 0
  private pushTimer: NodeJS.Timeout | null = null
  /** Guards against two connects racing into two engines. */
  private connecting = false

  get prefs(): ToyPrefs {
    this.prefsCache ??= toyPrefs()
    return this.prefsCache
  }

  /** Saved patterns, read once and kept, since the loop consults them constantly. */
  get patterns(): CustomPattern[] {
    this.patternsCache ??= listPatterns()
    return this.patternsCache
  }

  private savedShape(id: number): PatternShape | null {
    return this.patterns.find((pattern) => pattern.id === id) ?? null
  }

  status(): ToyStatus {
    const now = Date.now()
    const playing = this.guests.current(now)

    return {
      engine: this.state,
      server: this.server,
      installed: engineInstalled(),
      supported: engineSupported(),
      progress: this.progress,
      message: this.message,
      scanning: this.scanning,
      devices: [...this.devices.values()].map((entry) => describe(entry)),
      armed: this.armed,
      level: this.level,
      script: this.scriptState,
      manual: this.manualRun
        ? { pattern: this.manualRun.pattern, intensity: this.manualRun.intensity }
        : null,
      patterns: this.patterns,
      guests: {
        open: this.guestsOpen(),
        playing: playing
          ? {
              name: playing.buzz.name,
              pattern: playing.buzz.pattern,
              remainingMs: Math.max(0, playing.startedAt + playing.buzz.durationMs - now),
            }
          : null,
        waiting: this.guests.waitingCount,
      },
    }
  }

  // --- connecting -----------------------------------------------------------

  /**
   * Gets from nothing to a connected, scanning client.
   *
   * An Intiface Central the user already has running is preferred over
   * starting a second engine: two engines would fight over the same Bluetooth
   * adapter, and whichever lost would find no toys.
   */
  async connect(): Promise<ToyStatus> {
    if (this.client?.connected || this.connecting) return this.status()
    this.connecting = true
    this.message = null

    try {
      if (await isListening(CENTRAL_PORT)) {
        try {
          await this.attach(CENTRAL_PORT)
          this.server = 'external'
        } catch (err) {
          // Something else owns that port. Not ours to worry about; start our own.
          console.log('[toy] port', CENTRAL_PORT, 'is not an Intiface server:', (err as Error).message)
        }
      }

      if (!this.client) {
        if (!engineInstalled()) {
          this.setState('installing')
          this.progress = 0
          await installEngine((percent) => {
            this.progress = percent
            this.changed()
          })
          this.progress = null
        }

        this.setState('starting')
        const port = await this.engine.start({ lovenseConnect: this.prefs.lovenseConnect })
        await this.attach(port)
        this.server = 'bundled'
      }

      // Connecting is itself the request to use the toy, so it starts armed.
      // Only an explicit Stop takes that away.
      this.armed = true
      this.setState('ready')
      this.startLoop()
      void this.scan()
      // A video already on screen should be followed without reopening it.
      if (this.anchor?.mediaId) void this.loadScript(this.anchor.mediaId)
    } catch (err) {
      console.error('[toy] connect failed:', err)
      this.progress = null
      this.message = (err as Error).message
      await this.teardown()
      this.setState('error')
    } finally {
      this.connecting = false
    }

    return this.status()
  }

  /**
   * Connects at launch, if the user asked for that — but never as a way of
   * downloading the engine. A first download is something to see happen, from
   * the panel, not something that starts by itself when the app opens.
   */
  async autoConnect(): Promise<void> {
    if (!this.prefs.autoConnect) return
    if (!engineInstalled() && !(await isListening(CENTRAL_PORT))) return
    await this.connect()
  }

  private async attach(port: number): Promise<void> {
    const client = new ButtplugClient('GoonLib')
    client.on('deviceadded', (device: ButtplugClientDevice) => this.added(device))
    client.on('deviceremoved', (device: ButtplugClientDevice) => this.removed(device))
    client.on('scanningfinished', () => {
      this.scanning = false
      this.changed()
    })
    client.on('disconnect', () => {
      // The engine went away underneath us — it crashed, or Intiface Central
      // was quit. Stop pretending anything is connected.
      if (this.client !== client) return
      console.log('[toy] engine connection lost')
      this.message = 'Lost the connection to the Intiface engine.'
      void this.teardown().then(() => this.setState('error'))
    })

    await client.connect(new ButtplugNodeWebsocketClientConnector(`ws://127.0.0.1:${port}`))
    this.client = client
    // Devices the server already knew about arrive before any event fires.
    for (const device of client.devices.values()) this.added(device)
  }

  async disconnect(): Promise<ToyStatus> {
    await this.halt()
    await this.teardown()
    this.message = null
    this.setState('off')
    return this.status()
  }

  /** Drops the client and the engine, leaving everything as if never connected. */
  private async teardown(): Promise<void> {
    this.stopLoop()
    this.stopScanTimer()
    this.scanning = false

    const client = this.client
    this.client = null
    this.devices.clear()
    this.server = null
    this.level = 0

    this.scriptAbort?.abort()
    this.script = null
    this.scriptState = { kind: 'none', mediaId: this.anchor?.mediaId ?? null }

    try {
      if (client?.connected) await client.disconnect()
    } catch {
      // Already gone.
    }
    await this.engine.stop()
  }

  /** Looks for toys for a while. Toys switched on later need this to be found. */
  async scan(): Promise<ToyStatus> {
    const client = this.client
    if (!client?.connected || this.scanning) return this.status()

    try {
      await client.startScanning()
      this.scanning = true
      this.changed()
      this.stopScanTimer()
      this.scanTimer = setTimeout(() => {
        this.scanTimer = null
        void client.stopScanning().catch(() => undefined)
        this.scanning = false
        this.changed()
      }, SCAN_MS)
    } catch (err) {
      this.message = `Could not look for toys: ${(err as Error).message}`
      this.changed()
    }
    return this.status()
  }

  private stopScanTimer(): void {
    if (this.scanTimer) clearTimeout(this.scanTimer)
    this.scanTimer = null
  }

  private added(device: ButtplugClientDevice): void {
    if (this.devices.has(device.index)) return
    console.log('[toy] device added:', device.name)
    this.devices.set(device.index, {
      device,
      battery: null,
      sent: new Map(),
      lastSentAt: 0,
      busy: false,
      follower: new StrokeFollower(),
    })
    void this.readBattery(device.index)
    this.changed()
  }

  private removed(device: ButtplugClientDevice): void {
    if (!this.devices.delete(device.index)) return
    console.log('[toy] device removed:', device.name)
    // Usually a toy that went out of range or to sleep. Looking again is what
    // lets it come back by itself when it is switched back on.
    void this.scan()
    this.changed()
  }

  private async readBattery(index: number): Promise<void> {
    const entry = this.devices.get(index)
    if (!entry || !entry.device.hasInput(InputType.Battery)) return
    // Readings arrive raw, in whatever range the device declares — 0–100 for
    // Lovense — not as a fraction.
    const range = [...entry.device.features.values()]
      .map((feature) => feature.input(InputType.Battery)?.valueRange)
      .find((found) => found !== undefined)
    const top = range && range[1] > 0 ? range[1] : 100
    try {
      entry.battery = clamp01((await entry.device.battery()) / top)
      this.changed()
    } catch {
      // Some firmware answers slowly or not at all. Leave it unknown.
    }
  }

  // --- stopping -------------------------------------------------------------

  /**
   * Stops every device, forgets every pattern and every queued buzz, and
   * stays stopped until `resume`.
   */
  async stop(): Promise<ToyStatus> {
    this.armed = false
    await this.halt()
    this.changed()
    return this.status()
  }

  resume(): ToyStatus {
    if (this.client?.connected) this.armed = true
    this.changed()
    return this.status()
  }

  private async halt(): Promise<void> {
    this.manualRun = null
    this.guests.clear()
    this.level = 0

    await Promise.all(
      [...this.devices.values()].map(async (entry) => {
        entry.sent.clear()
        entry.follower.reset()
        try {
          await entry.device.stop()
        } catch (err) {
          console.error('[toy] stop failed for', entry.device.name, err)
        }
      }),
    )
  }

  /**
   * For quitting, where nothing can be awaited. The engine is killed outright;
   * Lovense toys stop by themselves when the connection drops.
   */
  shutdown(): void {
    this.armed = false
    this.stopLoop()
    for (const entry of this.devices.values()) void entry.device.stop().catch(() => undefined)
    this.engine.kill()
  }

  // --- what drives it -------------------------------------------------------

  manual(manual: ToyManual | null): ToyStatus {
    const shape = manual ? this.resolveShape(manual) : undefined

    if (manual === null || shape === null) {
      this.manualRun = null
    } else {
      this.manualRun = {
        pattern: manual.pattern,
        intensity: clamp01(Number(manual.intensity)),
        // Changing only the strength — or, while previewing, the shape being
        // drawn — keeps the pattern's rhythm going, rather than restarting it
        // on every nudge.
        startedAt:
          this.manualRun?.pattern === manual.pattern ? this.manualRun.startedAt : Date.now(),
        ...(shape ? { shape } : {}),
      }
    }
    this.changed()
    return this.status()
  }

  /**
   * The drawn shape a manual pattern plays: undefined for a built-in, the
   * saved or previewed shape for the others, and null for anything that
   * names no pattern at all.
   */
  private resolveShape(manual: ToyManual): PatternShape | null | undefined {
    if (isPattern(manual.pattern)) return undefined
    if (manual.pattern === 'preview') return normaliseShape(manual.shape)
    const id = customIdOf(manual.pattern)
    return id !== null ? this.savedShape(id) : null
  }

  savePattern(draft: CustomPatternDraft): CustomPattern {
    const saved = savePattern(draft)
    this.patternsCache = null
    // A saved pattern that is running plays its new shape from the next tick.
    if (this.manualRun?.pattern === customPatternId(saved.id)) {
      this.manualRun = { ...this.manualRun, shape: saved }
    }
    this.changed()
    return saved
  }

  removePattern(id: number): ToyStatus {
    deletePattern(id)
    this.patternsCache = null
    if (this.manualRun?.pattern === customPatternId(id)) this.manualRun = null
    this.changed()
    return this.status()
  }

  /** The host's player reporting in. Cheap, because it arrives often. */
  playback(report: ToyPlayback): void {
    const now = Date.now()
    const mediaId = typeof report.mediaId === 'number' ? report.mediaId : null
    const previous = this.anchor
    const next: Anchor = {
      mediaId,
      playing: report.playing === true,
      positionMs: Math.max(0, Number(report.positionMs) || 0),
      rate: Number.isFinite(report.rate) && report.rate > 0 ? report.rate : 1,
      at: now,
    }
    this.anchor = next

    if (mediaId !== previous?.mediaId) {
      for (const entry of this.devices.values()) entry.follower.reset()
      void this.loadScript(mediaId)
      return
    }

    // A jump, a pause or a resume means a stroker's current move is aimed at
    // the wrong place; start it again from where the video now is.
    const expected = previous ? positionNow(previous, now) : next.positionMs
    if (next.playing !== previous?.playing || Math.abs(expected - next.positionMs) > 400) {
      for (const entry of this.devices.values()) entry.follower.reset()
    }
  }

  private async loadScript(mediaId: number | null): Promise<void> {
    this.scriptAbort?.abort()
    this.scriptAbort = null
    this.script = null

    // Nothing is worked out for a toy that is not there — pulling the audio
    // out of every video opened would cost CPU for nothing.
    if (mediaId === null || !this.client?.connected || !this.prefs.followVideo) {
      this.scriptState = { kind: 'none', mediaId }
      this.changed()
      return
    }

    const abort = new AbortController()
    this.scriptAbort = abort
    this.scriptState = { kind: 'loading', mediaId }
    this.changed()

    try {
      const found = await funscriptFor(mediaId)
      if (abort.signal.aborted) return
      if (found) {
        this.script = found.script
        this.scriptState = { kind: 'funscript', mediaId, name: found.name }
      } else if (this.prefs.audio) {
        const script = await audioScriptFor(mediaId, abort.signal)
        if (abort.signal.aborted) return
        this.script = script
        this.scriptState = script ? { kind: 'audio', mediaId } : { kind: 'none', mediaId }
      } else {
        this.scriptState = { kind: 'none', mediaId }
      }
    } catch (err) {
      if (abort.signal.aborted) return
      console.error('[toy] could not load a script for', mediaId, err)
      this.scriptState = { kind: 'error', mediaId, message: (err as Error).message }
    } finally {
      if (this.scriptAbort === abort) this.scriptAbort = null
    }
    this.changed()
  }

  /**
   * The loaded script's strength across the video, for drawing under the
   * player. Null unless the script loaded is the one for `mediaId` — a curve
   * for the previous video would be worse than none.
   */
  curve(mediaId: number, durationMs: number, points: number): number[] | null {
    const script = this.script
    if (!script || this.scriptState.mediaId !== mediaId) return null
    if (!Number.isFinite(durationMs) || durationMs <= 0) return null
    const count = Math.min(1000, Math.max(10, Math.floor(points)))
    return curveOf(script, durationMs, count, this.prefs.vibrateFrom)
  }

  setPrefs(patch: Partial<ToyPrefs>): ToyPrefs {
    const before = this.prefs
    this.prefsCache = setToyPrefs(patch)
    const after = this.prefsCache

    if (before.followVideo !== after.followVideo || before.audio !== after.audio) {
      void this.loadScript(this.anchor?.mediaId ?? null)
    }
    // Turning guests off also drops whatever they had queued.
    if (!after.guests) this.guests.clear()
    this.changed()
    return after
  }

  // --- guests ---------------------------------------------------------------

  /** Whether co-watching guests should be offered the toy right now. */
  guestsOpen(): boolean {
    return (
      this.prefs.guests &&
      this.armed &&
      this.state === 'ready' &&
      [...this.devices.values()].some((entry) => canStrength(entry.device))
    )
  }

  /**
   * What a guest page should offer: the ceilings, and every pattern by name —
   * saved ones included — or null when guests are not welcome.
   */
  guestOffer(): {
    maxIntensity: number
    maxSeconds: number
    patterns: Array<{ id: string; label: string }>
  } | null {
    if (!this.guestsOpen()) return null
    return {
      maxIntensity: this.prefs.guestMaxIntensity,
      maxSeconds: this.prefs.guestMaxSeconds,
      patterns: [
        ...TOY_PATTERNS.map((pattern) => ({ id: pattern.id, label: pattern.label })),
        ...this.patterns.map((pattern) => ({ id: customPatternId(pattern.id), label: pattern.name })),
      ],
    }
  }

  buzz(from: string, name: string, body: unknown): BuzzOutcome | 'invalid' {
    if (!this.guestsOpen()) return 'off'
    const request = shapeBuzz(
      body,
      {
        maxIntensity: this.prefs.guestMaxIntensity,
        maxSeconds: this.prefs.guestMaxSeconds,
      },
      (id) => this.savedShape(id),
    )
    if (!request) return 'invalid'

    const outcome = this.guests.enqueue({ ...request, from, name }, Date.now())
    if (outcome === 'ok') console.log('[toy] buzz from', name, request.pattern, request.durationMs)
    this.changed()
    return outcome
  }

  // --- the loop -------------------------------------------------------------

  private startLoop(): void {
    this.stopLoop()
    this.tickTimer = setInterval(() => this.tick(), TICK_MS)
    this.batteryTimer = setInterval(() => {
      for (const index of this.devices.keys()) void this.readBattery(index)
    }, BATTERY_MS)
  }

  private stopLoop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer)
    if (this.batteryTimer) clearInterval(this.batteryTimer)
    this.tickTimer = null
    this.batteryTimer = null
  }

  private tick(): void {
    if (this.devices.size === 0) return
    const now = Date.now()
    const prefs = this.prefs

    const level = mix(
      {
        armed: this.armed,
        prefs,
        anchor: this.anchor,
        script: this.script,
        manual: this.manualRun,
        guestLevel: this.guestsOpen() ? this.guests.levelAt(now) : 0,
      },
      now,
    )

    for (const entry of this.devices.values()) {
      this.drive(entry, level, now)
      this.stroke(entry, now)
    }

    if (Math.abs(level - this.level) >= 0.01) {
      this.level = level
      this.changed()
    }
  }

  /** Sends the level to every strength motor on a device, if it moved. */
  private drive(entry: DeviceState, level: number, now: number): void {
    if (entry.busy) return

    const commands: Array<() => Promise<void>> = []
    let stopping = false

    for (const feature of entry.device.features.values()) {
      for (const type of STRENGTH_OUTPUTS) {
        const output = feature.output(type)
        if (!output) continue

        const steps = toSteps(level, output.valueRange[1])
        const key = `${feature.index}:${type}`
        if (entry.sent.get(key) === steps) continue

        if (steps === 0) stopping = true
        commands.push(async () => {
          await feature.runOutput(strength(type).value(steps))
          entry.sent.set(key, steps)
        })
      }
    }

    if (commands.length === 0) return
    if (!stopping && now - entry.lastSentAt < MIN_SEND_GAP_MS) return

    entry.busy = true
    entry.lastSentAt = now
    void Promise.all(commands.map((send) => send()))
      .catch((err: unknown) => console.error('[toy] send failed for', entry.device.name, err))
      .finally(() => {
        entry.busy = false
      })
  }

  /** Walks a stroker through a funscript, one move per action. */
  private stroke(entry: DeviceState, now: number): void {
    const script = this.script
    const anchor = this.anchor
    if (!this.armed || !this.prefs.followVideo) return
    if (script?.kind !== 'strokes' || !anchor?.playing) return

    for (const feature of entry.device.features.values()) {
      const output = feature.output(OutputType.HwPositionWithDuration)
      if (!output) continue

      const move = entry.follower.next(script.actions, positionNow(anchor, now) + this.prefs.leadMs)
      if (!move) return

      const [bottom, top] = output.valueRange
      const [shortest, longest] = output.durationRange ?? [0, 10_000]
      const value = Math.round(bottom + (top - bottom) * move.position)
      const duration = Math.min(longest, Math.max(shortest, move.durationMs))
      void feature
        .runOutput(DeviceOutput.HwPositionWithDuration.value(value, duration))
        .catch((err: unknown) => console.error('[toy] stroke failed for', entry.device.name, err))
      return
    }
  }

  // --- status ---------------------------------------------------------------

  private setState(state: ToyEngineState): void {
    this.state = state
    this.changed()
  }

  /**
   * Pushes the status, at most every PUSH_GAP_MS. The level moves twenty times
   * a second while a script plays, and nobody needs a meter redrawn that often.
   */
  private changed(): void {
    const wait = PUSH_GAP_MS - (Date.now() - this.lastPush)
    if (wait <= 0) {
      this.push()
      return
    }
    this.pushTimer ??= setTimeout(() => this.push(), wait)
  }

  private push(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = null
    this.lastPush = Date.now()
    this.emit('change')
  }
}

function strength(type: (typeof STRENGTH_OUTPUTS)[number]): DeviceOutputValueConstructor {
  switch (type) {
    case OutputType.Vibrate:
      return DeviceOutput.Vibrate
    case OutputType.Rotate:
      return DeviceOutput.Rotate
    case OutputType.Oscillate:
      return DeviceOutput.Oscillate
  }
}

function canStrength(device: ButtplugClientDevice): boolean {
  return STRENGTH_OUTPUTS.some((type) => device.hasOutput(type))
}

function describe(entry: DeviceState): ToyDevice {
  const device = entry.device
  return {
    index: device.index,
    name: device.displayName || device.name,
    vibrate: canStrength(device),
    stroke: device.hasOutput(OutputType.HwPositionWithDuration),
    battery: entry.battery,
  }
}

export const toys = new Toys()
