/**
 * The Intiface engine: the program that actually talks Bluetooth to the toy.
 *
 * GoonLib speaks the Buttplug protocol to it over a local WebSocket, the same
 * arrangement vibe-signal used. It is not shipped with the app — it is fetched
 * the first time someone asks to connect a toy, from the project's own GitHub
 * release, and checked against a pinned SHA-256 before it is ever run. Nobody
 * who never uses this feature ends up with a Bluetooth daemon on their disk.
 *
 * The version is pinned rather than "latest" on purpose: the client library
 * speaks one protocol version, and a newer engine picked up silently is how a
 * toy that worked yesterday stops working today.
 */

import { spawn, execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, Socket } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'

const execFileAsync = promisify(execFile)

export const ENGINE_VERSION = '4.0.2'

const RELEASE_BASE = `https://github.com/buttplugio/buttplug/releases/download/intiface-engine-${ENGINE_VERSION}`

/**
 * One download per platform, with the digest GitHub published for it.
 *
 * There is no Intel Mac build of this version; those machines are pointed at
 * Intiface Central instead, which GoonLib will find and use if it is running.
 */
const ASSETS: Record<string, { suffix: string; sha256: string }> = {
  'darwin-arm64': {
    suffix: 'macos-arm64',
    sha256: '4331e57a68635f5b1ce062b29759ec75187773f53f80d15e0e13a2d253957909',
  },
  'linux-x64': {
    suffix: 'linux-x64',
    sha256: 'f1c61ab0abfab265beedfd89805a36c7641984b1baee680846814d22af3d6b3a',
  },
  'linux-arm64': {
    suffix: 'linux-arm64',
    sha256: 'bdedaa1f2e460e31a1b33fb6dfbb9d410d3e17929c16eb5b696aeb8b4adb4016',
  },
  'win32-x64': {
    suffix: 'win-x64',
    sha256: '38797ab30121b55cdedd50b457b676f0fb0d3bee2da7bcd149a21a30170a284e',
  },
}

/** Where Intiface Central listens unless told otherwise. */
export const CENTRAL_PORT = 12345

/** How long a fresh engine gets to open its port before it is given up on. */
const START_TIMEOUT_MS = 15_000

function asset(): { suffix: string; sha256: string } | null {
  return ASSETS[`${process.platform}-${process.arch}`] ?? null
}

export function engineSupported(): boolean {
  return asset() !== null
}

function engineDir(): string {
  return join(app.getPath('userData'), 'intiface-engine', ENGINE_VERSION)
}

function binaryName(): string {
  return process.platform === 'win32' ? 'intiface-engine.exe' : 'intiface-engine'
}

export function enginePath(): string {
  return join(engineDir(), binaryName())
}

/** Records the engine we started, so one orphaned by a crash can be found later. */
function pidFile(): string {
  return join(app.getPath('userData'), 'intiface-engine', 'engine.pid')
}

export function engineInstalled(): boolean {
  return existsSync(enginePath())
}

/**
 * Downloads, verifies and unpacks the engine.
 *
 * The archive is hashed before anything is written where it could be run, and
 * a mismatch throws rather than retrying: a wrong digest from a pinned release
 * means something between here and GitHub is not what it claims to be.
 */
export async function installEngine(onProgress: (percent: number) => void): Promise<void> {
  const target = asset()
  if (!target) {
    throw new Error(
      'There is no Intiface engine download for this machine. Install Intiface Central from intiface.com, start its server, and connect again - GoonLib will use it.',
    )
  }

  const name = `intiface-engine-v${ENGINE_VERSION}-${target.suffix}.zip`
  const response = await fetch(`${RELEASE_BASE}/${name}`)
  if (!response.ok || !response.body) {
    throw new Error(`Could not download the Intiface engine (HTTP ${response.status})`)
  }

  const total = Number(response.headers.get('content-length') ?? 0)
  const chunks: Uint8Array[] = []
  let received = 0
  const reader = response.body.getReader()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total > 0) onProgress(Math.min(99, Math.round((received / total) * 100)))
  }

  const archive = Buffer.concat(chunks)
  const digest = createHash('sha256').update(archive).digest('hex')
  if (digest !== target.sha256) {
    throw new Error(
      'The Intiface engine download did not match its published checksum, so it was not installed.',
    )
  }

  const dir = engineDir()
  // Unpacked into a scratch folder and moved into place last, so an extraction
  // that dies halfway never leaves something at enginePath() that looks usable.
  const staging = join(dir, '..', `staging-${Date.now()}`)
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })

  try {
    const zip = join(staging, name)
    await writeFile(zip, archive)
    await unzip(zip, staging)
    await rm(zip, { force: true })

    const found = await findFile(staging, binaryName())
    if (!found) throw new Error(`The Intiface engine archive did not contain ${binaryName()}`)
    if (process.platform !== 'win32') await chmod(found, 0o755)

    await mkdir(dir, { recursive: true })
    await rename(found, enginePath())
  } finally {
    await rm(staging, { recursive: true, force: true })
  }

  onProgress(100)
}

