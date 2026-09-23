/**
 * Builds the macOS app icon from the artwork in `assets/`.
 *
 * The source is an Icon Composer bundle: a transparent PNG plus a JSON file
 * describing a vertical gradient behind it. This reproduces that as a flat image,
 * laid out to Apple's macOS proportions — the artwork sits on a rounded square
 * inset within a 1024px canvas, rather than filling it edge to edge, which is why
 * a naive full-bleed export always looks oversized next to other apps in the Dock.
 *
 * Run with: node scripts/make-icon.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const CANVAS = 1024
/** Apple's macOS icon grid: the rounded square is 824 of 1024, centred. */
const TILE = 824
const RADIUS = 185
const INSET = (CANVAS - TILE) / 2
/** How much of the tile the artwork occupies. */
const ARTWORK_SCALE = 0.66

// From icon.json's linear-gradient, converted from display-p3 to sRGB.
const TOP = '#fff7f1'
const BOTTOM = '#f76fc9'
/** icon.json stops the gradient at 70% height; below that it holds the end colour. */
const GRADIENT_STOP = 0.7

const background = Buffer.from(`
  <svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0.5" y1="0" x2="0.5" y2="${GRADIENT_STOP}">
        <stop offset="0" stop-color="${TOP}"/>
        <stop offset="1" stop-color="${BOTTOM}"/>
      </linearGradient>
    </defs>
    <rect x="${INSET}" y="${INSET}" width="${TILE}" height="${TILE}"
          rx="${RADIUS}" ry="${RADIUS}" fill="url(#g)"/>
  </svg>
`)

async function main() {
  const artworkSize = Math.round(TILE * ARTWORK_SCALE)

  const artwork = await sharp(join(root, 'assets', 'mark.png'))
    .resize(artworkSize, artworkSize, { fit: 'inside', withoutEnlargement: false })
    .toBuffer()

  const { height: artHeight = artworkSize, width: artWidth = artworkSize } =
    await sharp(artwork).metadata()

  const icon = await sharp(background)
    .composite([
      {
        input: artwork,
        left: Math.round((CANVAS - artWidth) / 2),
        // Nudged up slightly: optical centre sits above geometric centre.
        top: Math.round((CANVAS - artHeight) / 2 - TILE * 0.02),
      },
    ])
    .png()
    .toBuffer()

  await mkdir(join(root, 'build'), { recursive: true })
  await writeFile(join(root, 'build', 'icon.png'), icon)

  // An .iconset directory of every size macOS asks for; `iconutil` turns it into
  // the .icns that electron-builder ships.
  const iconset = join(root, 'build', 'icon.iconset')
  await mkdir(iconset, { recursive: true })

  const sizes = [16, 32, 128, 256, 512]
  for (const size of sizes) {
    await sharp(icon).resize(size, size).png().toFile(join(iconset, `icon_${size}x${size}.png`))
    await sharp(icon)
      .resize(size * 2, size * 2)
      .png()
      .toFile(join(iconset, `icon_${size}x${size}@2x.png`))
  }

  // A small copy for the sidebar. Imported by the renderer so Vite fingerprints
  // it and emits a relative URL — a public-folder path would break under the
  // file:// origin a packaged app loads from.
  const rendererAssets = join(root, 'src', 'renderer', 'src', 'assets')
  await mkdir(rendererAssets, { recursive: true })
  await sharp(icon).resize(128, 128).png().toFile(join(rendererAssets, 'mark.png'))

  console.log('wrote build/icon.png, build/icon.iconset, and the renderer mark')
}

await main()
