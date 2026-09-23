/**
 * Sprite-sheet geometry for hover scrubbing.
 *
 * Pure maths, kept out of the component so it can be tested directly.
 */

/**
 * The `background-position` that selects a given frame.
 *
 * Percentage positioning aligns the image's p% point with the box's p% point, so
 * selecting cell `n` of `count` means `n / (count - 1)` — not `n / count`. Paired
 * with `background-size: ${columns * 100}%`, this makes each cell exactly one card
 * wide at any card size, so the same sheet works at every grid density without
 * measuring anything.
 *
 * The guards matter: a single-column or single-row sheet would divide by zero.
 */
export function cellPosition(frame: number, columns: number, rows: number): string {
  const column = frame % columns
  const row = Math.floor(frame / columns)

  const x = columns > 1 ? (column / (columns - 1)) * 100 : 0
  const y = rows > 1 ? (row / (rows - 1)) * 100 : 0

  return `${x}% ${y}%`
}

/** `background-size` for a sheet of the given shape. */
export function sheetSize(columns: number, rows: number): string {
  return `${columns * 100}% ${rows * 100}%`
}