/**
 * Extracts with the platform's own tools rather than a zip library: bsdtar
 * reads zips on macOS and Windows 10+, and `unzip` is everywhere on Linux.
 */
async function unzip(zip: string, into: string): Promise<void> {
  if (process.platform === 'linux') {
    await execFileAsync('unzip', ['-o', '-q', zip, '-d', into])
  } else {
    await execFileAsync('tar', ['-xf', zip, '-C', into])
  }
}

async function findFile(dir: string, name: string): Promise<string | null> {
  for (const entry of await readdir(dir)) {
    const path = join(dir, entry)
    const info = await stat(path)
    if (info.isDirectory()) {
      const nested = await findFile(path, name)
      if (nested) return nested
    } else if (entry === name) {
      return path
    }
  }
  return null
}

/** Whether something is accepting connections on a local port. */
export function isListening(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket()
    const done = (result: boolean): void => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, '127.0.0.1')
  })
}

/** A port nothing is using right now, picked by the OS. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

export interface EngineOptions {
  lovenseConnect: boolean
}

/** One running engine. `stop` is safe to call at any time, any number of times. */
export class EngineProcess {
  private child: ChildProcess | null = null
  private output = ''

  /** Starts the engine and resolves with its port once it is listening. */
  async start(options: EngineOptions): Promise<number> {
    await reapOrphan()

    const port = await freePort()
    const args = [
      '--websocket-port', String(port),
      '--server-name', 'GoonLib',
      '--use-bluetooth-le',
      // The USB dongle Lovense sells for desktops, whose Bluetooth is often
      // too weak or too flaky for a toy across the room.
      '--use-lovense-dongle-hid',
    ]
    if (options.lovenseConnect) args.push('--use-lovense-connect')

    console.log('[toy] starting engine:', enginePath(), args.join(' '))
    const child = spawn(enginePath(), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    this.output = ''

    const keep = (chunk: Buffer): void => {
      // Only the tail: with logging on, a scan reports every advertisement it hears.
      this.output = (this.output + chunk.toString()).slice(-2000)
    }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    child.once('exit', (code, signal) => {
      console.log('[toy] engine exited', code ?? signal)
      if (this.child === child) this.child = null
      void rm(pidFile(), { force: true }).catch(() => undefined)
    })

    if (child.pid) {
      await mkdir(join(pidFile(), '..'), { recursive: true })
      await writeFile(pidFile(), String(child.pid))
    }

    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(this.exitedEarly(child.exitCode ?? child.signalCode))
      }
      if (await isListening(port)) return port
      await new Promise((resolve) => setTimeout(resolve, 300))
    }

    await this.stop()
    throw new Error(`The Intiface engine did not start listening within ${START_TIMEOUT_MS / 1000}s`)
  }

  get running(): boolean {
    return this.child !== null
  }

  /** Asks nicely, then insists. */
  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    this.child = null

    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 3_000)
    await exited
    clearTimeout(timer)
  }

  /** Stops without waiting, for the quit path where nothing can be awaited. */
  kill(): void {
    this.child?.kill('SIGKILL')
    this.child = null
  }

  private exitedEarly(reason: number | string | null): string {
    // Unsigned, it never gets a Bluetooth prompt of its own; macOS asks on
    // behalf of whichever app launched it, and a refusal is a SIGABRT with
    // nothing useful in the log. That is by far the likeliest cause here.
    if (process.platform === 'darwin' && reason === 'SIGABRT') {
      return 'macOS stopped the Intiface engine from using Bluetooth. Allow GoonLib in System Settings → Privacy & Security → Bluetooth, then connect again. (Running from a terminal in development, it is the terminal app that needs allowing.)'
    }

    const tail = strip(this.output).trim().split('\n').slice(-2).join(' ').trim()
    const base = `The Intiface engine stopped as soon as it started (${reason ?? 'no exit code'}).`
    return tail ? `${base} ${tail}` : base
  }
}

/** Removes terminal colour codes, which the engine's log is full of. */
function strip(text: string): string {
  // eslint-disable-next-line no-control-regex -- matching the escape is the point
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * Stops an engine a previous run of GoonLib left behind.
 *
 * A child process is not taken down with its parent on macOS, so a crash
 * leaves the engine running and holding the toy, and the next connect can
 * never find it. The pid is only acted on if it still belongs to an engine —
 * pids get reused, and killing whatever now has that number would be far
 * worse than the problem this solves.
 */
async function reapOrphan(): Promise<void> {
  let pid: number
  try {
    pid = Number(await readFile(pidFile(), 'utf8'))
  } catch {
    return
  }
  await rm(pidFile(), { force: true })
  if (!Number.isSafeInteger(pid) || pid <= 0 || process.platform === 'win32') return

  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'comm='])
    if (!stdout.includes('intiface-engine')) return
    console.log('[toy] stopping an engine left over from a previous run:', pid)
    process.kill(pid, 'SIGTERM')
  } catch {
    // Not running, which is the usual case.
  }
}
