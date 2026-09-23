/**
 * A small wrapper around spawning ffmpeg.
 *
 * ffmpeg writes warnings and progress to stderr and reports real failures only
 * through the exit code, so a plain promisified exec loses the message that
 * explains what went wrong. This keeps the tail of stderr and puts it in the
 * rejection.
 *
 * Three modes, all sharing one implementation:
 *  - runFfmpeg          fire and forget, stdout ignored
 *  - runFfmpegCapture   collect stdout as a Buffer (used to pull a raw frame)
 *  - onProgress         parse `-progress pipe:1` key=value lines as they arrive
 */

import { spawn } from 'node:child_process'
import { requireFfmpeg } from '../ffmpeg'

export interface RunOptions {
  signal?: AbortSignal
  timeoutMs?: number
  /** How much stderr to retain for the error message. */
  stderrLimit?: number
  /** Cap on captured stdout, for the capture variant. */
  maxBytes?: number
  /**
   * Called with elapsed output position in microseconds as encoding proceeds.
   * Requires `-progress pipe:1 -nostats` in the argument list.
   */
  onProgress?: (outTimeUs: number) => void
}

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message)
    this.name = 'FfmpegError'
  }
}

export async function runFfmpeg(args: string[], options: RunOptions = {}): Promise<void> {
  await execute(args, options, false)
}

/**
 * Runs ffmpeg and returns whatever it wrote to stdout — used to pull a single
 * decoded frame out of a video without ffmpeg having to encode it.
 */
export async function runFfmpegCapture(args: string[], options: RunOptions = {}): Promise<Buffer> {
  const output = await execute(args, options, true)
  return output as Buffer
}

async function execute(
  args: string[],
  options: RunOptions,
  capture: boolean,
): Promise<Buffer | void> {
  const {
    signal,
    timeoutMs = 0,
    stderrLimit = 4000,
    maxBytes = 256 * 1024 * 1024,
    onProgress,
  } = options

  const wantsStdout = capture || onProgress !== undefined

  return new Promise<Buffer | void>((resolve, reject) => {
    const child = spawn(requireFfmpeg(), args, {
      stdio: ['ignore', wantsStdout ? 'pipe' : 'ignore', 'pipe'],
    })

    const chunks: Buffer[] = []
    let captured = 0
    let progressTail = ''
    let stderr = ''
    let timer: NodeJS.Timeout | undefined
    let settled = false

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }

    function onAbort(): void {
      child.kill('SIGKILL')
      finish(() => reject(new Error('ffmpeg was cancelled')))
    }

    if (signal?.aborted) {
      child.kill('SIGKILL')
      finish(() => reject(new Error('ffmpeg was cancelled')))
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish(() => reject(new FfmpegError(`ffmpeg timed out after ${timeoutMs}ms`, null, stderr)))
      }, timeoutMs)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (capture) {
        captured += chunk.length
        if (captured > maxBytes) {
          child.kill('SIGKILL')
          finish(() =>
            reject(new FfmpegError(`ffmpeg produced more than ${maxBytes} bytes`, null, stderr)),
          )
          return
        }
        chunks.push(chunk)
        return
      }

      if (onProgress) {
        // `-progress` emits key=value lines; hold any partial trailing line over.
        progressTail += chunk.toString()
        const lines = progressTail.split('\n')
        progressTail = lines.pop() ?? ''

        for (const line of lines) {
          const match = /^out_time_us=(\d+)$/.exec(line.trim())
          if (match?.[1]) onProgress(Number(match[1]))
        }
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      // Keep only the tail; a failing decode can emit megabytes of warnings.
      stderr = (stderr + chunk.toString()).slice(-stderrLimit)
    })

    child.on('error', (err) => finish(() => reject(err)))

    child.on('close', (code) => {
      if (code !== 0) {
        finish(() =>
          reject(
            new FfmpegError(`ffmpeg exited with code ${code}: ${lastLine(stderr)}`, code, stderr),
          ),
        )
        return
      }

      if (!capture) {
        finish(() => resolve(undefined))
        return
      }

      const output = Buffer.concat(chunks)
      if (output.length === 0) {
        finish(() =>
          reject(new FfmpegError('ffmpeg exited cleanly but produced no output', 0, stderr)),
        )
        return
      }

      finish(() => resolve(output))
    })
  })
}

function lastLine(stderr: string): string {
  const lines = stderr.trim().split('\n').filter(Boolean)
  return lines[lines.length - 1] ?? 'no error output'
}
