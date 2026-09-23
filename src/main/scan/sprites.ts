/**
 * Stage 4 of the scan: hover-scrub sprite sheets.
 *
 * The output is a single tiled image, so scrubbing across a card costs no I/O at
 * all once the sheet has loaded — the renderer just moves `background-position`.
 *
 * Two strategies, chosen by duration, because neither wins everywhere:
 *
 *  - Short clips decode start-to-finish in one pass and let ffmpeg's `fps` and
 *    `tile` filters do the work. Decoding a 30-second file is trivial.
 *
 *  - Long videos seek to each frame position instead. A full decode of a
 *    feature-length film to produce forty thumbnails would take minutes; seeking
 *    costs one GOP of decode per frame however long the film is.
 *
 * An earlier version used `-skip_frame nokey` to make the single pass cheap on
 * long files. That silently produced *nothing*: a short clip often holds a single
 * keyframe (x264 defaults to a ten-second GOP), and `tile` emits no output at all
 * unless it receives every cell it was promised.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import sharp from 'sharp'
import { runFfmpegCapture } from '../media/ffmpeg-run'

/** Cell width in the sheet. Cards render around 190px, so this stays crisp. */
const CELL_WIDTH = 200

/** Columns in the tile grid. Rows follow from the frame count. */
const COLUMNS = 8

const MIN_FRAMES = 8
const MAX_FRAMES = 40

/** Roughly one preview frame per this much footage. */
const MS_PER_FRAME = 2000

/** Below this there's nothing to scrub through; a still already says it all. */
export const MIN_SPRITE_DURATION_MS = 3000

/**
 * Above this, seek to each frame rather than decoding the whole file. Chosen so
 * that a full decode stays comfortably under a second or two.
 */
export const SEEK_STRATEGY_ABOVE_MS = 4 * 60 * 1000

export interface SpriteRequest {
  absPath: string
  durationMs: number | null
}

export interface SpriteLayout {
  frames: number
  columns: number
  cellWidth: number
  cellHeight: number
}

export interface SpritePlan {
  frames: number
  columns: number
  rows: number
}

/** How many frames to sample, and the grid they tile into. */
export function planSprite(durationMs: number): SpritePlan {
  const wanted = Math.round(durationMs / MS_PER_FRAME)
  const target = Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, wanted))

  const rows = Math.ceil(target / COLUMNS)
  // Fill the grid exactly. `tile` refuses to emit a partial grid, and a blank
  // trailing cell would flash as the user scrubs past the end.
  return { frames: COLUMNS * rows, columns: COLUMNS, rows }
}

/** Evenly spaced sample points, each at the centre of its slice of the timeline. */
export function frameTimestamps(durationMs: number, frames: number): number[] {
  const durationSeconds = durationMs / 1000
  return Array.from({ length: frames }, (_, i) => ((i + 0.5) * durationSeconds) / frames)
}

/**
 * Writes a sprite sheet to `outPath` and returns its geometry, or null when the
 * clip is too short to be worth scrubbing.
 *
 * The destination is a parameter rather than derived from a media id so that this
 * module stays free of any electron import and can be exercised directly.
 */
export async function generateSprite(
  request: SpriteRequest,
  outPath: string,
  signal?: AbortSignal,
): Promise<SpriteLayout | null> {
  const { durationMs } = request
  if (durationMs === null || durationMs < MIN_SPRITE_DURATION_MS) return null

  const plan = planSprite(durationMs)

  const tiled =
    durationMs > SEEK_STRATEGY_ABOVE_MS
      ? await tileBySeeking(request, durationMs, plan, signal)
      : await tileInOnePass(request, durationMs, plan, signal)

  const { data, info } = await sharp(tiled).webp({ quality: 70 }).toBuffer({ resolveWithObject: true })

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, data)

  return {
    frames: plan.frames,
    columns: plan.columns,
    // Measure rather than predict: `scale=W:-2` rounds height to an even number,
    // so a computed cell height would be off by a pixel and drift across the sheet.
    cellWidth: Math.round(info.width / plan.columns),
    cellHeight: Math.round(info.height / plan.rows),
  }
}

