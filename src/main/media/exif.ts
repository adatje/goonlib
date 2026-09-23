/**
 * EXIF from a photo: the camera, how it was set, when it was taken, and where.
 *
 * Read on demand, when the viewer's details panel asks, rather than during the
 * scan: most files in a library have none, the ones that do are only looked at
 * one at a time, and a scan should never slow down for a panel that is off.
 * Nothing read here is stored.
 */

import exifr from 'exifr'
import type { MediaExif } from '@shared/types'

const EXIF_KINDS = new Set(['.jpg', '.jpeg', '.tif', '.tiff', '.heic', '.heif', '.png', '.webp', '.avif'])

export async function readExif(path: string, ext: string): Promise<MediaExif | null> {
  if (!EXIF_KINDS.has(ext.toLowerCase())) return null

  let raw: Record<string, unknown> | undefined
  try {
    raw = (await exifr.parse(path, { tiff: true, exif: true, gps: true, xmp: false, icc: false, iptc: false })) as
      | Record<string, unknown>
      | undefined
  } catch {
    return null
  }
  if (!raw) return null

  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim().replace(/\0/g, '') : null
  const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

  const exposure = num(raw['ExposureTime'])
  const taken = raw['DateTimeOriginal'] ?? raw['CreateDate']
  const latitude = num(raw['latitude'])
  const longitude = num(raw['longitude'])

  const exif: MediaExif = {
    make: text(raw['Make']),
    model: text(raw['Model']),
    lens: text(raw['LensModel']) ?? text(raw['LensMake']),
    takenAt: taken instanceof Date && !Number.isNaN(taken.getTime()) ? taken.getTime() : null,
    exposure: exposure === null ? null : exposure >= 1 ? `${exposure}s` : `1/${Math.round(1 / exposure)}s`,
    aperture: num(raw['FNumber']) !== null ? `f/${num(raw['FNumber'])}` : null,
    iso: num(raw['ISO']),
    focalLength: num(raw['FocalLength']) !== null ? `${num(raw['FocalLength'])} mm` : null,
    flash: text(raw['Flash']),
    software: text(raw['Software']),
    location: latitude !== null && longitude !== null ? { latitude, longitude } : null,
  }

  const { location, ...rest } = exif
  return Object.values(rest).some((value) => value !== null) || location ? exif : null
}
