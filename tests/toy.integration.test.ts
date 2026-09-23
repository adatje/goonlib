/**
 * The toy service against a Buttplug server, over a real WebSocket.
 *
 * The server is a stand-in speaking protocol v4 on Intiface Central's port,
 * with one Lovense-shaped vibrator on it — so this exercises the genuine
 * client, the loop, and above all Stop, without Bluetooth or a toy. What is
 * checked is what the device would actually have been sent.
 *
 * Skipped when something real is already on that port: a test suite has no
 * business connecting to someone's running Intiface Central.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'

const workspace = await mkdtemp(join(tmpdir(), 'goonlib-toy-'))

vi.mock('electron', () => ({ app: { getPath: () => workspace } }))

const { initDb, closeDb } = await import('../src/main/db')
const { CENTRAL_PORT, isListening } = await import('../src/main/toy/engine')
const { toys } = await import('../src/main/toy')

type Message = Record<string, Record<string, unknown>>

/** Everything the device was told, in order. */
const received: Message[] = []
let server: WebSocketServer | null = null
let socket: WebSocket | null = null

const occupied = await isListening(CENTRAL_PORT)

const LUSH = {
  DeviceIndex: 0,
  DeviceName: 'Lovense Lush',
  DeviceMessageTimingGap: 100,
  DeviceFeatures: {
    0: {
      FeatureIndex: 0,
      FeatureDescriptor: 'Vibrator',
      Output: { Vibrate: { Value: [0, 20] } },
      Input: { Battery: { Value: [0, 100], Command: ['Read'] } },
    },
  },
}

function answer(message: Message): Message {
  const [name, body] = Object.entries(message)[0]!
  const Id = body['Id']
  switch (name) {
    case 'RequestServerInfo':
      return {
        ServerInfo: {
          Id,
          ServerName: 'Stand-in',
          MaxPingTime: 0,
          ProtocolVersionMajor: 4,
          ProtocolVersionMinor: 0,
        },
      }
    case 'RequestDeviceList':
      return { DeviceList: { Id, Devices: { 0: LUSH } } }
    case 'InputCmd':
      return {
        InputReading: { Id, DeviceIndex: 0, FeatureIndex: 0, Reading: { Battery: { Value: 64 } } },
      }
    default:
      return { Ok: { Id } }
  }
}

async function until(check: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function vibrations(): number[] {
  return received
    .filter((message) => message['OutputCmd'])
    .map((message) => {
      const command = message['OutputCmd']!['Command'] as { Vibrate: { Value: number } }
      return command.Vibrate.Value
    })
}

const stops = (): number => received.filter((message) => message['StopCmd']).length

beforeAll(async () => {
  initDb(join(workspace, 'test.db'))
  if (occupied) return

  server = new WebSocketServer({ host: '127.0.0.1', port: CENTRAL_PORT })
  server.on('connection', (ws) => {
    socket = ws
    ws.on('message', (data) => {
      const batch = JSON.parse(String(data)) as Message[]
      for (const message of batch) {
        received.push(message)
        ws.send(JSON.stringify([answer(message)]))
      }
    })
  })
  await new Promise<void>((resolve) => server!.once('listening', () => resolve()))
})

afterAll(async () => {
  await toys.disconnect()
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  closeDb()
  await rm(workspace, { recursive: true, force: true })
})

describe.skipIf(occupied)('the toy service', () => {
  it('uses an Intiface server already running, and finds the toy on it', async () => {
    const status = await toys.connect()
    expect(status.engine).toBe('ready')
    expect(status.server).toBe('external')
    expect(status.armed).toBe(true)

    await until(() => toys.status().devices.length === 1)
    await until(() => toys.status().devices[0]!.battery !== null)
    expect(toys.status().devices[0]).toEqual({
      index: 0,
      name: 'Lovense Lush',
      vibrate: true,
      stroke: false,
      battery: 0.64,
    })
  })

  it('runs a pattern from the panel, on the motor’s own steps', async () => {
    toys.manual({ pattern: 'steady', intensity: 0.5 })
    await until(() => vibrations().at(-1) === 10)
  })

  it('scales everything by the intensity', async () => {
    // Half strength at half intensity is a quarter: 5 of the motor's 20 steps.
    toys.setPrefs({ maxIntensity: 0.5 })
    await until(() => vibrations().at(-1) === 5)
    toys.setPrefs({ maxIntensity: 1 })
  })

  it('stops the device at once, and sends nothing more until resumed', async () => {
    const before = stops()
    const status = await toys.stop()
    expect(status.armed).toBe(false)
    expect(status.manual).toBeNull()
    expect(stops()).toBe(before + 1)

    const sent = vibrations().length
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(vibrations().slice(sent).every((value) => value === 0)).toBe(true)
  })

  it('turns guests away until the host offers the toy, and lets them in after', async () => {
    toys.resume()
    const body = { pattern: 'steady', intensity: 1, seconds: 1 }
    expect(toys.buzz('guest-1', 'Sam', body)).toBe('off')
    expect(toys.guestOffer()).toBeNull()

    toys.setPrefs({ guests: true, guestMaxIntensity: 0.5 })
    expect(toys.guestOffer()).toMatchObject({ maxIntensity: 0.5, maxSeconds: 10 })
    expect(toys.buzz('guest-1', 'Sam', body)).toBe('ok')
    // Asked for full power; the host's guest ceiling is half.
    await until(() => vibrations().at(-1) === 10)
    expect(toys.status().guests.playing?.name).toBe('Sam')
    expect(toys.buzz('guest-1', 'Sam', body)).toBe('cooling')

    // And back off at the end of it.
    await until(() => vibrations().at(-1) === 0, 3000)
    toys.setPrefs({ guests: false })
  })

  it('plays a saved pattern, picks up an edit to it, and stops it when deleted', async () => {
    const pattern = toys.savePattern({
      name: 'Plateau',
      durationMs: 1000,
      points: [{ at: 0, level: 0.5 }, { at: 1000, level: 0.5 }],
    })
    toys.manual({ pattern: `custom:${pattern.id}`, intensity: 1 })
    await until(() => vibrations().at(-1) === 10)

    toys.savePattern({ ...pattern, points: [{ at: 0, level: 1 }, { at: 1000, level: 1 }] })
    await until(() => vibrations().at(-1) === 20)

    toys.removePattern(pattern.id)
    expect(toys.status().manual).toBeNull()
    await until(() => vibrations().at(-1) === 0)
  })

  it('previews a shape that has not been saved', async () => {
    toys.manual({
      pattern: 'preview',
      intensity: 1,
      shape: { durationMs: 1000, points: [{ at: 0, level: 0.25 }, { at: 1000, level: 0.25 }] },
    })
    await until(() => vibrations().at(-1) === 5)
    toys.manual(null)
    await until(() => vibrations().at(-1) === 0)
  })

  it('says so when the server goes away underneath it', async () => {
    socket?.terminate()
    await until(() => toys.status().engine === 'error')
    expect(toys.status().message).toMatch(/Lost the connection/)
    expect(toys.status().devices).toEqual([])
  })
})