/** One decode of the whole file, tiled by ffmpeg. Cheap for short clips. */
async function tileInOnePass(
  request: SpriteRequest,
  durationMs: number,
  plan: SpritePlan,
  signal?: AbortSignal,
): Promise<Buffer> {
  const rate = plan.frames / (durationMs / 1000)

  return runFfmpegCapture(
    [
      '-v',
      'error',
      '-i',
      request.absPath,
      '-vf',
      `fps=${rate.toFixed(6)},scale=${CELL_WIDTH}:-2,tile=${plan.columns}x${plan.rows}`,
      '-frames:v',
      '1',
      '-an',
      '-sn',
      '-c:v',
      'png',
      '-f',
      'image2pipe',
      'pipe:1',
    ],
    { signal, timeoutMs: 120_000, maxBytes: 128 * 1024 * 1024 },
  )
}

/**
 * One fast seek per frame, composited with sharp. Cost is independent of the
 * video's length, which is what makes long files affordable.
 */
async function tileBySeeking(
  request: SpriteRequest,
  durationMs: number,
  plan: SpritePlan,
  signal?: AbortSignal,
): Promise<Buffer> {
  const timestamps = frameTimestamps(durationMs, plan.frames)

  // Sequential on purpose: the indexer already runs several videos at once, and
  // fanning out seeks within each one would oversubscribe the CPU.
  //
  // Individual grabs are allowed to fail. ffprobe's duration is an estimate on
  // variable-bitrate files, so a seek near the end can land past the real last
  // frame and come back empty — and a truncated download does the same thing
  // everywhere. Reusing the previous frame degrades the tail of the preview;
  // propagating the error would throw away the whole sheet.
  const frames: Buffer[] = []
  for (const seconds of timestamps) {
    try {
      frames.push(await grabFrame(request.absPath, seconds, signal))
    } catch (err) {
      if (signal?.aborted) throw err

      const previous = frames[frames.length - 1]
      if (previous) frames.push(previous)
    }
  }

  // Everything failed — one last try at the very start before giving up.
  if (frames.length === 0) {
    frames.push(await grabFrame(request.absPath, 0, signal))
  }

  // Pad a short run so the grid is still filled; `tile` semantics aside, the
  // renderer indexes cells by position and a missing tail would show black.
  const last = frames[frames.length - 1]
  while (frames.length < plan.frames && last) frames.push(last)

  const first = frames[0]
  if (!first) throw new Error('No preview frames could be extracted')

  const { width, height } = await sharp(first).metadata()
  if (!width || !height) throw new Error('Preview frame had no readable dimensions')

  // Even height keeps the sheet consistent with the single-pass path's scale=-2.
  const cellHeight = Math.max(2, Math.round((CELL_WIDTH * height) / width / 2) * 2)

  const cells = await Promise.all(
    frames.map((frame) =>
      sharp(frame).resize(CELL_WIDTH, cellHeight, { fit: 'cover' }).png().toBuffer(),
    ),
  )

  return sharp({
    create: {
      width: CELL_WIDTH * plan.columns,
      height: cellHeight * plan.rows,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite(
      cells.map((input, index) => ({
        input,
        left: (index % plan.columns) * CELL_WIDTH,
        top: Math.floor(index / plan.columns) * cellHeight,
      })),
    )
    .png()
    .toBuffer()
}

async function grabFrame(
  absPath: string,
  seconds: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  return runFfmpegCapture(
    [
      '-v',
      'error',
      // Before -i, so ffmpeg jumps by keyframe rather than decoding from the start.
      '-ss',
      seconds.toFixed(3),
      '-i',
      absPath,
      '-frames:v',
      '1',
      '-an',
      '-sn',
      '-c:v',
      'png',
      '-f',
      'image2pipe',
      'pipe:1',
    ],
    { signal, timeoutMs: 30_000, maxBytes: 64 * 1024 * 1024 },
  )
}
