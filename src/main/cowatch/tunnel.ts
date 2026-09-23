/**
 * Public reachability, borrowed rather than built.
 *
 * A partner on an ordinary internet connection cannot reach a laptop behind a
 * router, and the alternatives are asking them to install a VPN or running a
 * relay service of our own. Instead we drive whichever tunnel the user already
 * has, get a public https URL out of it, and kill the process when the session
 * ends. Nothing is bundled: these are large signed binaries with their own
 * licences and update cadence, and shipping a stale copy of one is worse than
 * telling someone to install it.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import type { CoWatchTunnelProvider } from '@shared/types'

export type TunnelKind = 'cloudflared' | 'ngrok'

export interface Tunnel {
  kind: TunnelKind
  url: string
  stop(): void
}

/** How long to wait for a tunnel to announce its URL before giving up on it. */
const STARTUP_TIMEOUT_MS = 30_000

/**
 * Where package managers put things, for when PATH does not say.
 *
 * An app launched from the Finder or the Dock inherits a minimal PATH — typically
 * just /usr/bin:/bin:/usr/sbin:/sbin — so a Homebrew install is invisible to it
 * even though the same binary is obviously present in a terminal. Without this,
 * the feature works in development and mysteriously does not in the shipped app.
 */
const EXTRA_PATHS =
  process.platform === 'win32'
    ? // winget links its installs here, and chocolatey shims its own; neither is
      // guaranteed to be on the PATH a packaged app inherits.
      [
        join(process.env['LOCALAPPDATA'] ?? '', 'Microsoft', 'WinGet', 'Links'),
        join(process.env['ProgramData'] ?? '', 'chocolatey', 'bin'),
      ]
    : [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/opt/local/bin',
        join(process.env['HOME'] ?? '', '.local/bin'),
      ]

/**
 * Ordered by how little the user has to have done first. A cloudflared quick
 * tunnel needs no account at all, which makes it the one we reach for.
 */
const PROVIDERS: Array<{
  kind: TunnelKind
  args: (port: number) => string[]
  pattern: RegExp
}> = [
  {
    kind: 'cloudflared',
    args: (port) => ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'],
    pattern: /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i,
  },
  {
    kind: 'ngrok',
    args: (port) => ['http', String(port), '--log', 'stdout'],
    pattern: /https:\/\/[a-z0-9-]+\.ngrok[-.][a-z.]+/i,
  },
]

/** Every directory worth looking in, PATH plus the usual package-manager spots. */
function searchPath(): string[] {
  const fromEnv = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)
  return [...new Set([...fromEnv, ...EXTRA_PATHS.filter(Boolean)])]
}

/** The absolute path to a provider's binary, or null if it is not installed. */
export async function locate(kind: TunnelKind): Promise<string | null> {
  const names = process.platform === 'win32' ? [`${kind}.exe`, kind] : [kind]

  for (const dir of searchPath()) {
    for (const name of names) {
      const candidate = join(dir, name)
      try {
        await access(candidate, constants.X_OK)
        return candidate
      } catch {
        // Not here; keep looking.
      }
    }
  }

  return null
}

/** Which providers this machine actually has, for the panel to offer. */
export async function availableTunnels(): Promise<TunnelKind[]> {
  const found: TunnelKind[] = []
  for (const provider of PROVIDERS) {
    if (await locate(provider.kind)) found.push(provider.kind)
  }
  return found
}

/**
 * Brings up a tunnel to `port`.
 *
 * `auto` tries each installed provider in order; naming one uses only that, and
 * says so plainly if it is missing rather than quietly falling back to the other
 * — being handed a cloudflared URL after asking for ngrok is worse than an error.
 */
export async function startTunnel(
  port: number,
  choice: CoWatchTunnelProvider = 'auto',
): Promise<Tunnel> {
  const wanted = choice === 'auto' ? PROVIDERS : PROVIDERS.filter((p) => p.kind === choice)
  const failures: string[] = []

  for (const provider of wanted) {
    const binary = await locate(provider.kind)
    if (!binary) {
      failures.push(`${provider.kind} is not installed`)
      continue
    }

    try {
      return await launch(provider, binary, port)
    } catch (err) {
      failures.push(`${provider.kind}: ${(err as Error).message}`)
    }
  }

  throw new Error(failures.length > 0 ? failures.join('; ') : notInstalledAdvice(choice))
}

function notInstalledAdvice(choice: CoWatchTunnelProvider): string {
  if (choice === 'ngrok') {
    return 'ngrok is not installed. Install it (brew install ngrok) and run `ngrok config add-authtoken` once, or switch to cloudflared.'
  }
  if (choice === 'cloudflared') {
    return 'cloudflared is not installed. Install it with `brew install cloudflared` - its quick tunnels need no account.'
  }
  return 'No tunnel found. Install cloudflared (brew install cloudflared) - its quick tunnels need no account - or ngrok, then start the session again.'
}

function launch(
  provider: (typeof PROVIDERS)[number],
  binary: string,
  port: number,
): Promise<Tunnel> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess

    try {
      child = spawn(binary, provider.args(port), { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      reject(new Error(`${provider.kind} could not be started`))
      return
    }

    let settled = false
    let output = ''

    const finish = (err: Error | null, url?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      if (err) {
        child.kill()
        reject(err)
        return
      }

      resolve({
        kind: provider.kind,
        url: url as string,
        stop: () => {
          // SIGTERM so the provider can withdraw its route on the way out; a
          // dangling public hostname is exactly what we are avoiding.
          child.kill('SIGTERM')
        },
      })
    }

    const timer = setTimeout(
      () => finish(new Error(`${provider.kind} did not come up within 30 seconds`)),
      STARTUP_TIMEOUT_MS,
    )

    const watch = (chunk: Buffer): void => {
      const text = chunk.toString()
      // Kept so a failure can quote the provider's own words rather than a
      // generic "it did not work" — ngrok's authtoken complaint lands here.
      output = (output + text).slice(-2_000)

      const match = provider.pattern.exec(text)
      if (match) finish(null, match[0])
    }

    child.stdout?.on('data', watch)
    child.stderr?.on('data', watch)

    child.on('error', () => finish(new Error(`${provider.kind} could not be started`)))
    child.on('exit', (code) => finish(new Error(explainExit(provider.kind, code, output))))
  })
}

/**
 * Turns a provider's exit into something actionable.
 *
 * ngrok's most common failure by far is an unconfigured authtoken, and its own
 * message says so — surfacing that beats reporting an exit code.
 */
function explainExit(kind: TunnelKind, code: number | null, output: string): string {
  if (/authtoken/i.test(output)) {
    return `${kind} needs an account: run \`${kind} config add-authtoken <token>\` once, then try again.`
  }

  const tail = output.trim().split('\n').at(-1)
  return tail
    ? `${kind} stopped before it was ready: ${tail.slice(0, 200)}`
    : `${kind} stopped before it was ready (code ${code ?? 'unknown'})`
}
